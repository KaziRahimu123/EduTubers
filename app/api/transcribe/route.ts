import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink, readFile, readdir, rm, access, mkdir, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { request as nodeHttpsRequest } from 'node:https';
import ffmpegStatic from 'ffmpeg-static';

const execFileAsync = promisify(execFile);

// Whisper hard limit per request is 25 MB. Use 23 MB as safety ceiling.
const WHISPER_CHUNK_BYTES = 23 * 1024 * 1024;
const MAX_FILE_MB    = 100;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

// 20-minute segments — at 64 kbps mono that's ~9.6 MB, well under the 25 MB Whisper limit
const SEGMENT_DURATION_SECS = 1200;

const ALLOWED_MIME_TYPES = new Set([
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/flac', 'audio/x-flac',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/mpeg', 'video/x-msvideo',
]);

// Long enough for multiple Whisper calls on a 100 MB file
export const maxDuration = 60;

// ── Parse multipart upload via Web FormData API ───────────────────────────────
// Next.js App Router (v15+) fully supports req.formData() for route handlers
// and streams the body without double-buffering when proxyClientMaxBodySize is
// set in next.config.ts. This avoids the locked-stream problem that occurs when
// manually piping req.body through Busboy after Next has already read it.

interface SavedFile {
  path: string;
  mimeType: string;
  filename: string;
  size: number;
}

async function saveUploadToDisk(req: NextRequest, destPath: string): Promise<SavedFile> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (e) {
    throw new Error(`Failed to parse upload: ${e instanceof Error ? e.message : String(e)}`);
  }

  const entry = formData.get('file') ?? formData.get('video');
  if (!entry || !(entry instanceof File)) {
    throw new Error('No file field found in the upload.');
  }

  const file = entry as File;
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File must be ${MAX_FILE_MB} MB or smaller.`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  await writeFile(destPath, bytes);

  return {
    path: destPath,
    mimeType: file.type || 'application/octet-stream',
    filename: file.name || 'upload',
    size: file.size,
  };
}

// ── Resolve a working ffmpeg binary ──────────────────────────────────────────
// execFile avoids shell quoting — paths with spaces (e.g. "EduTubers/…") work fine.

async function resolveFfmpegBin(): Promise<string> {
  if (ffmpegStatic) {
    try { await access(ffmpegStatic); return ffmpegStatic; }
    catch { console.warn('[transcribe] ffmpeg-static not accessible:', ffmpegStatic); }
  }
  try {
    const { stdout } = await execFileAsync('which', ['ffmpeg']);
    const bin = stdout.trim();
    if (bin) { await access(bin); return bin; }
  } catch { /* not on PATH */ }
  throw new Error('ffmpeg not found. Run `brew install ffmpeg`.');
}

// ── Split to MP3 segments via ffmpeg ─────────────────────────────────────────

async function splitToMp3Segments(inputPath: string, outputDir: string): Promise<string[]> {
  const bin = await resolveFfmpegBin();

  await execFileAsync(bin, [
    '-y',
    '-i', inputPath,
    '-vn',                           // strip video
    '-acodec', 'libmp3lame',
    '-ab', '64k',
    '-ac', '1',                      // mono
    '-f', 'segment',
    '-segment_time', String(SEGMENT_DURATION_SECS),
    '-reset_timestamps', '1',
    join(outputDir, 'seg_%03d.mp3'),
  ]);

  return (await readdir(outputDir))
    .filter(f => f.startsWith('seg_') && f.endsWith('.mp3'))
    .sort()
    .map(f => join(outputDir, f));
}

// ── Send one audio file to Whisper ───────────────────────────────────────────

// ── Send one audio file to Whisper via Node https (bypasses Next.js fetch patch)
// Next.js patches globalThis.fetch and binds every outgoing fetch() to the
// incoming request's AbortSignal. When the browser upload takes a long time the
// signal fires ("The session has been destroyed") before Whisper can respond.
// node:https is completely independent of that signal chain.

function whisperHttps(
  apiKey: string,
  boundary: string,
  body: Buffer,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = nodeHttpsRequest(
      {
        hostname:   'api.openai.com',
        port:       443,
        servername: 'api.openai.com',
        path:       '/v1/audio/transcriptions',
        method:     'POST',
        // Provide Content-Length so Node uses a plain HTTP/1.1 request body
        // (no chunked framing).  Setting Transfer-Encoding: chunked manually
        // causes Node to emit the header twice — once from the options object
        // and once from its own internal framing — which produces a malformed
        // request that OpenAI's TLS stack rejects with bad_record_mac (alert 20).
        headers: {
          Authorization:  `Bearer ${apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.byteLength,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if ((res.statusCode ?? 200) >= 400) {
            try {
              const parsed = JSON.parse(text) as { error?: { message?: string } };
              reject(new Error(parsed.error?.message ?? `Whisper error ${res.statusCode}`));
            } catch {
              reject(new Error(`Whisper error ${res.statusCode}: ${text.slice(0, 200)}`));
            }
          } else {
            resolve(text.trim());
          }
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

function buildMultipartBody(boundary: string, mp3Bytes: Buffer): Buffer {
  const CRLF = '\r\n';
  const parts = [
    `--${boundary}${CRLF}`,
    `Content-Disposition: form-data; name="file"; filename="audio.mp3"${CRLF}`,
    `Content-Type: audio/mpeg${CRLF}${CRLF}`,
  ].join('');
  const tail = [
    `${CRLF}--${boundary}${CRLF}Content-Disposition: form-data; name="model"${CRLF}${CRLF}whisper-1`,
    `${CRLF}--${boundary}${CRLF}Content-Disposition: form-data; name="response_format"${CRLF}${CRLF}text`,
    `${CRLF}--${boundary}--${CRLF}`,
  ].join('');
  return Buffer.concat([Buffer.from(parts), mp3Bytes, Buffer.from(tail)]);
}

async function transcribeFile(apiKey: string, filePath: string): Promise<string> {
  const mp3Bytes = await readFile(filePath);
  const boundary = `----WB${randomBytes(16).toString('hex')}`;
  const body     = buildMultipartBody(boundary, mp3Bytes);
  console.log('[transcribe] Sending', Math.round(body.byteLength / 1024), 'KB to Whisper…');
  return whisperHttps(apiKey, boundary, body);
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.startsWith('sk-')) {
    return NextResponse.json({ error: 'Service is not configured.' }, { status: 503 });
  }

  const id        = randomBytes(8).toString('hex');
  const inputPath = join(tmpdir(), `transcribe_in_${id}`);  // extension added after we know mime
  const segDir    = join(tmpdir(), `transcribe_segs_${id}`);

  try {
    await mkdir(segDir, { recursive: true });

    // ── Parse multipart upload and write to disk ──────────────────────────
    console.log('[transcribe] Parsing upload…');
    let saved: SavedFile;
    try {
      saved = await saveUploadToDisk(req, inputPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[transcribe] Upload failed:', msg);
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const { mimeType, filename, size } = saved;
    console.log('[transcribe] Saved:', filename, '| type:', mimeType, '| size:', Math.round(size / 1024), 'KB');

    // ── Validate ─────────────────────────────────────────────────────────
    if (size === 0) {
      return NextResponse.json({ error: 'The selected file is empty.' }, { status: 400 });
    }
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      console.warn('[transcribe] Rejected MIME:', mimeType);
      return NextResponse.json(
        { error: 'Unsupported format. Accepted: MP4, MOV, WebM, MP3, WAV, OGG, FLAC.' },
        { status: 415 },
      );
    }

    // ── Decide whether to split or send directly ─────────────────────────
    const isSmallAudio = mimeType.startsWith('audio/') && size <= WHISPER_CHUNK_BYTES;
    let segments: string[];

    if (isSmallAudio) {
      segments = [inputPath];
      console.log('[transcribe] Small audio — sending directly');
    } else {
      console.log('[transcribe] Running ffmpeg to extract + segment audio…');
      segments = await splitToMp3Segments(inputPath, segDir);
      console.log('[transcribe]', segments.length, 'segment(s) produced');
    }

    // ── Guard: no segment must exceed Whisper's 25 MB hard limit ─────────
    for (const seg of segments) {
      const { size: segSize } = await stat(seg);
      if (segSize > WHISPER_CHUNK_BYTES) {
        throw new Error(
          `A segment is ${Math.round(segSize / 1024 / 1024)} MB — exceeds the 25 MB Whisper limit. ` +
          'Try a shorter video or lower-bitrate source.',
        );
      }
    }

    // ── Transcribe each segment serially ─────────────────────────────────
    const parts: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      console.log(`[transcribe] Whisper ${i + 1}/${segments.length}`);
      parts.push(await transcribeFile(apiKey, segments[i]));
    }

    const transcript = parts.join(' ');
    console.log('[transcribe] Done —', segments.length, 'chunk(s),', transcript.length, 'chars');
    return NextResponse.json({ transcript });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const cause   = err instanceof Error && (err as NodeJS.ErrnoException).cause;
    console.error('[transcribe] Error:', message, cause ? `| cause: ${cause}` : '');
    return NextResponse.json({ error: `Transcription failed: ${message}` }, { status: 500 });

  } finally {
    await unlink(inputPath).catch(() => {});
    await rm(segDir, { recursive: true, force: true }).catch(() => {});
  }
}

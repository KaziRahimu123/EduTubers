import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink, readFile, readdir, rm, access, mkdir, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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

async function saveFileToDisk(file: File, destPath: string): Promise<SavedFile> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`"${file.name}" must be ${MAX_FILE_MB} MB or smaller.`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  await writeFile(destPath, bytes);
  return {
    path:     destPath,
    mimeType: file.type || 'application/octet-stream',
    filename: file.name || 'upload',
    size:     file.size,
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

// ── Send one MP3 segment to Whisper via native fetch ─────────────────────────
// Using native fetch + FormData avoids the hand-rolled multipart framing that
// triggered SSL alert 20 (bad_record_mac) with node:https.  The browser-side
// AbortSignal concern does not apply here — this runs server-side in a Route
// Handler where Next.js does not propagate the incoming request signal to
// outgoing fetch() calls made inside the same handler invocation.

async function transcribeChunkWithFetch(apiKey: string, mp3Bytes: Buffer): Promise<string> {
  const form = new FormData();
  const blob = new Blob([Uint8Array.from(mp3Bytes)], { type: 'audio/mpeg' });
  form.append('file', blob, 'audio.mp3');
  form.append('model', 'whisper-1');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method:  'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body:    form,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Whisper error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = await res.json() as { text: string };
  return json.text || '';
}

async function transcribeAudioFile(apiKey: string, filePath: string): Promise<string> {
  const mp3Bytes = await readFile(filePath);
  console.log('[transcribe] Sending', Math.round(mp3Bytes.byteLength / 1024), 'KB to Whisper…');
  return transcribeChunkWithFetch(apiKey, mp3Bytes);
}

// ── Core transcription logic for a single File object ────────────────────────

async function transcribeSingleFile(
  apiKey: string,
  file: File,
  inputPath: string,
  segDir: string,
): Promise<string> {
  const saved = await saveFileToDisk(file, inputPath);
  const { mimeType, filename, size } = saved;

  console.log('[transcribe] Saved:', filename, '| type:', mimeType, '| size:', Math.round(size / 1024), 'KB');

  if (size === 0) throw new Error('The selected file is empty.');
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error('Unsupported format. Accepted: MP4, MOV, WebM, MP3, WAV, OGG, FLAC.');
  }

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

  for (const seg of segments) {
    const { size: segSize } = await stat(seg);
    if (segSize > WHISPER_CHUNK_BYTES) {
      throw new Error(
        `A segment is ${Math.round(segSize / 1024 / 1024)} MB — exceeds the 25 MB Whisper limit. ` +
        'Try a shorter video or lower-bitrate source.',
      );
    }
  }

  const parts: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    console.log(`[transcribe] Whisper ${i + 1}/${segments.length}`);
    parts.push(await transcribeAudioFile(apiKey, segments[i]));
  }

  const transcript = parts.join(' ');
  console.log('[transcribe] Done —', segments.length, 'chunk(s),', transcript.length, 'chars');
  return transcript;
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.startsWith('sk-')) {
    return NextResponse.json({ error: 'Service is not configured.' }, { status: 503 });
  }

  const id = randomBytes(8).toString('hex');

  try {
    const formData = await req.formData();

    // ── Multi-file path: `files[]` field ─────────────────────────────────────
    const multiEntries = formData.getAll('files[]') as (File | null)[];
    const multiFiles   = multiEntries.filter((f): f is File => f instanceof File);

    if (multiFiles.length > 0) {
      // Process each file sequentially to avoid swamping ffmpeg/Whisper
      const results: { filename: string; transcript: string }[] = [];

      for (let i = 0; i < multiFiles.length; i++) {
        const file      = multiFiles[i];
        const inputPath = join(tmpdir(), `transcribe_in_${id}_${i}`);
        const segDir    = join(tmpdir(), `transcribe_segs_${id}_${i}`);

        try {
          await mkdir(segDir, { recursive: true });
          console.log(`[transcribe] Multi-file ${i + 1}/${multiFiles.length}: ${file.name}`);
          const transcript = await transcribeSingleFile(apiKey, file, inputPath, segDir);
          results.push({ filename: file.name, transcript });
        } finally {
          await unlink(inputPath).catch(() => {});
          await rm(segDir, { recursive: true, force: true }).catch(() => {});
        }
      }

      return NextResponse.json({ results });
    }

    // ── Single-file path: legacy `file` / `video` field ──────────────────────
    const inputPath = join(tmpdir(), `transcribe_in_${id}`);
    const segDir    = join(tmpdir(), `transcribe_segs_${id}`);

    try {
      await mkdir(segDir, { recursive: true });

      const entry = formData.get('file') ?? formData.get('video');
      if (!entry || !(entry instanceof File)) {
        return NextResponse.json({ error: 'No file field found in the upload.' }, { status: 400 });
      }

      console.log('[transcribe] Single-file upload:', (entry as File).name);
      const transcript = await transcribeSingleFile(apiKey, entry as File, inputPath, segDir);
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

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[transcribe] Upload parse error:', message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

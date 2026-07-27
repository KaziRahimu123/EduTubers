import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink, readFile, readdir, rm, access, mkdir, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import { adminClient } from '@/lib/supabase';

const execFileAsync = promisify(execFile);

// Whisper hard limit per request is 25 MB. Use 23 MB as safety ceiling.
const WHISPER_CHUNK_BYTES = 23 * 1024 * 1024;
const MAX_FILE_MB    = 100;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

// 20-minute segments — at 64 kbps mono that's ~9.6 MB, well under the 25 MB Whisper limit
const SEGMENT_DURATION_SECS = 1200;

export const maxDuration = 60;

interface SavedFile {
  path: string;
  mimeType: string;
  filename: string;
  size: number;
}

async function saveFileToDisk(file: File, destPath: string): Promise<SavedFile> {
  const fileStat = await stat(destPath).catch(() => null);
  const size = fileStat ? fileStat.size : file.size;

  if (size > MAX_FILE_BYTES) {
    throw new Error(`"${file.name || 'File'}" must be ${MAX_FILE_MB} MB or smaller.`);
  }

  if (!fileStat && file.size > 0) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await writeFile(destPath, bytes);
  }

  return {
    path:     destPath,
    mimeType: file.type || 'application/octet-stream',
    filename: file.name || 'upload',
    size,
  };
}

// ── Resolve a working ffmpeg binary ──────────────────────────────────────────

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
  throw new Error('ffmpeg not found.');
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
  const { filename, size } = saved;

  console.log('[transcribe] Saved:', filename, '| size:', Math.round(size / 1024), 'KB');
  if (size === 0) throw new Error('The selected file is empty.');

  console.log('[transcribe] Running ffmpeg to extract + segment audio…');
  const segments = await splitToMp3Segments(inputPath, segDir);
  console.log('[transcribe]', segments.length, 'segment(s) produced');

  for (const seg of segments) {
    const { size: segSize } = await stat(seg);
    if (segSize > WHISPER_CHUNK_BYTES) {
      throw new Error(
        `A segment is ${Math.round(segSize / 1024 / 1024)} MB — exceeds the 25 MB Whisper limit.`,
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

    // ── Chunked reassembly from Supabase Storage (uploadId + totalChunks) ────
    const uploadId    = formData.get('uploadId') as string | null;
    const totalChunks = parseInt((formData.get('totalChunks') as string) || '0', 10);
    const filename    = (formData.get('filename') as string) || 'video.mov';

    if (uploadId && totalChunks > 0) {
      const sanitizedId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '');
      const inputPath   = join(tmpdir(), `transcribe_in_${sanitizedId}`);
      const segDir      = join(tmpdir(), `transcribe_segs_${sanitizedId}`);
      const sb          = adminClient();

      const chunkBuffers: Buffer[] = [];
      const removePaths: string[] = [];

      try {
        console.log(`[transcribe] Fetching ${totalChunks} storage chunk(s) for ${sanitizedId}…`);
        for (let i = 0; i < totalChunks; i++) {
          const storagePath = `transcribe_chunks/${sanitizedId}/${i}`;
          removePaths.push(storagePath);

          const { data, error } = await sb.storage.from('images').download(storagePath);
          if (error || !data) {
            throw new Error(`Failed to download chunk ${i}/${totalChunks}: ${error?.message || 'Empty chunk'}`);
          }
          const buf = Buffer.from(await data.arrayBuffer());
          chunkBuffers.push(buf);
        }

        const fullBuffer = Buffer.concat(chunkBuffers);
        console.log(`[transcribe] Reassembled ${filename}: ${(fullBuffer.byteLength / 1024 / 1024).toFixed(1)} MB`);

        await writeFile(inputPath, fullBuffer);
        await mkdir(segDir, { recursive: true });

        const mockFile = new File([], filename, { type: 'video/quicktime' });
        const transcript = await transcribeSingleFile(apiKey, mockFile, inputPath, segDir);
        return NextResponse.json({ transcript });
      } finally {
        await unlink(inputPath).catch(() => {});
        await rm(segDir, { recursive: true, force: true }).catch(() => {});
        if (removePaths.length > 0) {
          await sb.storage.from('images').remove(removePaths).catch(() => {});
        }
      }
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
      console.error('[transcribe] Error:', message);
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

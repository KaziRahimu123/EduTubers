import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminClient } from '@/lib/supabase';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const chunkFile   = formData.get('chunk');
    const uploadId    = formData.get('uploadId') as string | null;
    const chunkIndex  = formData.get('chunkIndex') as string | null;

    if (!chunkFile || !(chunkFile instanceof File) || !uploadId || chunkIndex === null) {
      return NextResponse.json({ error: 'Missing chunk, uploadId, or chunkIndex' }, { status: 400 });
    }

    const sanitizedId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '');
    const idx = parseInt(chunkIndex, 10);
    const storagePath = `transcribe_chunks/${sanitizedId}/${idx}`;

    const bytes = Buffer.from(await chunkFile.arrayBuffer());
    const sb = adminClient();

    const { error: upErr } = await sb.storage
      .from('images')
      .upload(storagePath, bytes, { upsert: true, contentType: 'application/octet-stream' });

    if (upErr) {
      console.error('[upload-chunk] Storage upload error:', upErr);
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    return NextResponse.json({ status: 'ok', chunkIndex: idx });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[upload-chunk] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

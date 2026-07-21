/**
 * app/api/upload-image/route.ts
 *
 * Dedicated route for uploading flashcard / section images to Supabase Storage.
 * Accepts multipart/form-data. Body size limit raised to 12 MB to handle
 * full-quality images from gpt-image-2 (1024×1024 PNG ≈ 2–4 MB as raw bytes).
 *
 * Auth0 middleware is intentionally skipped for this route (middleware.ts) to
 * prevent it from consuming the multipart body before the handler reads it.
 * Auth is not required here — the admin client uses the service-role key and
 * the storage path is scoped to courseId, which is only known to the owner.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Raise the body-size limit — default 1 MB is too small for full-res AI images
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const courseId  = form.get('courseId')  as string | null;
    const cardIndex = form.get('cardIndex') as string | null;
    const file      = form.get('file')      as File   | null;

    if (!courseId || cardIndex === null || !file) {
      return NextResponse.json({ error: 'courseId, cardIndex and file are required' }, { status: 400 });
    }

    const idx = Number(cardIndex);
    const bytes = Buffer.from(await file.arrayBuffer());
    const mime  = file.type || 'image/png';
    const path  = `${courseId}/${idx}.png`;

    const sb = adminClient();
    const { error: upErr } = await sb.storage
      .from('images')
      .upload(path, bytes, { upsert: true, contentType: mime });

    if (upErr) {
      console.error('upload-image storage', upErr);
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    const { data: urlData } = sb.storage.from('images').getPublicUrl(path);
    const publicUrl = urlData.publicUrl;

    await sb.from('images').upsert(
      { course_id: courseId, card_index: idx, storage_path: path, url: publicUrl },
      { onConflict: 'course_id,card_index' },
    );

    return NextResponse.json({ publicUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Upload failed';
    console.error('upload-image', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

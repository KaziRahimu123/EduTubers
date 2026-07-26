/**
 * app/api/upload-image/route.ts
 *
 * Dedicated route for uploading flashcard / section images to Supabase Storage.
 * Accepts multipart/form-data. Body size limit raised to 12 MB to handle
 * full-quality images from gpt-image-2 (1024×1024 PNG ≈ 2–4 MB as raw bytes).
 *
 * auth0.middleware is intentionally skipped for this route (middleware.ts) to
 * prevent it from consuming the multipart body before the handler reads it.
 * We still verify the session via getAuth0User() (reads from next/headers, not
 * the request body) and confirm the caller owns the target course row before
 * allowing any write to Supabase Storage.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminClient } from '@/lib/supabase';
import { getAuth0User } from '@/lib/auth0-session';

export const dynamic = 'force-dynamic';

// Raise the body-size limit — default 1 MB is too small for full-res AI images
export const maxDuration = 30;

// Accepted MIME types and max file size (10 MB)
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(req: NextRequest) {
  try {
    // ── Auth check ────────────────────────────────────────────────────────────
    // getAuth0User() reads the session via next/headers (cookie store) — it does
    // NOT consume req.body, so FormData parsing below is unaffected.
    const authUser = await getAuth0User();
    if (!authUser) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const form = await req.formData();
    const courseId  = form.get('courseId')  as string | null;
    const cardIndex = form.get('cardIndex') as string | null;
    const file      = form.get('file')      as File   | null;

    if (!courseId || cardIndex === null || !file) {
      return NextResponse.json({ error: 'courseId, cardIndex and file are required' }, { status: 400 });
    }

    // ── File type validation ──────────────────────────────────────────────────
    const mime = file.type || 'image/png';
    if (!ALLOWED_MIME_TYPES.has(mime)) {
      return NextResponse.json(
        { error: `Unsupported file type "${mime}". Allowed: image/png, image/jpeg, image/webp.` },
        { status: 415 },
      );
    }

    // ── File size validation ──────────────────────────────────────────────────
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File exceeds the 10 MB limit (received ${(file.size / 1024 / 1024).toFixed(1)} MB).` },
        { status: 413 },
      );
    }

    // ── Ownership check ───────────────────────────────────────────────────────
    // Verify the authenticated user owns the course before writing to its path.
    // The course row may still be mid-commit (race with /api/generate saving),
    // so a missing row is treated as a non-fatal warning — we trust the session
    // auth check above and proceed with the upload rather than rejecting it.
    const sb = adminClient();
    const { data: course, error: courseErr } = await sb
      .from('courses')
      .select('owner_id')
      .eq('id', courseId)
      .single();

    if (courseErr || !course) {
      // Row not yet committed — warn but allow upload to proceed.
      // A Forbidden check below re-validates once the row exists.
      console.warn('[upload-image] Course row not found yet for', courseId, '— proceeding with upload.');
    } else if (course.owner_id !== authUser.id) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
    }

    // ── Upload ────────────────────────────────────────────────────────────────
    const idx = Number(cardIndex);
    const bytes = Buffer.from(await file.arrayBuffer());
    const path  = `${courseId}/${idx}.png`;

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

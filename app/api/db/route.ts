/**
 * app/api/db/route.ts
 *
 * Server-side database proxy for Auth0-authenticated users.
 * The browser cannot write to Supabase directly (no Supabase JWT),
 * so all mutating operations are routed here.
 * Auth is verified via the Auth0 session cookie on every request.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuth0User } from '@/lib/auth0-session';
import { adminClient } from '@/lib/supabase';

// Allow large request bodies for base64 image uploads (~2–4 MB per image)
export const dynamic = 'force-dynamic';

// ── helpers ──────────────────────────────────────────────────────────────────

function ok(data: unknown) { return NextResponse.json({ data }); }
function err(msg: string, status = 400) { return NextResponse.json({ error: msg }, { status }); }

export async function POST(req: NextRequest) {
  const user = await getAuth0User();
  if (!user) return err('Not authenticated', 401);

  const body = await req.json() as { op: string; payload: Record<string, unknown> };
  const { op, payload } = body;
  const sb = adminClient();

  // ── upsert_course ─────────────────────────────────────────────────────────
  if (op === 'upsert_course') {
    const row = { ...(payload as Record<string, unknown>), owner_id: user.id };

    // Attempt full upsert first (works once the brand_kit migration has been run).
    // If Supabase reports the column is missing in its schema cache, retry without
    // brand_kit so existing deployments keep working until the migration is applied.
    let { error } = await sb.from('courses').upsert(row, { onConflict: 'id' });
    if (error?.message?.includes('brand_kit')) {
      const { brand_kit: _dropped, ...rowWithout } = row as Record<string, unknown> & { brand_kit?: unknown };
      void _dropped;
      ({ error } = await sb.from('courses').upsert(rowWithout, { onConflict: 'id' }));
    }
    if (error) { console.error('upsert_course', error); return err(error.message); }
    return ok(null);
  }

  // ── delete_course ─────────────────────────────────────────────────────────
  if (op === 'delete_course') {
    const id = payload.id as string;
    // Clean up storage images first
    const { data: imgRows } = await sb.from('images').select('storage_path').eq('course_id', id);
    if (imgRows?.length) {
      await sb.storage.from('images').remove(imgRows.map(r => r.storage_path as string));
    }
    await sb.from('images').delete().eq('course_id', id);
    const { error } = await sb.from('courses').delete().eq('id', id).eq('owner_id', user.id);
    if (error) { console.error('delete_course', error); return err(error.message); }
    return ok(null);
  }

  // ── add_review ────────────────────────────────────────────────────────────
  if (op === 'add_review') {
    const { courseId, name, comment, rating } = payload as { courseId: string; name: string; comment: string; rating?: number };
    const { data, error } = await sb
      .from('quiz_reviews')
      .insert({ course_id: courseId, name, comment, rating: rating ?? null })
      .select()
      .single();
    if (error || !data) { console.error('add_review', error); return err(error?.message ?? 'failed'); }
    return ok({ id: data.id, deckId: data.course_id, name: data.name, comment: data.comment, createdAt: data.created_at });
  }

  // ── save_quiz_attempt ─────────────────────────────────────────────────────
  if (op === 'save_quiz_attempt') {
    const a = payload;
    const { error } = await sb.from('quiz_attempts').insert({
      quiz_id:          a.quizId,
      taker_id:         null, // anonymous for now
      answers:          a.answers,
      score:            a.score,
      total:            a.total,
      percentage_score: a.percentageScore,
      passed:           a.passed,
      attempt_number:   a.attemptNumber,
      completed_at:     a.completedAt,
    });
    if (error) { console.error('save_quiz_attempt', error); return err(error.message); }
    return ok(null);
  }

  // ── make_slug ─────────────────────────────────────────────────────────────
  if (op === 'make_slug') {
    const { title, existingCourseId } = payload as { title: string; existingCourseId?: string };
    const base = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim()
      .replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'deck';
    let query = sb.from('courses').select('slug').not('slug', 'is', null);
    if (existingCourseId) query = query.neq('id', existingCourseId);
    const { data } = await query;
    const taken = new Set((data ?? []).map((r: { slug: string }) => r.slug));
    let slug = base;
    let n = 2;
    while (taken.has(slug)) { slug = `${base}-${n}`; n++; }
    return ok({ slug });
  }

  return err(`Unknown operation: ${op}`, 400);
}

/**
 * app/api/db/route.ts
 *
 * Server-side database proxy for Auth0-authenticated users.
 * The browser cannot write to Supabase directly (no Supabase JWT),
 * so all mutating operations are routed here.
 * Auth is verified via the Auth0 session cookie on every request.
 */

import { request as nodeHttpsRequest } from 'node:https';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuth0User } from '@/lib/auth0-session';
import { adminClient } from '@/lib/supabase';

// Allow large request bodies for base64 image uploads (~2–4 MB per image)
export const dynamic = 'force-dynamic';

// ── helpers ──────────────────────────────────────────────────────────────────

function ok(data: unknown) { return NextResponse.json({ data }); }
function err(msg: string, status = 400) { return NextResponse.json({ error: msg }, { status }); }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function supabaseRestGetCourses(sbUrl: string, serviceKey: string): Promise<any[]> {
  return new Promise((resolve) => {
    const parsed = new URL(`${sbUrl}/rest/v1/courses?select=*&order=updated_at.desc`);
    const req = nodeHttpsRequest(
      {
        hostname: parsed.hostname,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          const text = Buffer.concat(chunks).toString('utf8');
          if (status >= 200 && status < 300) {
            try { resolve(JSON.parse(text)); } catch { resolve([]); }
          } else {
            console.error('[get_courses REST error]', status, text);
            resolve([]);
          }
        });
        res.on('error', () => resolve([]));
      },
    );
    req.on('error', () => resolve([]));
    req.end();
  });
}

export async function POST(req: NextRequest) {
  let body: { op: string; payload: Record<string, unknown> };
  try {
    body = await req.json() as { op: string; payload: Record<string, unknown> };
  } catch {
    return err('Invalid or missing JSON body', 400);
  }
  const { op, payload } = body;
  const sb = adminClient();

  // ── PUBLIC OPS — no session required ─────────────────────────────────────
  // These only write to tables that already have open RLS insert policies
  // (quiz_reviews, quiz_attempts, task_attempts) for published courses.

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
      taker_id:         null,
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

  // ── save_task_attempt ─────────────────────────────────────────────────────
  if (op === 'save_task_attempt') {
    const a = payload;
    const { error } = await sb.from('task_attempts').insert({
      course_id:        a.courseId,
      taker_name:       (a.takerName as string) || null,
      results:          a.results,
      correct_count:    a.correctCount,
      total_count:      a.totalCount,
      percentage_score: a.percentageScore,
      completed_at:     a.completedAt,
    });
    if (error) { console.error('save_task_attempt', error); return err(error.message); }
    return ok(null);
  }

  // ── increment_views ───────────────────────────────────────────────────────
  if (op === 'increment_views') {
    const { courseId } = payload as { courseId: string };
    const { data: row } = await sb
      .from('courses')
      .select('views')
      .eq('id', courseId)
      .single();
    if (!row) return ok(null); // course not found — ignore silently
    const { error } = await sb
      .from('courses')
      .update({ views: (row.views ?? 0) + 1 })
      .eq('id', courseId);
    if (error) { console.error('increment_views', error); return err(error.message); }
    return ok(null);
  }

  // ── increment_completions ─────────────────────────────────────────────────
  if (op === 'increment_completions') {
    const { courseId } = payload as { courseId: string };
    const { data: row } = await sb
      .from('courses')
      .select('completions')
      .eq('id', courseId)
      .single();
    if (!row) return ok(null); // course not found — ignore silently
    const { error } = await sb
      .from('courses')
      .update({ completions: (row.completions ?? 0) + 1 })
      .eq('id', courseId);
    if (error) { console.error('increment_completions', error); return err(error.message); }
    return ok(null);
  }

  // ── get_courses ───────────────────────────────────────────────────────────
  if (op === 'get_courses') {
    const sbUrl      = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
    const rows = await supabaseRestGetCourses(sbUrl, serviceKey);
    return ok(rows);
  }

  // ── CREATOR OPS — session required ────────────────────────────────────────
  const user = await getAuth0User();
  if (!user) return err('Not authenticated', 401);

  // ── get_course ────────────────────────────────────────────────────────────
  if (op === 'get_course') {
    const { id } = payload as { id: string };
    const { data, error } = await sb.from('courses').select('*').eq('id', id).eq('owner_id', user.id).single();
    if (error || !data) return ok(null);
    return ok(data);
  }

  // ── upsert_course ─────────────────────────────────────────────────────────
  if (op === 'upsert_course') {
    const row = { ...(payload as Record<string, unknown>), owner_id: user.id };

    const { error } = await sb.from('courses').upsert(row, { onConflict: 'id' });
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

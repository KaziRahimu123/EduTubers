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
import { adminClient, supabase } from '@/lib/supabase';

// Allow large request bodies for base64 image uploads (~2–4 MB per image)
export const dynamic = 'force-dynamic';

// ── helpers ──────────────────────────────────────────────────────────────────

function ok(data: unknown) { return NextResponse.json({ data }); }
function err(msg: string, status = 400) { return NextResponse.json({ error: msg }, { status }); }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function supabaseRestGetTable(sbUrl: string, serviceKey: string, table: string, queryParams: string): Promise<any[]> {
  return new Promise((resolve) => {
    const parsed = new URL(`${sbUrl}/rest/v1/${table}?${queryParams}`);
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
            console.error(`[${table} REST error]`, status, text);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function supabaseRestGetCourses(sbUrl: string, serviceKey: string, ownerId?: string, userSub?: string): Promise<any[]> {
  return new Promise((resolve) => {
    const subVal = userSub || ownerId || '';
    const ownerFilter = ownerId
      ? `&or=(owner_id.eq.${encodeURIComponent(ownerId)},owner_id.eq.${encodeURIComponent(subVal)},owner_id.is.null)`
      : '';
    const parsed = new URL(`${sbUrl}/rest/v1/courses?select=*${ownerFilter}&order=updated_at.desc`);
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

function supabaseRestInsert(sbUrl: string, serviceKey: string, table: string, row: Record<string, unknown>): Promise<{ error: string | null }> {
  return new Promise((resolve) => {
    const parsed = new URL(`${sbUrl}/rest/v1/${table}`);
    const body = JSON.stringify(row);
    const req = nodeHttpsRequest(
      {
        hostname: parsed.hostname,
        path: `${parsed.pathname}`,
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            resolve({ error: null });
          } else {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({ error: text });
          }
        });
        res.on('error', (e) => resolve({ error: e.message }));
      },
    );
    req.on('error', (e) => resolve({ error: e.message }));
    req.write(body);
    req.end();
  });
}

export async function POST(req: NextRequest) {
  let body: { op?: string; payload?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return err('Invalid JSON body', 400);
  }

  const { op, payload = {} } = body;
  if (!op) return err('Missing op', 400);

  const sb = typeof adminClient === 'function' ? adminClient() : supabase;
  const sbUrl      = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  // ── PUBLIC / VISITOR READS & WRITES (no session required) ──────────────────

  // ── get_public_course (by slug or id) ──────────────────────────────────────
  if (op === 'get_public_course') {
    const { identifier } = payload as { identifier: string };
    const { data: bySlug } = await sb.from('courses').select('*').eq('slug', identifier).single();
    if (bySlug) return ok(bySlug);
    const { data: byId } = await sb.from('courses').select('*').eq('id', identifier).single();
    return ok(byId ?? null);
  }

  // ── get_reviews ───────────────────────────────────────────────────────────
  if (op === 'get_reviews') {
    const { courseId, slug } = payload as { courseId: string; slug?: string };
    const targets = Array.from(new Set([courseId, slug].filter(Boolean))) as string[];
    const filter = targets.map(t => `course_id.eq.${encodeURIComponent(t)}`).join(',');
    const rows = await supabaseRestGetTable(
      sbUrl,
      serviceKey,
      'flashcard_reviews',
      `select=id,course_id,name,comment,created_at&or=(${filter})&order=created_at.desc`,
    );
    const mapped = rows.map((r: { id: string; course_id: string; name: string; comment: string; created_at: string }) => ({
      id: r.id, deckId: r.course_id, name: r.name, comment: r.comment, createdAt: r.created_at,
    }));
    return ok(mapped);
  }

  // ── get_quiz_attempts ─────────────────────────────────────────────────────
  if (op === 'get_quiz_attempts') {
    const { quizId } = payload as { quizId: string };
    const rows = await supabaseRestGetTable(
      sbUrl,
      serviceKey,
      'quiz_attempts',
      `select=id,quiz_id,answers,score,total,percentage_score,passed,attempt_number,completed_at&quiz_id=eq.${encodeURIComponent(quizId)}&order=completed_at.desc`,
    );
    const mapped = rows.map((r: { id: string; quiz_id: string; answers: unknown; score: number; total: number; percentage_score: number; passed: boolean; attempt_number: number; completed_at: string }) => ({
      id: r.id, quizId: r.quiz_id, answers: r.answers, score: r.score, total: r.total, percentageScore: r.percentage_score, passed: r.passed, attemptNumber: r.attempt_number, completedAt: r.completed_at,
    }));
    return ok(mapped);
  }

  // ── get_task_attempts ─────────────────────────────────────────────────────
  if (op === 'get_task_attempts') {
    const { courseId } = payload as { courseId: string };
    const rows = await supabaseRestGetTable(
      sbUrl,
      serviceKey,
      'task_attempts',
      `select=id,course_id,taker_name,results,correct_count,total_count,percentage_score,completed_at&course_id=eq.${encodeURIComponent(courseId)}&order=completed_at.desc`,
    );
    const mapped = rows.map((r: { id: string; course_id: string; taker_name: string | null; results: unknown; correct_count: number; total_count: number; percentage_score: number; completed_at: string }) => ({
      id: r.id, courseId: r.course_id, takerName: r.taker_name, results: r.results, correctCount: r.correct_count, totalCount: r.total_count, percentageScore: r.percentage_score, completedAt: r.completed_at,
    }));
    return ok(mapped);
  }

  // ── add_review ────────────────────────────────────────────────────────────
  if (op === 'add_review') {
    const { deckId, name, comment } = payload as { deckId: string; name: string; comment: string };
    let realCourseId = deckId;

    // Resolve course.id if deckId passed was a slug
    try {
      const courseRows = await supabaseRestGetTable(
        sbUrl,
        serviceKey,
        'courses',
        `select=id&or=(id.eq.${encodeURIComponent(deckId)},slug.eq.${encodeURIComponent(deckId)})&limit=1`,
      );
      if (courseRows?.[0]?.id) {
        realCourseId = courseRows[0].id;
      }
    } catch {
      /* noop */
    }

    const reviewId = 'rev_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const { error } = await supabaseRestInsert(sbUrl, serviceKey, 'flashcard_reviews', {
      id:          reviewId,
      course_id:   realCourseId,
      name:        name || 'Anonymous',
      comment:     comment || '',
      created_at:  new Date().toISOString(),
    });

    if (error) {
      console.error('[add_review REST error]', error);
    }

    return ok({ id: reviewId, deckId: realCourseId, name: name || 'Anonymous', comment, createdAt: new Date().toISOString() });
  }

  // ── save_quiz_attempt ─────────────────────────────────────────────────────
  if (op === 'save_quiz_attempt') {
    const a = payload;
    const { error } = await supabaseRestInsert(sbUrl, serviceKey, 'quiz_attempts', {
      quiz_id:          a.quizId,
      taker_id:         null,
      answers:          a.answers ?? [],
      score:            a.score ?? 0,
      total:            a.total ?? 0,
      percentage_score: a.percentageScore ?? 0,
      passed:           a.passed ?? false,
      attempt_number:   a.attemptNumber ?? 1,
      completed_at:     a.completedAt ?? new Date().toISOString(),
    });
    if (error) console.error('[save_quiz_attempt REST error]', error);
    return ok(null);
  }

  // ── save_task_attempt ─────────────────────────────────────────────────────
  if (op === 'save_task_attempt') {
    const a = payload;
    const { error } = await supabaseRestInsert(sbUrl, serviceKey, 'task_attempts', {
      course_id:        a.courseId,
      taker_name:       (a.takerName as string) || null,
      results:          a.results ?? [],
      correct_count:    a.correctCount ?? 0,
      total_count:      a.totalCount ?? 0,
      percentage_score: a.percentageScore ?? 0,
      completed_at:     a.completedAt ?? new Date().toISOString(),
    });
    if (error) console.error('[save_task_attempt REST error]', error);
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

  // ── CREATOR OPS — session required ────────────────────────────────────────
  const user = await getAuth0User();
  if (!user) return err('Not authenticated', 401);

  // ── get_courses (filtered by owner_id or user.sub) ─────────────────────────
  if (op === 'get_courses') {
    const rows = await supabaseRestGetCourses(sbUrl, serviceKey, user.id, user.sub);
    return ok(rows);
  }

  // ── get_course ────────────────────────────────────────────────────────────
  if (op === 'get_course') {
    const { id } = payload as { id: string };
    const { data, error } = await sb.from('courses').select('*').eq('id', id).single();
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
    const { error } = await sb.from('courses').delete().eq('id', id);
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

'use client';

/**
 * lib/db.ts — async data access layer backed by Supabase.
 * Auth is handled by Auth0; the user ID is read from /api/auth/me.
 * All mutating operations (writes/deletes) are proxied through /api/db
 * because the browser has no Supabase JWT when using Auth0.
 * Reads use the anon key directly (row filtering is done in queries).
 */

import { supabase } from './supabase';
import type {
  Course, FeedbackComment, FlashcardReview,
  QuizAttemptResult, QuizAttemptAnswer,
} from './types';

// ── uid ───────────────────────────────────────────────────────────────────────

export function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── Row ↔ Domain converters ───────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToCourse(row: any): Course {
  return {
    id:                       row.id,
    title:                    row.title,
    description:              row.description,
    contentType:              row.content_type,
    learnerLevel:             row.learner_level,
    status:                   row.status,
    slug:                     row.slug ?? undefined,
    shareText:                row.share_text,
    creatorImprovementNotes:  row.creator_improvement_notes,
    views:                    row.views,
    completions:              row.completions,
    learningGoals:            row.learning_goals ?? [],
    modules:                  row.modules ?? [],
    finalProject:             row.final_project ?? { title: '', description: '', deliverables: [] },
    flashcardOptions:         row.flashcard_options ?? undefined,
    quizConfig:               row.quiz_config ?? undefined,
    taskConfig:               row.task_config ?? undefined,
    creatorUsername:          row.creator_username ?? undefined,
    generateImages:           row.generate_images ?? undefined,
    brandKit:                 row.brand_kit ?? undefined,
    createdAt:                row.created_at,
    updatedAt:                row.updated_at,
  };
}

function courseToRow(course: Course, ownerId: string) {
  return {
    id:                        course.id,
    owner_id:                  ownerId,
    title:                     course.title,
    description:               course.description,
    content_type:              course.contentType,
    learner_level:             course.learnerLevel,
    status:                    course.status,
    slug:                      course.slug ?? null,
    share_text:                course.shareText,
    creator_improvement_notes: course.creatorImprovementNotes,
    views:                     course.views,
    completions:               course.completions,
    learning_goals:            course.learningGoals,
    modules:                   course.modules,
    final_project:             course.finalProject,
    flashcard_options:         course.flashcardOptions ?? null,
    quiz_config:               course.quizConfig ?? null,
    task_config:               course.taskConfig ?? null,
    creator_username:          course.creatorUsername ?? null,
    generate_images:           course.generateImages ?? null,
    brand_kit:                 course.brandKit ?? null,
    updated_at:                new Date().toISOString(),
  };
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the current user's stable UUID (derived from their Auth0 sub).
 * Calls /api/auth/me which the Auth0 SDK provides automatically.
 */
export async function getCurrentUserId(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) return null;
    const user = await res.json() as { sub?: string; edutubers_id?: string } | null;
    if (!user?.edutubers_id) return null;
    return user.edutubers_id;
  } catch {
    return null;
  }
}

// ── DB proxy (writes) ─────────────────────────────────────────────────────────

async function dbProxy<T = null>(op: string, payload: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ op, payload }),
    });
    const json = await res.json() as { data?: T; error?: string };
    if (!res.ok || json.error) { console.error(`dbProxy ${op}`, json.error); return null; }
    return (json.data ?? null) as T | null;
  } catch (e) {
    console.error(`dbProxy ${op}`, e);
    return null;
  }
}

// ── Courses ───────────────────────────────────────────────────────────────────

export async function dbGetCourses(): Promise<Course[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from('courses')
    .select('*')
    .eq('owner_id', userId)
    .order('updated_at', { ascending: false });
  if (error) { console.error('dbGetCourses', error); return []; }
  return (data ?? []).map(rowToCourse);
}

export async function dbGetCourse(id: string): Promise<Course | null> {
  const { data, error } = await supabase
    .from('courses')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !data) return null;
  return rowToCourse(data);
}

export async function dbGetCourseBySlug(slug: string): Promise<Course | null> {
  const { data, error } = await supabase
    .from('courses')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .single();
  if (error || !data) return null;
  return rowToCourse(data);
}

export async function dbSaveCourse(course: Course): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) { console.error('dbSaveCourse: no user'); return; }
  const row = courseToRow(course, userId);
  await dbProxy('upsert_course', row as Record<string, unknown>);
}

export async function dbDeleteCourse(id: string): Promise<void> {
  await dbProxy('delete_course', { id });
}

// ── Images (Supabase Storage via server proxy) ────────────────────────────────

export async function dbUploadImage(
  courseId: string,
  cardIndex: number,
  dataUrl: string,
): Promise<string | null> {
  try {
    // Convert data URL to a Blob and send as multipart/form-data to avoid
    // the JSON body size limit that causes "fetch failed" for large images.
    const [header, b64] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)?.[1] ?? 'image/png';
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: mime });

    const form = new FormData();
    form.append('courseId',   courseId);
    form.append('cardIndex',  String(cardIndex));
    form.append('file',       blob, `${cardIndex}.png`);

    // Do NOT use keepalive here — browsers cap keepalive body size at 64 KB
    // and gpt-image-2 images are 2–4 MB, which silently fails with
    // "Failed to fetch". The server route uses adminClient (independent of
    // the browser request lifecycle) so the upload will complete regardless.
    const res = await fetch('/api/upload-image', {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({})) as { error?: string };
      console.error('dbUploadImage', e.error);
      return null;
    }
    const data = await res.json() as { publicUrl?: string };
    return data.publicUrl ?? null;
  } catch (e) {
    console.error('dbUploadImage', e);
    return null;
  }
}

export async function dbGetImages(courseId: string): Promise<Record<number, string>> {
  const { data, error } = await supabase
    .from('images')
    .select('card_index, url')
    .eq('course_id', courseId);
  if (error) return {};
  const result: Record<number, string> = {};
  (data ?? []).forEach(r => { result[r.card_index] = r.url; });
  return result;
}

export async function dbDeleteImages(courseId: string): Promise<void> {
  // Handled inside delete_course operation on the server
  // Can also be called standalone for cleanup
  await dbProxy('delete_course', { id: courseId });
}

// ── Reviews ───────────────────────────────────────────────────────────────────

export async function dbGetReviews(courseId: string): Promise<FlashcardReview[]> {
  const { data, error } = await supabase
    .from('quiz_reviews')
    .select('*')
    .eq('course_id', courseId)
    .order('created_at', { ascending: false });
  if (error) return [];
  return (data ?? []).map(r => ({
    id: r.id, deckId: r.course_id, name: r.name,
    comment: r.comment, createdAt: r.created_at,
  }));
}

export async function dbAddReview(review: { courseId: string; name: string; comment: string; rating?: number }): Promise<FlashcardReview | null> {
  const result = await dbProxy<{ id: string; deckId: string; name: string; comment: string; createdAt: string }>(
    'add_review',
    { courseId: review.courseId, name: review.name, comment: review.comment, rating: review.rating },
  );
  if (!result) return null;
  return { id: result.id, deckId: result.deckId, name: result.name, comment: result.comment, createdAt: result.createdAt };
}

// ── Feedback ──────────────────────────────────────────────────────────────────

export async function dbGetFeedback(courseId: string): Promise<FeedbackComment[]> {
  const { data, error } = await supabase
    .from('quiz_reviews')
    .select('*')
    .eq('course_id', courseId)
    .not('rating', 'is', null)
    .order('created_at', { ascending: false });
  if (error) return [];
  return (data ?? []).map(r => ({
    id: r.id, courseId: r.course_id, name: r.name,
    rating: r.rating ?? 5, comment: r.comment, createdAt: r.created_at,
  }));
}

export async function dbAddFeedback(fb: Omit<FeedbackComment, 'id'>): Promise<FeedbackComment | null> {
  const result = await dbProxy<{ id: string; courseId: string; name: string; comment: string; rating: number; createdAt: string }>(
    'add_review',
    { courseId: fb.courseId, name: fb.name, comment: fb.comment, rating: fb.rating },
  );
  if (!result) return null;
  return { id: result.id, courseId: result.courseId, name: result.name, rating: result.rating ?? 5, comment: result.comment, createdAt: result.createdAt };
}

// ── Quiz Attempts ─────────────────────────────────────────────────────────────

export async function dbGetQuizAttempts(quizId: string): Promise<QuizAttemptResult[]> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('quiz_attempts')
    .select('*')
    .eq('quiz_id', quizId)
    .order('completed_at', { ascending: false });
  if (error) return [];
  return (data ?? []).map(r => ({
    id:              r.id,
    quizId:          r.quiz_id,
    answers:         r.answers as QuizAttemptAnswer[],
    score:           r.score,
    total:           r.total,
    percentageScore: r.percentage_score,
    passed:          r.passed,
    completedAt:     r.completed_at,
    attemptNumber:   r.attempt_number,
  }));
  void userId; // used for filtering in RLS context
}

export async function dbSaveQuizAttempt(attempt: QuizAttemptResult): Promise<void> {
  await dbProxy('save_quiz_attempt', attempt as unknown as Record<string, unknown>);
}

export async function dbDeleteQuizAttempts(quizId: string): Promise<void> {
  const { error } = await supabase.from('quiz_attempts').delete().eq('quiz_id', quizId);
  if (error) console.error('dbDeleteQuizAttempts', error);
}

export async function dbCountQuizAttempts(quizId: string): Promise<number> {
  const { count, error } = await supabase
    .from('quiz_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('quiz_id', quizId);
  if (error) return 0;
  return count ?? 0;
}

// ── Generation quota ──────────────────────────────────────────────────────────

/**
 * Returns how many Standard generations the current user has used in the
 * rolling 3-day window.  Calls the server-side /api/quota route so that
 * the Auth0 session cookie and the service-role key are both available
 * (direct Supabase RPC calls from the browser can fail if the session
 * isn't hydrated yet or RLS filters the row out).
 */
export async function dbGetGenUsed3Days(): Promise<number> {
  try {
    const res = await fetch('/api/quota', { credentials: 'include' });
    if (!res.ok) return 0;
    const json = await res.json() as { used?: number };
    return json.used ?? 0;
  } catch {
    return 0;
  }
}

// ── Slug helpers ──────────────────────────────────────────────────────────────

export async function dbMakeSlug(title: string, existingCourseId?: string): Promise<string> {
  const result = await dbProxy<{ slug: string }>('make_slug', { title, existingCourseId });
  if (result?.slug) return result.slug;
  // Fallback: generate locally
  const base = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim()
    .replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'deck';
  return `${base}-${Date.now().toString(36)}`;
}

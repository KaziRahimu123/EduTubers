'use client';

import type { Course, FeedbackComment, QuizAttempt, FlashcardReview, QuizAttemptResult } from './types';
import { deleteImages } from './imageStore';

const COURSES_KEY = 'be_courses';
const FEEDBACK_KEY = 'be_feedback';
const ATTEMPTS_KEY = 'be_attempts';
const PROGRESS_KEY = 'be_progress';
const IMAGE_CACHE_KEY = 'be_image_cache';
const FLASHCARD_REVIEWS_KEY = 'be_fc_reviews';
const QUIZ_ATTEMPTS_KEY = 'be_quiz_attempts';

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}
function save(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── Courses ──────────────────────────────────────────────────────────────────

export function getCourses(): Course[] { return load<Course[]>(COURSES_KEY, []); }
export function getCourse(id: string): Course | undefined { return getCourses().find(c => c.id === id); }

export function saveCourse(course: Course) {
  const courses = getCourses();
  const idx = courses.findIndex(c => c.id === course.id);
  // Strip image data URLs from flashcards before writing to localStorage —
  // images are stored separately in IndexedDB via imageStore.
  const stripped: Course = {
    ...course,
    updatedAt: new Date().toISOString(),
    modules: course.modules.map(m => ({
      ...m,
      flashcards: m.flashcards.map(f => {
        if (!f.image) return f;
        const { image: _image, ...rest } = f;
        return rest;
      }),
    })),
  };
  if (idx >= 0) courses[idx] = stripped; else courses.push(stripped);
  save(COURSES_KEY, courses);
}

export function deleteCourse(id: string) {
  save(COURSES_KEY, getCourses().filter(c => c.id !== id));
  deleteImages(id); // clean up IndexedDB images
}

// ── Image cache (stored separately to avoid localStorage quota issues) ─────────

export function getImageCache(courseId: string): Record<number, string> {
  return load<Record<string, Record<number, string>>>(IMAGE_CACHE_KEY, {})[courseId] ?? {};
}

export function saveImageCache(courseId: string, index: number, dataUrl: string) {
  try {
    const all = load<Record<string, Record<number, string>>>(IMAGE_CACHE_KEY, {});
    if (!all[courseId]) all[courseId] = {};
    all[courseId][index] = dataUrl;
    save(IMAGE_CACHE_KEY, all);
  } catch {
    // QuotaExceededError — silently ignore, images will just regenerate next visit
  }
}

// ── Feedback ─────────────────────────────────────────────────────────────────

export function getFeedback(courseId: string): FeedbackComment[] {
  return load<FeedbackComment[]>(FEEDBACK_KEY, []).filter(f => f.courseId === courseId);
}
export function addFeedback(fb: FeedbackComment) {
  const all = load<FeedbackComment[]>(FEEDBACK_KEY, []);
  all.push(fb);
  save(FEEDBACK_KEY, all);
}

// ── Progress ──────────────────────────────────────────────────────────────────

type ProgressMap = Record<string, Record<string, boolean>>;

export function getProgress(courseId: string): Record<string, boolean> {
  return load<ProgressMap>(PROGRESS_KEY, {})[courseId] ?? {};
}
export function markModuleComplete(courseId: string, moduleId: string) {
  const all = load<ProgressMap>(PROGRESS_KEY, {});
  if (!all[courseId]) all[courseId] = {};
  all[courseId][moduleId] = true;
  save(PROGRESS_KEY, all);
}

// ── Blank helpers ─────────────────────────────────────────────────────────────

export function blankCourse(partial: Partial<Course> = {}): Course {
  return {
    id: uid(), title: 'Untitled Course', description: '',
    contentType: 'review_cards', learnerLevel: 'beginner', learningGoals: [], modules: [],
    finalProject: { title: '', description: '', deliverables: [] },
    creatorImprovementNotes: '', shareText: '',
    status: 'draft', createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), views: 0, completions: 0,
    ...partial,
  };
}

// ── Slug helpers ──────────────────────────────────────────────────────────────

/** Convert a title into a URL-safe slug, ensuring uniqueness among existing courses. */
export function makeSlug(title: string, existingCourseId?: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60) || 'deck';

  const courses = getCourses();
  const taken = new Set(
    courses
      .filter(c => c.slug && c.id !== existingCourseId)
      .map(c => c.slug as string)
  );
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Look up a course by its public slug. */
export function getCourseBySlug(slug: string): Course | undefined {
  return getCourses().find(c => c.slug === slug);
}

// ── Flashcard Reviews ─────────────────────────────────────────────────────────

export function getFlashcardReviews(deckId: string): FlashcardReview[] {
  return load<FlashcardReview[]>(FLASHCARD_REVIEWS_KEY, []).filter(r => r.deckId === deckId);
}

export function addFlashcardReview(review: FlashcardReview): void {
  const all = load<FlashcardReview[]>(FLASHCARD_REVIEWS_KEY, []);
  all.push(review);
  save(FLASHCARD_REVIEWS_KEY, all);
}

export function getAllFlashcardReviewsForCreator(creatorUsername: string): FlashcardReview[] {
  // Get all deck IDs that belong to this creator
  const deckIds = new Set(
    getCourses()
      .filter(c => c.contentType === 'review_cards' && c.creatorUsername === creatorUsername)
      .map(c => c.id)
  );
  return load<FlashcardReview[]>(FLASHCARD_REVIEWS_KEY, []).filter(r => deckIds.has(r.deckId));
}

// ── Quiz Attempts ─────────────────────────────────────────────────────────────

export function getQuizAttempts(quizId: string): QuizAttemptResult[] {
  return load<QuizAttemptResult[]>(QUIZ_ATTEMPTS_KEY, []).filter(a => a.quizId === quizId);
}

export function saveQuizAttempt(attempt: QuizAttemptResult): void {
  const all = load<QuizAttemptResult[]>(QUIZ_ATTEMPTS_KEY, []);
  all.push(attempt);
  save(QUIZ_ATTEMPTS_KEY, all);
}

export function deleteQuizAttempts(quizId: string): void {
  save(QUIZ_ATTEMPTS_KEY, load<QuizAttemptResult[]>(QUIZ_ATTEMPTS_KEY, []).filter(a => a.quizId !== quizId));
}

export function countQuizAttempts(quizId: string): number {
  return getQuizAttempts(quizId).length;
}

'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronRight, ChevronLeft, CheckCircle,
  Lightbulb, RotateCcw, BookOpen, ListChecks, X, MessageSquare, Send, Lock, Pencil,
} from 'lucide-react';
import { dbGetCourse, dbGetReviews, dbAddReview, dbSaveTaskAttempt, dbIncrementViews, dbIncrementCompletions } from '@/lib/db';
import { cleanTitle } from '@/lib/cleanTitle';
import type { Course, PracticeTask, PracticeTaskConfig, FlashcardReview } from '@/lib/types';
import clsx from 'clsx';

// ── Difficulty badge ──────────────────────────────────────────────────────────

function DiffBadge({ difficulty }: { difficulty: string }) {
  const colors: Record<string, string> = {
    beginner:     'bg-emerald-100 text-emerald-700',
    intermediate: 'bg-amber-100 text-amber-700',
    challenge:    'bg-rose-100 text-rose-700',
  };
  return (
    <span className={clsx('text-xs px-2 py-0.5 rounded-full font-semibold capitalize',
      colors[difficulty] ?? 'bg-gray-100 text-gray-600')}>
      {difficulty}
    </span>
  );
}

// ── Content renderers ─────────────────────────────────────────────────────────

// Strip HTML to plain text
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').trim();
}

// Check for existing rich HTML structure
function isRichHtml(html: string): boolean {
  return /<(ul|ol|li|pre|code|table|h[1-6])\b/i.test(html);
}

// Detect if text is a structured list (numbered/lettered items, dashes, newlines)
// so we can format it as bullets. Works for ALL subjects — history, science, math etc.
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function parseStructuredText(raw: string): string {
  const lines = raw.split(/\n/).map(l => l.trim()).filter(Boolean);

  // Detect numbered list: lines starting with "1.", "2.", etc. — preserve ALL items including short T/F
  const numberedLines = lines.filter(l => /^\d+[\.\)]\s+/.test(l));
  if (numberedLines.length >= 2) {
    const items = lines
      .filter(l => /^\d+[\.\)]\s+/.test(l))
      .map(l => {
        const content = l.replace(/^\d+[\.\)]\s+/, '').trim();
        // Colour T/F badges
        const coloured = content
          .replace(/^(T)\b/, '<span class="font-bold text-green-600">T</span>')
          .replace(/^(F)\b/, '<span class="font-bold text-red-500">F</span>');
        return `<li>${coloured}</li>`;
      });
    return `<ol class="list-none pl-0 space-y-1.5">${items.join('')}</ol>`;
  }

  // Generic bullet fallback — strip numbering, filter very short fragments
  const bullets = lines
    .flatMap(l => l.split(/\s{2,}-\s+|\s+-\s+/))
    .map(l => l.replace(/^[\d]+\.\s*/, '').replace(/^[A-Za-z]\.\s*/, '').trim())
    .filter(l => l.length > 2);

  if (bullets.length <= 1) return `<p>${raw}</p>`;
  return `<ul>${bullets.map(l => `<li>${l}</li>`).join('')}</ul>`;
}

/** Detect and render a matching activity with numbered terms + lettered definitions */
function parseMatchingActivity(plain: string): string | null {
  const lines = plain.split(/\n/).map(l => l.trim()).filter(Boolean);

  // Find "Terms:" and "Definitions:" header lines
  const termsIdx = lines.findIndex(l => /^terms\s*:?$/i.test(l));
  const defsIdx  = lines.findIndex(l => /^definitions\s*:?$/i.test(l));
  if (termsIdx === -1 || defsIdx === -1) return null;

  // Collect terms between the two headers (strip any existing numbering)
  const termLines = lines
    .slice(termsIdx + 1, defsIdx)
    .map(l => l.replace(/^[\d]+[\.\)]\s*/, '').trim())
    .filter(Boolean);

  // Collect definitions after "Definitions:" (strip any existing lettering)
  const defLines = lines
    .slice(defsIdx + 1)
    .map(l => l.replace(/^[A-Za-z][\.\)]\s*/, '').trim())
    .filter(Boolean);

  if (!termLines.length || !defLines.length) return null;

  const termsHtml = termLines
    .map((t, i) => `<li><span class="font-semibold text-green-700 mr-2">${i + 1}.</span>${t}</li>`)
    .join('');
  const defsHtml = defLines
    .map((d, i) => `<li><span class="font-semibold text-blue-600 mr-2">${LETTERS[i]}.</span>${d}</li>`)
    .join('');

  // Keep any introductory line before "Terms:"
  const intro = lines.slice(0, termsIdx).join(' ');

  return `
    ${intro ? `<p class="mb-3">${intro}</p>` : ''}
    <div class="grid grid-cols-2 gap-4">
      <div>
        <p class="text-xs font-bold uppercase tracking-wide text-green-700 mb-2">Terms</p>
        <ol class="space-y-1.5 list-none pl-0">${termsHtml}</ol>
      </div>
      <div>
        <p class="text-xs font-bold uppercase tracking-wide text-blue-600 mb-2">Definitions</p>
        <ol class="space-y-1.5 list-none pl-0">${defsHtml}</ol>
      </div>
    </div>
  `.trim();
}

// Convert markdown triple-backtick fences to HTML <pre><code> blocks.
// Handles ```lang\n...\n``` and plain ``` fences.
function convertCodeFences(text: string): string {
  return text.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => {
    const escaped = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .trimEnd();
    return `<pre><code>${escaped}</code></pre>`;
  });
}

// Render the activity block — always tries to structure the content.
// Only falls back to a plain paragraph if the text is genuinely a single sentence.
function ActivityContent({ html }: { html: string }) {
  if (!html) return null;

  const cls = 'text-sm text-gray-800 leading-relaxed ' +
    '[&_ul]:space-y-1.5 [&_ul]:list-none [&_ul]:pl-0 ' +
    '[&_li]:flex [&_li]:items-start [&_li]:gap-2 ' +
    '[&_li]:before:content-["•"] [&_li]:before:text-green-500 [&_li]:before:font-bold [&_li]:before:flex-shrink-0 [&_li]:before:mt-0.5 ' +
    '[&_ol]:list-decimal [&_ol]:list-inside [&_ol]:space-y-1.5 ' +
    '[&_p]:leading-relaxed ' +
    '[&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono ' +
    '[&_pre]:bg-gray-900 [&_pre]:text-gray-100 [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_pre]:my-2 [&_pre]:font-mono ' +
    '[&_pre_code]:bg-transparent [&_pre_code]:px-0 [&_pre_code]:text-gray-100 ' +
    '[&_strong]:font-semibold [&_strong]:text-gray-900';

  // Convert markdown code fences before any other processing
  const withCodeBlocks = convertCodeFences(html);

  // Already has proper HTML — render as-is
  if (isRichHtml(withCodeBlocks)) {
    return <div className={cls} dangerouslySetInnerHTML={{ __html: withCodeBlocks }} />;
  }

  const plain = stripHtml(withCodeBlocks);

  // Try matching-activity parser first
  const matchHtml = parseMatchingActivity(plain);
  if (matchHtml) {
    return <div className={cls} dangerouslySetInnerHTML={{ __html: matchHtml }} />;
  }

  // Fall back to generic structure
  return <div className={cls} dangerouslySetInnerHTML={{ __html: parseStructuredText(plain) }} />;
}

// General rich-text renderer (instructions, answer key, explanation)
function RichContent({ html }: { html: string }) {
  const cls = 'text-sm text-gray-800 leading-relaxed ' +
    '[&_ul]:space-y-1.5 [&_ul]:list-none [&_ul]:pl-0 ' +
    '[&_li]:flex [&_li]:items-start [&_li]:gap-2 ' +
    '[&_li]:before:content-["•"] [&_li]:before:text-green-500 [&_li]:before:font-bold [&_li]:before:flex-shrink-0 [&_li]:before:mt-0.5 ' +
    '[&_ol]:list-decimal [&_ol]:list-inside [&_ol]:space-y-1.5 ' +
    '[&_p]:leading-relaxed ' +
    '[&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_code]:text-gray-800 ' +
    '[&_pre]:bg-gray-900 [&_pre]:text-gray-100 [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_pre]:my-2 [&_pre]:font-mono ' +
    '[&_pre_code]:bg-transparent [&_pre_code]:px-0 [&_pre_code]:text-gray-100 [&_pre_code]:text-xs ' +
    '[&_strong]:font-semibold [&_strong]:text-gray-900';

  if (!html) return null;

  // Convert markdown code fences before rendering
  const withCodeBlocks = convertCodeFences(html);

  // If it already has HTML structure, render directly
  if (isRichHtml(withCodeBlocks)) {
    return <div className={cls} dangerouslySetInnerHTML={{ __html: withCodeBlocks }} />;
  }

  // Otherwise parse for structure too
  const plain = stripHtml(withCodeBlocks);
  return <div className={cls} dangerouslySetInnerHTML={{ __html: parseStructuredText(plain) }} />;
}

// ── To-do checklist panel ─────────────────────────────────────────────────────

function TodoPanel({
  tasks, completedIds, currentIdx, onGoTo, onClose,
}: {
  tasks: PracticeTask[];
  completedIds: Set<string>;
  currentIdx: number;
  onGoTo: (i: number) => void;
  onClose: () => void;
}) {
  const done = tasks.filter(t => completedIds.has(t.id)).length;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="flex-1 bg-black/30" onClick={onClose} />
      {/* Panel */}
      <div className="w-80 max-w-full bg-white h-full shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div>
            <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <ListChecks size={15} className="text-green-600" /> Task Checklist
            </p>
            <p className="text-xs text-gray-400 mt-0.5">{done} of {tasks.length} completed</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X size={16} />
          </button>
        </div>
        {/* Progress bar */}
        <div className="h-1 bg-gray-100">
          <div className="h-1 bg-green-500 transition-all" style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} />
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {tasks.map((task, i) => {
            const isComplete = completedIds.has(task.id);
            const isCurrent = i === currentIdx;
            return (
              <button
                key={task.id}
                onClick={() => { onGoTo(i); onClose(); }}
                className={clsx(
                  'w-full flex items-start gap-3 px-4 py-3 text-left transition-colors border-b border-gray-50 last:border-0',
                  isCurrent ? 'bg-green-50' : 'hover:bg-gray-50',
                )}
              >
                {/* Checkbox */}
                <span className={clsx(
                  'mt-0.5 flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors',
                  isComplete ? 'bg-green-600 border-green-600' : isCurrent ? 'border-green-500' : 'border-gray-300',
                )}>
                  {isComplete && <CheckCircle size={10} className="text-white" />}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={clsx(
                    'text-xs font-medium leading-snug',
                    isComplete ? 'line-through text-gray-400' : isCurrent ? 'text-green-700' : 'text-gray-700',
                  )}>
                    {i + 1}. {task.title || `Task ${i + 1}`}
                  </p>
                  {task.topic && (
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{task.topic}</p>
                  )}
                </div>
                <DiffBadge difficulty={task.difficulty ?? 'beginner'} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Single task card ──────────────────────────────────────────────────────────

function TaskCard({
  task, taskNumber, totalTasks, cfg,
  onNext, onPrev, isFirst, isLast,
  onMarked,
}: {
  task: PracticeTask;
  taskNumber: number;
  totalTasks: number;
  cfg: PracticeTaskConfig;
  onNext: () => void;
  onPrev: () => void;
  isFirst: boolean;
  isLast: boolean;
  onMarked: (result: 'correct' | 'incorrect') => void;
}) {
  const [showHint, setShowHint] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const [userAnswer, setUserAnswer] = useState('');

  const hasHint        = cfg.includeHints && !!task.hint;
  const hasReviewNote  = !!task.reviewNote;
  // Creator setting — default true for backward compat
  const answersVisible = cfg.showAnswers ?? true;

  return (
    <div className="space-y-4">
      {/* Task card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">

        {/* Header */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-green-100 text-green-700 text-xs font-bold flex-shrink-0">
            {taskNumber}
          </span>
          <DiffBadge difficulty={task.difficulty ?? 'beginner'} />
          {task.topic && (
            <span className="text-xs text-gray-400 font-medium">{task.topic}</span>
          )}
        </div>

        {/* Title */}
        <h2 className="text-base font-semibold text-gray-900 mb-3 leading-snug">{task.title}</h2>

        {/* Instructions */}
        {task.description && (
          <div className="text-sm text-gray-600 mb-4 leading-relaxed">
            <RichContent html={task.description} />
          </div>
        )}

        {/* Activity block */}
        {task.activity && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
            <ActivityContent html={task.activity} />
          </div>
        )}

        {/* Answer format hint */}
        {task.answerFormat && (
          <div className="flex items-start gap-2 text-xs text-gray-500 mb-3 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
            <BookOpen size={12} className="text-blue-400 flex-shrink-0 mt-0.5" />
            <span><strong className="text-blue-700">Your answer should be:</strong> {task.answerFormat}</span>
          </div>
        )}

        {/* ── Interactive Workspace / Writing Box ─────────────────────── */}
        <div className="mb-4 space-y-1.5">
          <label className="block text-xs font-semibold text-gray-700 flex items-center gap-1.5">
            <Pencil size={13} className="text-blue-600" />
            Your Answer / Workspace (Type what you think before checking the answer):
          </label>
          <textarea
            value={userAnswer}
            onChange={e => setUserAnswer(e.target.value)}
            rows={3}
            placeholder="Type your response or thoughts here..."
            className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900 placeholder-gray-400 resize-y shadow-xs"
          />
          <p className="text-[11px] text-gray-400 italic">
            Self-practice workspace: Write your thoughts above, then click below to compare with the creator&apos;s solution!
          </p>
        </div>

        {/* Hint + Review note row */}
        {(hasHint || hasReviewNote) && (
          <div className="mb-4 flex flex-wrap gap-2">
            {hasHint && (
              !showHint ? (
                <button onClick={() => setShowHint(true)}
                  className="inline-flex items-center gap-1.5 text-xs text-amber-600 hover:text-amber-700 font-medium border border-amber-200 bg-amber-50 px-3 py-1.5 rounded-lg hover:bg-amber-100 transition-colors">
                  <Lightbulb size={12} /> Show Hint
                </button>
              ) : (
                <div className="w-full bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
                  <Lightbulb size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800 leading-relaxed">{task.hint}</p>
                </div>
              )
            )}
            {hasReviewNote && (
              !showReview ? (
                <button onClick={() => setShowReview(true)}
                  className="inline-flex items-center gap-1.5 text-xs text-violet-600 hover:text-violet-700 font-medium border border-violet-200 bg-violet-50 px-3 py-1.5 rounded-lg hover:bg-violet-100 transition-colors">
                  <BookOpen size={12} /> Not sure? See what to review
                </button>
              ) : (
                <div className="w-full bg-violet-50 border border-violet-200 rounded-lg px-3 py-2 flex items-start gap-2">
                  <BookOpen size={13} className="text-violet-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-violet-800 leading-relaxed">{task.reviewNote}</p>
                </div>
              )
            )}
          </div>
        )}

        {/* ── Check Answer ──────────────────────────────────────────── */}
        <div className="border-t border-gray-100 pt-4">
          {!answerRevealed ? (
            <button
              disabled={!answersVisible}
              onClick={() => { setAnswerRevealed(true); onMarked('correct'); }}
              className={clsx(
                'inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition-all shadow-sm',
                answersVisible
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-gray-100 text-gray-300 cursor-not-allowed',
              )}>
              <CheckCircle size={14} /> Reveal Sample Answer & Solution
            </button>
          ) : (
            <div className="space-y-3">
              {userAnswer.trim() && (
                <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3.5">
                  <p className="text-xs font-bold text-blue-800 uppercase tracking-wide mb-1">
                    Your Typed Answer:
                  </p>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap">{userAnswer}</p>
                </div>
              )}
              <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50/60 p-4">
                <p className="text-xs font-bold text-emerald-800 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <CheckCircle size={14} className="text-emerald-600" />
                  Creator Sample Answer & Solution
                </p>
                <RichContent html={task.answerKey} />
              </div>
              {task.explanation && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                  <p className="text-xs font-semibold text-blue-700 mb-1">Explanation</p>
                  <p className="text-xs text-gray-700 leading-relaxed">{task.explanation}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button disabled={isFirst} onClick={onPrev}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40">
          <ChevronLeft size={14} /> Prev
        </button>
        <span className="text-xs text-gray-400">{taskNumber} of {totalTasks}</span>
        {!isLast ? (
          <button onClick={onNext}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700">
            Next <ChevronRight size={14} />
          </button>
        ) : (
          <button onClick={onNext}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700">
            Finish <CheckCircle size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Results screen ────────────────────────────────────────────────────────────

function ResultsScreen({
  tasks, correctIds, answeredIds, onRestart, courseId,
}: {
  tasks: PracticeTask[];
  correctIds: Set<string>;
  answeredIds: Set<string>;
  onRestart: () => void;
  courseId: string;
}) {
  const correct = tasks.filter(t => correctIds.has(t.id)).length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

  // Save attempt once on mount — works for anonymous users too
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (saved) return;
    setSaved(true);
    dbSaveTaskAttempt({
      courseId,
      takerName: null, // anonymous — no login required
      results: tasks.map(t => ({ taskId: t.id, correct: correctIds.has(t.id) })),
      correctCount: correct,
      totalCount: total,
      percentageScore: pct,
      completedAt: new Date().toISOString(),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border-2 border-green-300 p-6 text-center">
        <div className="text-4xl mb-3">{pct >= 80 ? '🎉' : pct >= 50 ? '👍' : '📚'}</div>
        <h2 className="text-xl font-bold text-gray-900 mb-1">All tasks complete!</h2>
        <p className="text-sm text-gray-500 mb-4">
          You marked {correct} of {total} task{total !== 1 ? 's' : ''} correct
          {total > 0 && <span className="font-semibold text-gray-700"> ({pct}%)</span>}.
        </p>
        <button onClick={onRestart}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white font-medium rounded-xl hover:bg-green-700 text-sm">
          <RotateCcw size={14} /> Try again
        </button>
      </div>

      {/* Final checklist summary */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Task summary</p>
        <div className="space-y-2">
          {tasks.map((task, i) => {
            const isCorrect = correctIds.has(task.id);
            const isAnswered = answeredIds.has(task.id);
            return (
              <div key={task.id} className="flex items-center gap-2.5">
                <span className={clsx(
                  'flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center',
                  isCorrect  ? 'bg-green-600 border-green-600'
                  : isAnswered ? 'bg-rose-400 border-rose-400'
                  : 'border-gray-300',
                )}>
                  {isCorrect && <CheckCircle size={10} className="text-white" />}
                  {isAnswered && !isCorrect && <span className="text-white text-[8px] font-bold">✗</span>}
                </span>
                <span className={clsx(
                  'text-xs flex-1',
                  isCorrect ? 'text-gray-500 line-through'
                  : isAnswered ? 'text-rose-700'
                  : 'text-gray-700',
                )}>
                  {i + 1}. {task.title || `Task ${i + 1}`}
                </span>
                <DiffBadge difficulty={task.difficulty ?? 'beginner'} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TasksViewerPage() {
  const { id } = useParams<{ id: string }>();
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentIdx, setCurrentIdx] = useState(0);
  // Track which task IDs the learner marked as correct
  const [correctIds, setCorrectIds] = useState<Set<string>>(new Set());
  // Track all tasks that have been answered (correct OR incorrect)
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());
  const [showTodo, setShowTodo] = useState(false);
  const [isDone, setIsDone] = useState(false);

  // Reviews drawer state
  const [showReviews, setShowReviews] = useState(false);
  const [reviews, setReviews] = useState<FlashcardReview[]>([]);
  const [reviewName, setReviewName] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSubmitted, setReviewSubmitted] = useState(false);

  useEffect(() => {
    async function load() {
      const c = await dbGetCourse(id);
      setCourse(c);
      setLoading(false);
      if (c) {
        if (c.contentType === 'activities' && c.status === 'published') {
          dbIncrementViews(id);
        }
        const r = await dbGetReviews(c.id);
        setReviews(r);
      }
    }
    load();
  }, [id]);

  async function handleReviewSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reviewComment.trim() || !course) return;
    const saved = await dbAddReview({
      courseId: course.id,
      name: reviewName.trim() || 'Anonymous',
      comment: reviewComment.trim().slice(0, 50),
    });
    if (saved) {
      setReviews(prev => [saved, ...prev]);
      setReviewName('');
      setReviewComment('');
      setReviewSubmitted(true);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-green-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!course || course.contentType !== 'activities') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Practice set not found.</p>
      </div>
    );
  }

  if (course.status !== 'published') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900 p-4 text-center">
        <div className="max-w-md bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-8 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto mb-4">
            <Lock size={24} />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Content Unavailable</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
            This content is currently unpublished or set to draft mode by the creator.
          </p>
          <Link href="/" className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 text-white font-medium text-sm rounded-lg hover:bg-blue-700 transition-colors">
            Return Home
          </Link>
        </div>
      </div>
    );
  }

  const cfg: PracticeTaskConfig = course.taskConfig ?? {
    taskCount: 8,
    learnerLevel: 'beginner',
    difficulty: 'mixed',
    includeHints: true,
    showAnswerTiming: 'after_submission',
    showAnswers: true,
  };

  const allTasks: PracticeTask[] = course.modules.flatMap(m => m.practiceTasks);

  if (!allTasks.length) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">No tasks in this set.</p>
      </div>
    );
  }

  function handleMarked(taskId: string, result: 'correct' | 'incorrect') {
    setAnsweredIds(prev => new Set([...prev, taskId]));
    if (result === 'correct') setCorrectIds(prev => new Set([...prev, taskId]));
  }

  function handleNext() {
    if (currentIdx >= allTasks.length - 1) {
      setIsDone(true);
      dbIncrementCompletions(id);
    } else {
      setCurrentIdx(i => i + 1);
    }
  }

  function restart() {
    setCurrentIdx(0);
    setCorrectIds(new Set());
    setAnsweredIds(new Set());
    setIsDone(false);
  }

  const progressPct = isDone ? 100 : (answeredIds.size / allTasks.length) * 100;

  return (
    <div className="min-h-screen bg-gray-50">

      {/* To-do panel */}
      {showTodo && (
        <TodoPanel
          tasks={allTasks}
          completedIds={answeredIds}
          currentIdx={currentIdx}
          onGoTo={i => setCurrentIdx(i)}
          onClose={() => setShowTodo(false)}
        />
      )}

      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">{cleanTitle(course.title)}</p>
            {!isDone && (
              <p className="text-xs text-gray-400">
                {answeredIds.size} of {allTasks.length} answered
              </p>
            )}
          </div>
          {/* Reviews button */}
          <button
            onClick={() => setShowReviews(true)}
            className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-green-600 transition-colors flex-shrink-0">
            <MessageSquare size={14} />
            Reviews
            {reviews.length > 0 && (
              <span className="bg-green-100 text-green-700 px-1.5 rounded-full font-medium">{reviews.length}</span>
            )}
          </button>
          {/* To-do list button */}
          <button
            onClick={() => setShowTodo(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 flex-shrink-0 relative">
            <ListChecks size={13} />
            <span className="hidden sm:inline">Tasks</span>
            {answeredIds.size > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-green-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {answeredIds.size}
              </span>
            )}
          </button>
        </div>
        {/* Progress bar */}
        <div className="h-1 bg-gray-100">
          <div className="h-1 bg-green-500 transition-all duration-300"
            style={{ width: `${progressPct}%` }} />
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6">

        {/* Difficulty legend — first visit only */}
        {currentIdx === 0 && !isDone && answeredIds.size === 0 && (
          <div className="flex flex-wrap gap-2 mb-5">
            {['beginner', 'intermediate', 'challenge'].map(d => {
              const count = allTasks.filter(t => (t.difficulty ?? 'beginner') === d).length;
              if (!count) return null;
              const colors: Record<string, string> = {
                beginner:     'bg-emerald-50 text-emerald-700 border-emerald-200',
                intermediate: 'bg-amber-50 text-amber-700 border-amber-200',
                challenge:    'bg-rose-50 text-rose-700 border-rose-200',
              };
              return (
                <span key={d} className={clsx('text-xs px-2.5 py-1 rounded-full border font-medium capitalize', colors[d])}>
                  {count} {d}
                </span>
              );
            })}
          </div>
        )}

        {isDone ? (
          <ResultsScreen
            tasks={allTasks}
            correctIds={correctIds}
            answeredIds={answeredIds}
            onRestart={restart}
            courseId={course.id}
          />
        ) : (
          <>
            <TaskCard
              key={currentIdx}
              task={allTasks[currentIdx]}
              taskNumber={currentIdx + 1}
              totalTasks={allTasks.length}
              cfg={cfg}
              onNext={handleNext}
              onPrev={() => setCurrentIdx(i => Math.max(0, i - 1))}
              isFirst={currentIdx === 0}
              isLast={currentIdx === allTasks.length - 1}
              onMarked={(result) => handleMarked(allTasks[currentIdx].id, result)}
            />

            {/* Task dots */}
            <div className="flex flex-wrap gap-1.5 justify-center pt-2">
              {allTasks.map((t, i) => {
                const answered = answeredIds.has(t.id);
                const correct  = correctIds.has(t.id);
                return (
                  <button key={i} onClick={() => setCurrentIdx(i)}
                    className={clsx('w-6 h-6 rounded-full text-xs font-bold transition-colors',
                      i === currentIdx  ? 'bg-green-600 text-white' :
                      answered && correct ? 'bg-green-200 text-green-800' :
                      answered          ? 'bg-rose-200 text-rose-700' :
                                          'bg-gray-200 text-gray-500')}>
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Reviews drawer — same pattern as flashcards */}
      {showReviews && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowReviews(false)} />
          <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[80vh] overflow-y-auto shadow-xl">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-900">Reviews</h2>
              <button onClick={() => setShowReviews(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-5">
              {/* Submit form */}
              {reviewSubmitted ? (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                  <p className="text-green-700 font-semibold text-sm">Thanks for your review!</p>
                  <button onClick={() => setReviewSubmitted(false)} className="text-xs text-gray-500 underline mt-1">Leave another</button>
                </div>
              ) : (
                <form onSubmit={handleReviewSubmit} className="bg-gray-50 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-semibold text-gray-700">Add a review</p>
                  <input
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="Your name (optional)"
                    value={reviewName}
                    onChange={e => setReviewName(e.target.value)}
                    maxLength={40}
                  />
                  <div>
                    <textarea
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 min-h-[70px] resize-none"
                      placeholder="Your comment (max 50 characters)"
                      value={reviewComment}
                      onChange={e => setReviewComment(e.target.value.slice(0, 50))}
                      required
                    />
                    <p className="text-xs text-gray-400 text-right">{reviewComment.length}/50</p>
                  </div>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
                  >
                    <Send size={13} /> Post Review
                  </button>
                </form>
              )}

              {/* Existing reviews */}
              {reviews.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No reviews yet. Be the first!</p>
              ) : (
                reviews.map(r => (
                  <div key={r.id} className="border border-gray-100 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-semibold text-gray-800">{r.name}</p>
                      <p className="text-xs text-gray-400">{new Date(r.createdAt).toLocaleDateString()}</p>
                    </div>
                    <p className="text-sm text-gray-600">{r.comment}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

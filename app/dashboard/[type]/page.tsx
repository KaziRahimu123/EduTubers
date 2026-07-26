'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Edit, Trash2, Clock, Copy, CheckCircle, ExternalLink, MessageSquare, Globe, Lock, ChevronDown, ChevronUp, BarChart2, LineChart } from 'lucide-react';
import Layout from '@/components/Layout';
import { dbGetCourses, dbDeleteCourse, dbGetQuizAttempts, dbDeleteQuizAttempts, dbGetReviews, dbGetTaskAttempts } from '@/lib/db';
import { CONTENT_TYPES } from '@/lib/types';
import type { Course, ContentType, TaskDifficulty, FlashcardReview, TaskAttemptResult, QuizAttemptResult, QuizAttemptAnswer } from '@/lib/types';
import { useAuthGuard } from '@/lib/useAuthGuard';
import clsx from 'clsx';
import { cleanTitle } from '@/lib/cleanTitle';

const TASK_DIFF_COLORS: Record<TaskDifficulty, string> = {
  beginner:     'bg-emerald-100 text-emerald-700',
  intermediate: 'bg-amber-100 text-amber-700',
  challenge:    'bg-rose-100 text-rose-700',
};

export default function ContentTypeDetail() {
  const router = useRouter();
  const ready = useAuthGuard();
  const params = useParams();
  const typeId = params.type as ContentType;
  const tid = typeId as string;

  const [items, setItems] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [reviewCounts, setReviewCounts] = useState<Record<string, number>>({});
  const [attemptCounts, setAttemptCounts] = useState<Record<string, number>>({});
  const [feedbackMap, setFeedbackMap] = useState<Record<string, FlashcardReview[]>>({});
  const [expandedFeedback, setExpandedFeedback] = useState<Record<string, boolean>>({});
  // task analytics: courseId → array of all attempts
  const [taskAttemptsMap, setTaskAttemptsMap] = useState<Record<string, TaskAttemptResult[]>>({});
  const [expandedTaskStats, setExpandedTaskStats] = useState<Record<string, boolean>>({});
  // quiz analytics: courseId → full attempt objects
  const [quizAttemptsMap, setQuizAttemptsMap] = useState<Record<string, QuizAttemptResult[]>>({});
  const [expandedQuizStats, setExpandedQuizStats] = useState<Record<string, boolean>>({});

  const typeMeta = CONTENT_TYPES.find(t => t.id === typeId);

  useEffect(() => {
    if (!ready) return;
    if (!CONTENT_TYPES.find(t => t.id === typeId)) { router.replace('/dashboard'); return; }

    async function load() {
      setLoading(true);
      const all = await dbGetCourses();
      const filtered = all.filter(c => c.contentType === typeId);
      setItems(filtered);

      // Load feedback for every item (all content types)
      const fbMap: Record<string, FlashcardReview[]> = {};
      await Promise.all(filtered.map(async c => {
        const reviews = await dbGetReviews(c.id, c.slug);
        fbMap[c.id] = reviews;
      }));
      setFeedbackMap(fbMap);
      // review counts for all content types
      const counts: Record<string, number> = {};
      filtered.forEach(c => { counts[c.id] = fbMap[c.id]?.length ?? 0; });
      setReviewCounts(counts);

      // Load task attempts for Interactive Challenges
      if (typeId === 'activities') {
        const tMap: Record<string, TaskAttemptResult[]> = {};
        await Promise.all(filtered.map(async c => {
          tMap[c.id] = await dbGetTaskAttempts(c.id);
        }));
        setTaskAttemptsMap(tMap);
      }

      setLoading(false);
    }

    load();
  }, [ready, router, typeId]);

  async function handleDelete(id: string) {
    if (!confirm('Delete this item? This cannot be undone.')) return;
    await dbDeleteCourse(id);
    if (typeId === 'quiz') await dbDeleteQuizAttempts(id);
    setItems(prev => prev.filter(c => c.id !== id));
  }

  if (!ready || !typeMeta) return null;

  return (
    <Layout>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.push('/dashboard')}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {typeMeta.emoji} {typeMeta.label}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {loading ? 'Loading…' : items.length === 1 ? '1 item created' : `${items.length} items created`}
          </p>
        </div>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-7 h-7 border-3 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        /* Empty state */
        <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
          <span className="text-5xl block mb-4">{typeMeta.emoji}</span>
          <h2 className="text-lg font-semibold text-gray-700 mb-2">No {typeMeta.label} yet</h2>
          <p className="text-sm text-gray-400">Head to Create to generate your first one.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {[...items]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map(item => (
              <div key={item.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate mb-1">{cleanTitle(item.title)}</h3>
                    {item.description && (
                      <p className="text-sm text-gray-500 line-clamp-1 mb-2">{item.description}</p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      <span className="capitalize">{item.learnerLevel}</span>
                       <span className="flex items-center gap-1">
                         <Clock size={11} /> {new Date(item.updatedAt).toLocaleDateString()}
                       </span>
                       {(tid === 'review_cards' || tid === 'flashcards' || tid === 'activities') && reviewCounts[item.id] > 0 && (
                        <span className="flex items-center gap-1 text-purple-600">
                          <MessageSquare size={11} /> {reviewCounts[item.id]} review{reviewCounts[item.id] !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {(tid === 'quiz' || tid === 'tasks' || tid === 'activities') && (
                      <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full font-medium mr-1',
                        item.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                        {item.status === 'published' ? <><Globe size={9} /> Live</> : <><Lock size={9} /> Draft</>}
                      </span>
                    )}
                    <button
                      onClick={() => {
                        const ct = item.contentType as string;
                        if (ct === 'resource_page' || ct === 'visual_notes') router.push(`/visual-guide/${item.id}`);
                        else if (ct === 'review_cards' || ct === 'flashcards') router.push(`/editor/${item.id}/flashcards`);
                        else if (ct === 'branded_guide' || ct === 'pdf_pack') router.push(`/pdf-pack/${item.id}`);
                        else if (ct === 'quiz') router.push(`/quiz/${item.id}/edit`);
                        else if (ct === 'activities' || ct === 'tasks') router.push(`/tasks/${item.id}/edit`);
                        else router.push(`/editor/${item.id}`);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
                    >
                      <Edit size={12} /> {((item.contentType as string) === 'visual_notes' || item.contentType === 'resource_page') ? 'Open' : 'Edit'}
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {/* ── Flashcard Decks public link row ──────────────────── */}
                {(tid === 'review_cards' || tid === 'flashcards') && item.slug && (
                  <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap items-center gap-2">
                    <p className="text-xs text-gray-400 font-mono flex-1 min-w-0 truncate">
                      {window?.location?.origin ?? 'edutubers.com'}/flashcards/{item.slug}
                    </p>
                    <button
                      onClick={() => {
                        const url = `${window.location.origin}/flashcards/${item.slug}`;
                        navigator.clipboard.writeText(url).then(() => { setCopiedId(item.id); setTimeout(() => setCopiedId(null), 2000); });
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100"
                    >
                      {copiedId === item.id ? <><CheckCircle size={11} /> Copied</> : <><Copy size={11} /> Copy link</>}
                    </button>
                    <a
                      href={`/flashcards/${item.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                    >
                      <ExternalLink size={11} /> View
                    </a>
                  </div>
                )}

                {/* ── Quiz row ──────────────────────────────────────── */}
                {typeId === 'quiz' && (() => {
                  const allQuestions = item.modules.flatMap(m => m.quizQuestions);
                  const attempts = quizAttemptsMap[item.id] ?? [];
                  const quizStatsExpanded = expandedQuizStats[item.id] ?? false;

                  // Per-question wrong-rate computation
                  type QStat = { questionId: string; question: string; wrongCount: number; totalCount: number };
                  const qStatsMap: Record<string, QStat> = {};
                  allQuestions.forEach(q => {
                    qStatsMap[q.id] = { questionId: q.id, question: q.question, wrongCount: 0, totalCount: 0 };
                  });
                  attempts.forEach(attempt => {
                    (attempt.answers as QuizAttemptAnswer[]).forEach(ans => {
                      const q = allQuestions.find(q => q.id === ans.questionId);
                      if (!q || !qStatsMap[q.id]) return;
                      qStatsMap[q.id].totalCount++;
                      // determine correctness
                      let correct = false;
                      if (q.type === 'multiple_select') {
                        const correctSet = new Set(q.correctAnswers ?? []);
                        const selectedSet = new Set(ans.selectedMulti ?? []);
                        correct = correctSet.size === selectedSet.size && [...correctSet].every(v => selectedSet.has(v));
                      } else {
                        correct = ans.selected === q.correctAnswer;
                      }
                      if (!correct) qStatsMap[q.id].wrongCount++;
                    });
                  });
                  const qStats = Object.values(qStatsMap)
                    .filter(s => s.totalCount > 0)
                    .sort((a, b) => (b.wrongCount / b.totalCount) - (a.wrongCount / a.totalCount));

                  return (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      {/* Summary row */}
                      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                        <span>{typeof item.quizConfig?.questionCount === 'number' ? item.quizConfig.questionCount : allQuestions.length} questions</span>
                        {item.quizConfig?.difficulty && <span className="capitalize">{item.quizConfig.difficulty} difficulty</span>}
                        {item.quizConfig?.passingScore && <span>Pass: {item.quizConfig.passingScore}%</span>}
                        {attemptCounts[item.id] > 0 && (
                         <span className="text-orange-600 font-medium">{attemptCounts[item.id]} attempt{attemptCounts[item.id] !== 1 ? 's' : ''}</span>
                       )}
                       <button
                         onClick={() => router.push(`/analytics/${item.id}`)}
                         className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100 dark:bg-violet-900/20 dark:border-violet-700 dark:text-violet-400 dark:hover:bg-violet-900/40"
                       >
                         <LineChart size={11} /> Analytics
                       </button>
                       {item.status === 'published' && (
                          <>
                            <button onClick={() => {
                              const url = `${window.location.origin}/quiz/${item.id}`;
                              navigator.clipboard.writeText(url).then(() => { setCopiedId(item.id); setTimeout(() => setCopiedId(null), 2000); });
                            }} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100">
                              {copiedId === item.id ? <><CheckCircle size={11} /> Copied</> : <><Copy size={11} /> Copy link</>}
                            </button>
                            <a href={`/quiz/${item.id}`} target="_blank" rel="noopener"
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                              <ExternalLink size={11} /> Take Quiz
                            </a>
                            <a href={`/api/quiz-pdf/${item.id}`} target="_blank" rel="noopener"
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                              PDF
                            </a>
                          </>
                        )}
                      </div>

                      {/* Question analytics — only when attempt data exists */}
                      {qStats.length > 0 && (
                        <div className="mt-2">
                          <button
                            onClick={() => setExpandedQuizStats(prev => ({ ...prev, [item.id]: !quizStatsExpanded }))}
                            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800"
                          >
                            <BarChart2 size={12} className="text-orange-400" />
                            Question performance
                            <ChevronDown size={12} className={clsx('transition-transform ml-0.5', quizStatsExpanded && 'rotate-180')} />
                            <span className="text-gray-400">({attempts.length} attempt{attempts.length !== 1 ? 's' : ''})</span>
                          </button>
                          {quizStatsExpanded && (
                            <div className="mt-2 rounded-lg border border-gray-100 overflow-hidden">
                              <div className="grid grid-cols-[1fr_72px_80px] gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                                <span>Question</span>
                                <span className="text-center">Wrong</span>
                                <span className="text-center">Miss rate</span>
                              </div>
                              {qStats.map((s, idx) => {
                                const missRate = s.totalCount > 0 ? Math.round((s.wrongCount / s.totalCount) * 100) : 0;
                                const barColor = missRate >= 60 ? 'bg-rose-400' : missRate >= 30 ? 'bg-amber-400' : 'bg-emerald-400';
                                return (
                                  <div key={s.questionId} className="grid grid-cols-[1fr_72px_80px] gap-2 px-3 py-2.5 border-b border-gray-50 last:border-0 items-start">
                                    <div className="min-w-0">
                                      <span className="text-[10px] text-gray-400 font-medium mr-1">Q{idx + 1}</span>
                                      <span className="text-xs text-gray-800 leading-snug line-clamp-2">{s.question}</span>
                                    </div>
                                    <span className="text-xs text-center text-gray-600 tabular-nums pt-0.5">
                                      {s.wrongCount}/{s.totalCount}
                                    </span>
                                    <div className="flex flex-col items-center gap-0.5 pt-0.5">
                                      <span className={clsx('text-xs font-semibold tabular-nums',
                                        missRate >= 60 ? 'text-rose-600' : missRate >= 30 ? 'text-amber-600' : 'text-emerald-600')}>
                                        {missRate}%
                                      </span>
                                      <div className="w-12 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                        <div className={clsx('h-full rounded-full', barColor)} style={{ width: `${missRate}%` }} />
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* ── Practice Activities row ──────────────────────── */}
                {(tid === 'tasks' || tid === 'activities') && (() => {
                  const allTasks = item.modules.flatMap(m => m.practiceTasks);
                  const attempts = taskAttemptsMap[item.id] ?? [];
                  const statsExpanded = expandedTaskStats[item.id] ?? false;

                  // Compute per-task miss rate across all attempts
                  type TaskStat = { taskId: string; title: string; difficulty: string; wrongCount: number; totalCount: number };
                  const statsMap: Record<string, TaskStat> = {};
                  allTasks.forEach(t => {
                    statsMap[t.id] = { taskId: t.id, title: t.title || t.topic, difficulty: t.difficulty ?? 'beginner', wrongCount: 0, totalCount: 0 };
                  });
                  attempts.forEach(attempt => {
                    attempt.results.forEach(r => {
                      if (statsMap[r.taskId]) {
                        statsMap[r.taskId].totalCount++;
                        if (!r.correct) statsMap[r.taskId].wrongCount++;
                      }
                    });
                  });
                  const taskStats = Object.values(statsMap)
                    .filter(s => s.totalCount > 0)
                    .sort((a, b) => (b.wrongCount / b.totalCount) - (a.wrongCount / a.totalCount));

                  return (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      {/* Summary row */}
                      <div className="flex flex-wrap items-center gap-2">
                        {(['beginner', 'intermediate', 'challenge'] as TaskDifficulty[]).map(d => {
                          const cnt = allTasks.filter(t => (t.difficulty ?? 'beginner') === d).length;
                          if (!cnt) return null;
                          return (
                            <span key={d} className={clsx('text-xs px-2 py-0.5 rounded-full font-medium capitalize', TASK_DIFF_COLORS[d])}>
                              {cnt} {d}
                            </span>
                          );
                        })}
                        <span className="text-xs text-gray-400">
                          {allTasks.length} tasks total
                        </span>
                        {attempts.length > 0 && (
                          <span className="text-xs text-purple-600 font-medium">
                            {attempts.length} session{attempts.length !== 1 ? 's' : ''} recorded
                          </span>
                        )}
                        {item.status === 'published' && (
                          <>
                            <button onClick={() => {
                              const url = `${window.location.origin}/tasks/${item.id}`;
                              navigator.clipboard.writeText(url).then(() => { setCopiedId(item.id); setTimeout(() => setCopiedId(null), 2000); });
                            }} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100">
                              {copiedId === item.id ? <><CheckCircle size={11} /> Copied</> : <><Copy size={11} /> Copy link</>}
                            </button>
                            <a href={`/tasks/${item.id}`} target="_blank" rel="noopener"
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                              <ExternalLink size={11} /> Open Tasks
                            </a>
                          </>
                        )}
                      </div>

                      {/* Task analytics — only when there is data */}
                      {taskStats.length > 0 && (
                        <div className="mt-2">
                          <button
                            onClick={() => setExpandedTaskStats(prev => ({ ...prev, [item.id]: !statsExpanded }))}
                            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800"
                          >
                            <ChevronDown size={12} className={clsx('transition-transform', statsExpanded && 'rotate-180')} />
                            Task performance analytics
                            <span className="ml-1 text-gray-400">({attempts.length} attempt{attempts.length !== 1 ? 's' : ''})</span>
                          </button>
                          {statsExpanded && (
                            <div className="mt-2 rounded-lg border border-gray-100 overflow-hidden">
                              {/* Header */}
                              <div className="grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                                <span>Task</span>
                                <span className="text-center">Wrong</span>
                                <span className="text-center">Miss rate</span>
                              </div>
                              {taskStats.map(s => {
                                const missRate = s.totalCount > 0 ? Math.round((s.wrongCount / s.totalCount) * 100) : 0;
                                const barColor = missRate >= 60 ? 'bg-rose-400' : missRate >= 30 ? 'bg-amber-400' : 'bg-emerald-400';
                                return (
                                  <div key={s.taskId} className="grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-2 border-b border-gray-50 last:border-0 items-center">
                                    <div className="min-w-0">
                                      <p className="text-xs text-gray-800 truncate">{s.title}</p>
                                      <span className={clsx('text-[10px] capitalize', TASK_DIFF_COLORS[s.difficulty as TaskDifficulty] ?? 'text-gray-400')}>{s.difficulty}</span>
                                    </div>
                                    <span className="text-xs text-center text-gray-600 tabular-nums">
                                      {s.wrongCount}/{s.totalCount}
                                    </span>
                                    <div className="flex flex-col items-center gap-0.5">
                                      <span className={clsx('text-xs font-semibold tabular-nums', missRate >= 60 ? 'text-rose-600' : missRate >= 30 ? 'text-amber-600' : 'text-emerald-600')}>
                                        {missRate}%
                                      </span>
                                      <div className="w-12 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                        <div className={clsx('h-full rounded-full', barColor)} style={{ width: `${missRate}%` }} />
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* ── Feedback row (all content types) ─────────────── */}
                {(() => {
                  const fb = feedbackMap[item.id] ?? [];
                  const expanded = expandedFeedback[item.id] ?? false;
                  return (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <button
                        onClick={() => setExpandedFeedback(prev => ({ ...prev, [item.id]: !expanded }))}
                        className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-blue-600 transition-colors"
                      >
                        <MessageSquare size={13} className="text-blue-500" />
                        <span>{fb.length} Review{fb.length !== 1 ? 's' : ''} / Feedback</span>
                        {fb.length > 0 && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold bg-blue-100 text-blue-700 rounded-full">
                            {fb.length}
                          </span>
                        )}
                        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                      {expanded && (
                        <div className="mt-2 space-y-2">
                          {fb.length === 0 ? (
                            <p className="text-xs text-gray-400 italic py-1">No student reviews received yet for this item.</p>
                          ) : (
                            fb.map(r => (
                              <div key={r.id} className="bg-gray-50 rounded-lg px-3 py-2 flex items-start gap-2 border border-gray-100">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-semibold text-gray-800 truncate">{r.name}</span>
                                    <span className="text-[10px] text-gray-400 flex-shrink-0">{new Date(r.createdAt).toLocaleDateString()}</span>
                                  </div>
                                  <p className="text-xs text-gray-600 mt-0.5 leading-snug">{r.comment}</p>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

              </div>
            ))}
        </div>
      )}
    </Layout>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, Brain, Clipboard, ClipboardCheck,
  RefreshCw, Zap, BookOpen, ListOrdered,
} from 'lucide-react';
import Layout from '@/components/Layout';
import {
  dbGetCourse, dbGetFeedback,
  dbGetQuizAttempts,
} from '@/lib/db';
import type {
  Course, FeedbackComment,
  QuizAttemptResult,
} from '@/lib/types';
import { cleanTitle } from '@/lib/cleanTitle';
import type {
  AnalyticsInsightsRequest,
  AnalyticsInsightsResponse,
  ConceptStat,
  MissedQuestion,
} from '@/app/api/analytics-insights/route';

// ── Per-concept accuracy calculation ─────────────────────────────────────────

function buildConceptStats(course: Course, attempts: QuizAttemptResult[]): ConceptStat[] {
  if (!attempts.length) return [];

  const qMap = new Map<string, {
    moduleTitle: string;
    questionText: string;
    choices: string[];
    correctAnswer: number;
    correctAnswers?: number[];
    type: string;
  }>();

  for (const mod of course.modules) {
    for (const q of mod.quizQuestions) {
      qMap.set(q.id, {
        moduleTitle:    mod.title,
        questionText:   q.question,
        choices:        q.choices,
        correctAnswer:  q.correctAnswer,
        correctAnswers: q.correctAnswers,
        type:           q.type,
      });
    }
  }

  const qTotals = new Map<string, {
    right: number;
    wrong: number;
    wrongChoiceCounts: Map<number, number>;
  }>();

  const topicTotals = new Map<string, { right: number; wrong: number; qIds: Set<string> }>();

  for (const attempt of attempts) {
    for (const ans of attempt.answers) {
      const qInfo = qMap.get(ans.questionId);
      if (!qInfo) continue;

      const topic = qInfo.moduleTitle;
      if (!topicTotals.has(topic)) {
        topicTotals.set(topic, { right: 0, wrong: 0, qIds: new Set() });
      }
      const t = topicTotals.get(topic)!;
      t.qIds.add(ans.questionId);

      if (!qTotals.has(ans.questionId)) {
        qTotals.set(ans.questionId, { right: 0, wrong: 0, wrongChoiceCounts: new Map() });
      }
      const qt = qTotals.get(ans.questionId)!;

      let isCorrect = false;
      if (qInfo.type === 'multiple_select') {
        const selected = new Set(ans.selectedMulti ?? []);
        const correct  = new Set(qInfo.correctAnswers ?? []);
        isCorrect = selected.size === correct.size &&
          [...selected].every(v => correct.has(v));
        if (!isCorrect) {
          for (const idx of (ans.selectedMulti ?? [])) {
            if (!correct.has(idx)) {
              qt.wrongChoiceCounts.set(idx, (qt.wrongChoiceCounts.get(idx) ?? 0) + 1);
            }
          }
        }
      } else {
        isCorrect = ans.selected === qInfo.correctAnswer;
        if (!isCorrect && ans.selected !== undefined) {
          qt.wrongChoiceCounts.set(ans.selected, (qt.wrongChoiceCounts.get(ans.selected) ?? 0) + 1);
        }
      }

      if (isCorrect) { t.right++; qt.right++; } else { t.wrong++; qt.wrong++; }
    }
  }

  return Array.from(topicTotals.entries()).map(([topic, t]) => {
    const total    = t.right + t.wrong;
    const accuracy = total > 0 ? Math.round((t.right / total) * 100) : 0;

    const missedQuestions: MissedQuestion[] = [];
    for (const qId of t.qIds) {
      const qInfo = qMap.get(qId);
      const qt    = qTotals.get(qId);
      if (!qInfo || !qt) continue;
      const qTotal    = qt.right + qt.wrong;
      const qAccuracy = qTotal > 0 ? Math.round((qt.right / qTotal) * 100) : 0;
      if (qt.wrong === 0) continue;

      const topWrongChoices = [...qt.wrongChoiceCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([idx]) => qInfo.choices[idx] ?? `Choice ${idx + 1}`)
        .filter(Boolean);

      const correctAnswerText = qInfo.choices[qInfo.correctAnswer] ?? 'N/A';
      const label = qInfo.questionText.length > 80
        ? qInfo.questionText.slice(0, 77) + '…'
        : qInfo.questionText;

      missedQuestions.push({
        questionText:     label,
        accuracy:         qAccuracy,
        wrongCount:       qt.wrong,
        correctAnswerText,
        topWrongChoices,
      });
    }

    missedQuestions.sort((a, b) => b.wrongCount - a.wrongCount);

    return {
      topic,
      accuracy,
      totalAnswers:  total,
      wrongAnswers:  t.wrong,
      questionCount: t.qIds.size,
      missedQuestions,
    };
  });
}

// ── Accuracy colour helpers ───────────────────────────────────────────────────

function accTextColor(pct: number) {
  if (pct >= 70) return 'text-emerald-600 dark:text-emerald-400';
  if (pct >= 50) return 'text-amber-500 dark:text-amber-400';
  return 'text-red-500 dark:text-red-400';
}

function accBadge(pct: number) {
  if (pct >= 70) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
  if (pct >= 50) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
  return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const params = useParams();
  const id     = params.id as string;

  const [course,       setCourse]       = useState<Course | undefined>();
  const [feedback,     setFeedback]     = useState<FeedbackComment[]>([]);
  const [attempts,     setAttempts]     = useState<QuizAttemptResult[]>([]);
  const [conceptStats, setConceptStats] = useState<ConceptStat[]>([]);

  const [insights,        setInsights]        = useState<AnalyticsInsightsResponse | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError,   setInsightsError]   = useState<string | null>(null);
  const [copied,          setCopied]          = useState(false);

  useEffect(() => {
    dbGetCourse(id).then(c => {
      if (c) {
        setCourse(c);
        dbGetQuizAttempts(c.id).then(atts => {
          setAttempts(atts);
          setConceptStats(buildConceptStats(c, atts));
        });
      }
    });
    dbGetFeedback(id).then(setFeedback);
  }, [id]);

  // ── Derived stats ────────────────────────────────────────────────────────────
  const avgRating = feedback.length
    ? (feedback.reduce((s, f) => s + f.rating, 0) / feedback.length).toFixed(1)
    : '—';
  const avgScore = attempts.length
    ? Math.round(attempts.reduce((s, a) => s + a.percentageScore, 0) / attempts.length) + '%'
    : '—';
  const pct   = course && course.views > 0
    ? Math.round((course.completions / course.views) * 100)
    : 0;
  const isQuiz = course?.contentType === 'quiz';

  // All missed questions across all topics, sorted most-wrong → least-wrong
  const allMissedQuestions = conceptStats
    .flatMap(cs => cs.missedQuestions)
    .sort((a, b) => b.wrongCount - a.wrongCount);

  // Top struggle topics (accuracy < 70%), sorted worst first
  const struggleTopics = [...conceptStats]
    .filter(c => c.accuracy < 70)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 3);

  // ── Fetch AI insights ────────────────────────────────────────────────────────
  const fetchInsights = useCallback(async () => {
    if (!course || !conceptStats.length) return;
    setInsightsLoading(true);
    setInsightsError(null);
    try {
      const payload: AnalyticsInsightsRequest = {
        courseTitle:   course.title,
        totalAttempts: attempts.length,
        conceptStats,
      };
      const res  = await fetch('/api/analytics-insights', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body:        JSON.stringify(payload),
      });
      const json = await res.json() as AnalyticsInsightsResponse & { error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? 'Request failed');
      setInsights(json);
    } catch (e) {
      setInsightsError(e instanceof Error ? e.message : 'Failed to generate insights.');
    } finally {
      setInsightsLoading(false);
    }
  }, [course, conceptStats, attempts.length]);

  async function copyScript() {
    if (!insights?.followUpScript) return;
    try {
      await navigator.clipboard.writeText(insights.followUpScript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* clipboard unavailable */ }
  }

  // ── Loading state ────────────────────────────────────────────────────────────
  if (!course) {
    return (
      <Layout>
        <p className="text-center py-20 text-gray-500 dark:text-slate-400">
          Loading analytics…
        </p>
      </Layout>
    );
  }

  return (
    <Layout>

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={`/editor/${course.id}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100 transition-colors"
        >
          <ArrowLeft size={14} /> Editor
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 truncate">
            {cleanTitle(course.title)}
          </h1>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">Analytics</p>
        </div>
      </div>

      {/* ── Stat strip ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Views',                              value: course.views,       color: 'text-blue-600 dark:text-blue-400'     },
          { label: 'Completions',                        value: course.completions, color: 'text-emerald-600 dark:text-emerald-400' },
          { label: isQuiz ? 'Avg Score' : 'Avg Rating', value: isQuiz ? avgScore : avgRating, color: 'text-amber-500 dark:text-amber-400' },
          { label: 'Completion Rate',                    value: `${pct}%`,          color: 'text-violet-600 dark:text-violet-400' },
        ].map(s => (
          <div
            key={s.label}
            className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 px-4 py-3"
          >
            <p className="text-[11px] text-gray-400 dark:text-slate-500 uppercase tracking-wide font-medium mb-1">
              {s.label}
            </p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* ── Quiz-only cards ─────────────────────────────────────────────────── */}
      {isQuiz && (
        <div className="space-y-4">

          {/* ── CARD 1: Questions Ranked ───────────────────────────────────── */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
            <div className="flex items-center gap-2 px-5 pt-5 pb-3">
              <ListOrdered size={15} className="text-blue-500 shrink-0" />
              <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                Questions Ranked — Most Wrong to Least Wrong
              </h2>
              <span className="ml-auto text-[11px] text-gray-400 dark:text-slate-500">
                {attempts.length} attempt{attempts.length !== 1 ? 's' : ''}
              </span>
            </div>

            {allMissedQuestions.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-gray-400 dark:text-slate-500 italic">
                No quiz attempt data yet. Share the quiz link to collect performance data.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-t border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/60">
                      <th className="text-center px-3 py-2.5 text-[11px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide w-10">#</th>
                      <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide">Question</th>
                      <th className="text-center px-3 py-2.5 text-[11px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide w-20">Accuracy</th>
                      <th className="text-center px-3 py-2.5 text-[11px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide w-20">Wrong</th>
                      <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide w-[30%]">Correct Answer</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                    {allMissedQuestions.map((mq, i) => (
                      <tr
                        key={i}
                        className="hover:bg-gray-50 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="px-3 py-3 text-center text-xs font-bold text-gray-400 dark:text-slate-500">
                          {i + 1}
                        </td>
                        <td className="px-3 py-3 text-gray-700 dark:text-slate-300 leading-snug max-w-xs">
                          {mq.questionText}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className={`text-sm font-bold ${accTextColor(mq.accuracy)}`}>
                            {mq.accuracy}%
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className="inline-block px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs font-semibold">
                            {mq.wrongCount}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="inline-block px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 text-xs font-medium leading-snug">
                            {mq.correctAnswerText}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── CARD 2: Topics to Review + AI Action Plan ──────────────────── */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2">
                <BookOpen size={15} className="text-violet-500 shrink-0" />
                <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                  Topics You Should Review Again
                </h2>
              </div>
              <button
                onClick={fetchInsights}
                disabled={insightsLoading || conceptStats.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
                  bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white
                  disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {insightsLoading
                  ? <><RefreshCw size={11} className="animate-spin" /> Analysing…</>
                  : <><Zap size={11} /> {insights ? 'Regenerate' : 'Generate AI Insights'}</>
                }
              </button>
            </div>

            {/* Struggle topics list — always shown from real data */}
            {struggleTopics.length > 0 ? (
              <div className="space-y-3 mb-5">
                {struggleTopics.map(cs => (
                  <div key={cs.topic} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 dark:bg-slate-800/60 border border-gray-100 dark:border-slate-700/60">
                    <span className={`shrink-0 mt-0.5 inline-block px-2 py-0.5 rounded-full text-xs font-bold ${accBadge(cs.accuracy)}`}>
                      {cs.accuracy}%
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-slate-200">
                        {cs.topic}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                        {cs.wrongAnswers} wrong out of {cs.totalAnswers} answers across {cs.questionCount} question{cs.questionCount !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : conceptStats.length > 0 ? (
              <p className="text-sm text-emerald-600 dark:text-emerald-400 mb-5">
                All topics are above 70% accuracy — great results!
              </p>
            ) : (
              <p className="text-sm text-gray-400 dark:text-slate-500 italic mb-5">
                No attempt data yet.
              </p>
            )}

            {/* AI output — error */}
            {insightsError && (
              <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg p-3 mb-4">
                {insightsError}
              </div>
            )}

            {/* AI output — loading */}
            {insightsLoading && (
              <div className="flex items-center gap-3 py-6 justify-center text-gray-400 dark:text-slate-500">
                <RefreshCw size={18} className="animate-spin text-violet-400" />
                <p className="text-sm">IBM Granite 3.0 20B is analysing your audience data…</p>
              </div>
            )}

            {/* AI output — results */}
            {insights && !insightsLoading && (
              <ol className="space-y-2 pt-2 border-t border-gray-100 dark:border-slate-800">
                {insights.insights.map((bullet, i) => (
                  <li key={i} className="flex gap-2.5 items-start">
                    <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 text-[11px] font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                    <span className="text-sm text-gray-700 dark:text-slate-300 leading-relaxed">
                      {bullet}
                    </span>
                  </li>
                ))}
              </ol>
            )}

            {/* Empty-state hint */}
            {!insights && !insightsLoading && !insightsError && conceptStats.length > 0 && (
              <p className="text-xs text-gray-400 dark:text-slate-500 italic">
                Click "Generate AI Insights" to have IBM Granite 3.0 20B analyse your audience performance.
              </p>
            )}
          </div>

          {/* ── CARD 3: 60-Second Follow-up Script ────────────────────────── */}
          {insights?.followUpScript && !insightsLoading && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <Brain size={15} className="text-violet-500 shrink-0" />
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                    60-Second Creator Follow-up Script
                  </h2>
                </div>
                <button
                  onClick={copyScript}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
                    border border-gray-200 dark:border-slate-600
                    text-gray-600 dark:text-slate-300
                    hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                >
                  {copied
                    ? <><ClipboardCheck size={12} className="text-emerald-500" /> Copied!</>
                    : <><Clipboard size={12} /> Copy Script</>
                  }
                </button>
              </div>
              <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-4 border border-gray-100 dark:border-slate-700">
                <p className="text-sm text-gray-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                  {insights.followUpScript}
                </p>
              </div>
            </div>
          )}

        </div>
      )}

      {/* ── Recent feedback ──────────────────────────────────────────────────── */}
      {feedback.length > 0 && (
        <div className="mt-4 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">
            Recent Feedback
          </h2>
          {feedback.slice(0, 5).map(f => (
            <div key={f.id} className="p-3 bg-gray-50 dark:bg-slate-800 rounded-lg mb-2 last:mb-0">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-gray-900 dark:text-slate-100">{f.name}</p>
                <span className="text-xs text-amber-400">
                  {'★'.repeat(f.rating)}{'☆'.repeat(5 - f.rating)}
                </span>
              </div>
              <p className="text-sm text-gray-600 dark:text-slate-400">{f.comment}</p>
            </div>
          ))}
        </div>
      )}

    </Layout>
  );
}

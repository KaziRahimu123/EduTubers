'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle, XCircle, RotateCcw, ChevronRight, ChevronLeft, Download, Lock } from 'lucide-react';
import { dbGetCourse, dbSaveQuizAttempt, dbCountQuizAttempts, dbIncrementViews, dbIncrementCompletions, uid } from '@/lib/db';
import { cleanTitle } from '@/lib/cleanTitle';
import ProgressBar from '@/components/ProgressBar';
import MathText from '@/components/MathText';
import FeedbackForm from '@/components/FeedbackForm';
import type { Course, QuizQuestion, QuizAttemptAnswer, QuizAttemptResult } from '@/lib/types';
import clsx from 'clsx';

// ── Helpers ───────────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isCorrect(q: QuizQuestion, answer: QuizAttemptAnswer): boolean {
  if (q.type === 'multiple_select') {
    const correct = new Set(q.correctAnswers ?? []);
    const selected = new Set(answer.selectedMulti ?? []);
    if (correct.size !== selected.size) return false;
    for (const v of correct) if (!selected.has(v)) return false;
    return true;
  }
  return answer.selected === q.correctAnswer;
}

function QuestionBadge({ type }: { type: QuizQuestion['type'] }) {
  const labels = { multiple_choice: 'MC', true_false: 'T/F', multiple_select: 'Multi' };
  const colors  = { multiple_choice: 'bg-blue-100 text-blue-700', true_false: 'bg-violet-100 text-violet-700', multiple_select: 'bg-teal-100 text-teal-700' };
  return <span className={clsx('text-xs px-1.5 py-0.5 rounded font-semibold', colors[type])}>{labels[type]}</span>;
}

// ── Show Answer Panel ─────────────────────────────────────────────────────────

function ShowAnswerPanel({ explanation }: { explanation?: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="mt-4">
      {!revealed ? (
        <button
          onClick={() => setRevealed(true)}
          className="text-xs text-orange-600 underline hover:text-orange-800 font-medium">
          Show Answer
        </button>
      ) : (
        <div className="p-3 rounded-lg border bg-gray-50 border-gray-200">
          <p className="text-xs text-gray-600 leading-relaxed">{explanation}</p>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function QuizTakerPage() {
  const { id } = useParams<{ id: string }>();
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [attemptsUsed, setAttemptsUsed] = useState(0);

  // Build the question list once on mount — stable, never reshuffled
  const [allQuestions, setAllQuestions] = useState<QuizQuestion[]>([]);
  const [shuffledChoicesMaps, setShuffledChoicesMaps] = useState<number[][]>([]);
  const [answers, setAnswers] = useState<QuizAttemptAnswer[]>([]);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [retrySet, setRetrySet] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function load() {
      const c = await dbGetCourse(id);
      setCourse(c);
      if (c?.contentType === 'quiz' && c.status === 'published') {
        dbIncrementViews(id);
        const count = await dbCountQuizAttempts(id);
        setAttemptsUsed(count);

        const cfg = c.quizConfig;
        const qs = c.modules.flatMap(m => m.quizQuestions);
        const ordered = cfg?.shuffleQuestions ? shuffle(qs) : qs;
        setAllQuestions(ordered);
        setAnswers(ordered.map(q => ({ questionId: q.id })));
        setShuffledChoicesMaps(ordered.map(q => {
          if (!cfg?.shuffleChoices) return q.choices.map((_, i) => i);
          return shuffle(q.choices.map((_, i) => i));
        }));
      }
      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-orange-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!course || course.contentType !== 'quiz') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Quiz not found.</p>
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

  const cfg = course.quizConfig!;
  const fb  = cfg.feedbackSettings;

  if (!fb?.answersPublished) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-sm mx-auto px-4">
          <div className="text-4xl mb-3">⏳</div>
          <h1 className="font-bold text-gray-900 mb-1">{cleanTitle(course.title)}</h1>
          <p className="text-sm text-gray-500">The creator hasn&apos;t published answers yet. Check back soon.</p>
        </div>
      </div>
    );
  }

  if (!allQuestions.length) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">No questions in this quiz.</p>
      </div>
    );
  }

  const attemptsAllowed = cfg.attemptsAllowed ?? 'unlimited';
  const limitReached    = attemptsAllowed !== 'unlimited' && attemptsUsed >= (attemptsAllowed as number);

  // ── Scoring ───────────────────────────────────────────────────────────────

  const score  = submitted ? allQuestions.filter((q, i) => isCorrect(q, answers[i])).length : 0;
  const pct    = allQuestions.length > 0 ? Math.round((score / allQuestions.length) * 100) : 0;
  const passed = pct >= (cfg.passingScore ?? 70);

  // ── Answer setters ────────────────────────────────────────────────────────

  function selectSingle(qIdx: number, choiceDisplayIdx: number) {
    if (submitted) return;
    const originalIdx = shuffledChoicesMaps[qIdx][choiceDisplayIdx];
    setAnswers(a => a.map((ans, i) => i === qIdx ? { ...ans, selected: originalIdx } : ans));
  }

  function toggleMulti(qIdx: number, choiceDisplayIdx: number) {
    if (submitted) return;
    const originalIdx = shuffledChoicesMaps[qIdx][choiceDisplayIdx];
    setAnswers(a => a.map((ans, i) => {
      if (i !== qIdx) return ans;
      const prev = ans.selectedMulti ?? [];
      const next = prev.includes(originalIdx) ? prev.filter(x => x !== originalIdx) : [...prev, originalIdx];
      return { ...ans, selectedMulti: next };
    }));
  }

  async function handleSubmit() {
    if (!course) return;
    const finalScore = allQuestions.filter((q, i) => isCorrect(q, answers[i])).length;
    const finalPct   = Math.round((finalScore / allQuestions.length) * 100);
    const finalPass  = finalPct >= (cfg.passingScore ?? 70);
    const attempt: QuizAttemptResult = {
      id: uid(),
      quizId: course.id, // Use real course UUID instead of route param (which can be a slug string)
      answers,
      score: finalScore,
      total: allQuestions.length,
      percentageScore: finalPct,
      passed: finalPass,
      completedAt: new Date().toISOString(),
      attemptNumber: attemptsUsed + 1,
    };
    await dbSaveQuizAttempt(attempt);
    dbIncrementCompletions(course.id);
    setSubmitted(true);
    setCurrentIdx(0);
  }

  function handleReset() {
    setAnswers(allQuestions.map(q => ({ questionId: q.id })));
    setSubmitted(false);
    setCurrentIdx(0);
    setShowReview(false);
    setRetrySet(new Set());
  }

  // ── Immediate feedback ────────────────────────────────────────────────────
  const showImmediateFeedback = fb?.showAnswerTiming === 'immediately';
  const currentQ   = allQuestions[currentIdx];
  const currentAns = answers[currentIdx];
  const currentMap = shuffledChoicesMaps[currentIdx];

  const currentAnswered = currentQ?.type === 'multiple_select'
    ? (currentAns?.selectedMulti?.length ?? 0) > 0
    : currentAns?.selected !== undefined;

  const currentCorrect = submitted || showImmediateFeedback
    ? isCorrect(currentQ, currentAns)
    : null;

  const allAnswered = answers.every((a, i) => {
    const q = allQuestions[i];
    return q?.type === 'multiple_select' ? (a.selectedMulti?.length ?? 0) > 0 : a.selected !== undefined;
  });

  const progressColor = pct >= (cfg.passingScore ?? 70) ? 'bg-green-500' : 'bg-orange-500';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">{cleanTitle(course.title)}</p>
            {!submitted && <p className="text-xs text-gray-400">{currentIdx + 1} of {allQuestions.length}</p>}
          </div>
          <a href={`/api/quiz-pdf/${id}`} target="_blank" rel="noopener"
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
            <Download size={12} /> PDF
          </a>
        </div>
        {!submitted && (
          <div className="h-1 bg-gray-100">
            <div className="h-1 bg-orange-400 transition-all"
              style={{ width: `${((currentIdx + (currentAnswered ? 1 : 0)) / allQuestions.length) * 100}%` }} />
          </div>
        )}
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6">

        {/* Results Banner */}
        {submitted && fb?.showFinalScore && (
          <div className={clsx('rounded-xl p-5 mb-6 border-2', passed ? 'bg-green-50 border-green-300' : 'bg-orange-50 border-orange-300')}>
            <p className="text-2xl font-bold text-gray-900 mb-1">{passed ? '🎉 You Passed!' : '📚 Keep Practising'}</p>
            <p className="text-sm text-gray-600 mb-3">
              {score} / {allQuestions.length} correct · {pct}%
              {cfg.passingScore && <span className="ml-2 text-gray-400">· Passing: {cfg.passingScore}%</span>}
            </p>
            <ProgressBar value={score} max={allQuestions.length} color={progressColor} />
            <div className="mt-4 flex flex-wrap gap-2">
              {attemptsAllowed === 'unlimited' || attemptsUsed < (attemptsAllowed as number) ? (
                <button onClick={handleReset}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
                  <RotateCcw size={13} /> Retake Quiz
                </button>
              ) : (
                <p className="text-xs text-gray-400">You have used all {attemptsAllowed} attempt{(attemptsAllowed as number) > 1 ? 's' : ''}.</p>
              )}
              {fb?.showAnswerReview && (
                <button onClick={() => setShowReview(r => !r)}
                  className="inline-flex items-center gap-1 px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600">
                  {showReview ? 'Hide Review' : 'Review Answers'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Feedback form — shown after submission */}
        {submitted && (
          <div className="mb-6">
            <FeedbackForm courseId={id} contentTitle={course.title} accentColor="orange" />
          </div>
        )}

        {/* Limit reached */}
        {limitReached && !submitted && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-800">
            You have used all {attemptsAllowed} attempt{(attemptsAllowed as number) > 1 ? 's' : ''} for this quiz.
          </div>
        )}

        {/* Question View */}
        {!submitted && !limitReached && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-orange-100 text-orange-700 text-xs font-bold flex-shrink-0">{currentIdx + 1}</span>
                <QuestionBadge type={currentQ.type} />
                {currentQ.type === 'multiple_select' && <span className="text-xs text-gray-400">Select all that apply</span>}
              </div>
              <MathText className="font-semibold text-gray-900 mb-4 text-base leading-snug block">{currentQ.question}</MathText>

              <div className="space-y-2">
                {currentMap.map((origIdx, displayIdx) => {
                  const choice = currentQ.choices[origIdx];
                  const isMulti = currentQ.type === 'multiple_select';
                  const isSelected = isMulti
                    ? (currentAns?.selectedMulti ?? []).includes(origIdx)
                    : currentAns?.selected === origIdx;
                  const isCorrectChoice = isMulti
                    ? (currentQ.correctAnswers ?? []).includes(origIdx)
                    : origIdx === currentQ.correctAnswer;

                  let cls = 'border border-gray-200 bg-white hover:bg-gray-50 text-gray-800';
                  if (showImmediateFeedback && currentAnswered) {
                    if (isCorrectChoice)    cls = 'border-2 border-green-400 bg-green-50 text-green-800 font-medium';
                    else if (isSelected)   cls = 'border-2 border-red-300 bg-red-50 text-red-700 line-through';
                    else                   cls = 'border border-gray-100 bg-gray-50 text-gray-400';
                  } else if (isSelected) {
                    cls = 'border-2 border-orange-400 bg-orange-50 text-orange-800 font-medium';
                  }

                  return (
                    <button key={displayIdx}
                      disabled={showImmediateFeedback && currentAnswered}
                      onClick={() => isMulti ? toggleMulti(currentIdx, displayIdx) : selectSingle(currentIdx, displayIdx)}
                      className={clsx('w-full text-left px-4 py-2.5 rounded-lg text-sm transition-all', cls)}>
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded border border-current text-xs mr-2 opacity-60 flex-shrink-0">
                        {isMulti ? (isSelected ? '✓' : '') : String.fromCharCode(65 + displayIdx)}
                      </span>
                      <MathText>{choice}</MathText>
                    </button>
                  );
                })}
              </div>

              {showImmediateFeedback && currentAnswered && fb?.showExplanations && currentQ.explanation && (
                <ShowAnswerPanel explanation={currentQ.explanation} />
              )}
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between">
              <button disabled={currentIdx === 0} onClick={() => setCurrentIdx(i => i - 1)}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40">
                <ChevronLeft size={14} /> Prev
              </button>
              {currentIdx < allQuestions.length - 1 ? (
                <button onClick={() => setCurrentIdx(i => i + 1)}
                  disabled={showImmediateFeedback && !currentAnswered}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-40">
                  Next <ChevronRight size={14} />
                </button>
              ) : (
                <button onClick={handleSubmit} disabled={!allAnswered}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-orange-500 text-white font-medium rounded-lg hover:bg-orange-600 disabled:opacity-50">
                  Submit Quiz <CheckCircle size={14} />
                </button>
              )}
            </div>

            {/* Question dots */}
            <div className="flex flex-wrap gap-1.5 justify-center pt-2">
              {allQuestions.map((q, i) => {
                const ans     = answers[i];
                const answered = q.type === 'multiple_select'
                  ? (ans?.selectedMulti?.length ?? 0) > 0
                  : ans?.selected !== undefined;
                return (
                  <button key={i} onClick={() => setCurrentIdx(i)}
                    className={clsx('w-6 h-6 rounded-full text-xs font-bold transition-colors',
                      i === currentIdx ? 'bg-orange-500 text-white' :
                      answered ? 'bg-orange-200 text-orange-800' : 'bg-gray-200 text-gray-500')}>
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Answer Review */}
        {submitted && fb?.showAnswerReview && showReview && (
          <div className="space-y-4">
            {allQuestions.map((q, qi) => {
              const ans     = answers[qi];
              const correct = isCorrect(q, ans);
              const map     = shuffledChoicesMaps[qi];
              return (
                <div key={q.id} className={clsx('bg-white rounded-xl border-2 p-5', correct ? 'border-green-200' : 'border-red-200')}>
                  <div className="flex items-center gap-2 mb-2">
                    {correct ? <CheckCircle size={15} className="text-green-500 flex-shrink-0" /> : <XCircle size={15} className="text-red-400 flex-shrink-0" />}
                    <QuestionBadge type={q.type} />
                    <span className="text-xs text-gray-400">Q{qi + 1}</span>
                  </div>
                  <MathText className="font-semibold text-gray-900 mb-3 text-sm leading-snug block">{q.question}</MathText>
                  <div className="space-y-1.5">
                    {map.map((origIdx, displayIdx) => {
                      const choice = q.choices[origIdx];
                      const isMulti = q.type === 'multiple_select';
                      const isSelected = isMulti
                        ? (ans?.selectedMulti ?? []).includes(origIdx)
                        : ans?.selected === origIdx;
                      const isCorrectChoice = isMulti
                        ? (q.correctAnswers ?? []).includes(origIdx)
                        : origIdx === q.correctAnswer;
                      let cls = 'text-gray-400 bg-gray-50 border-gray-100';
                      if (isCorrectChoice) cls = 'text-green-800 bg-green-50 border-green-300 font-medium';
                      else if (isSelected && !isCorrectChoice) cls = 'text-red-700 bg-red-50 border-red-300 line-through';
                      return (
                        <div key={displayIdx} className={clsx('px-3 py-2 rounded-lg border text-xs', cls)}>
                          <span className="opacity-60 mr-1.5">{String.fromCharCode(65 + displayIdx)}.</span>
                          <MathText>{choice}</MathText>
                          {isCorrectChoice && <span className="ml-2 text-green-600">✓ correct</span>}
                          {isSelected && !isCorrectChoice && <span className="ml-2 text-red-500">✗ your answer</span>}
                        </div>
                      );
                    })}
                  </div>
                  {fb?.showExplanations && q.explanation && (
                    <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                      <MathText className="text-xs text-gray-600 leading-relaxed">{q.explanation}</MathText>
                    </div>
                  )}
                  {fb?.allowRetryIncorrect && !correct && !retrySet.has(q.id) && (
                    <button onClick={() => {
                      setRetrySet(s => new Set([...s, q.id]));
                      setAnswers(a => a.map((ans2, i) => i === qi ? { questionId: q.id } : ans2));
                      setSubmitted(false);
                      setCurrentIdx(qi);
                    }} className="mt-2 inline-flex items-center gap-1 text-xs text-orange-600 underline">
                      <RotateCcw size={11} /> Retry this question
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

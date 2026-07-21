'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, ChevronLeft, ChevronRight, RotateCcw, CheckCircle } from 'lucide-react';
import { dbGetCourse } from '@/lib/db';
import { markModuleComplete, getProgress } from '@/lib/store';
import ProgressBar from '@/components/ProgressBar';
import { RichField } from '@/components/RichNotesEditor';
import type { Course, Module } from '@/lib/types';

// ── Colour palettes ───────────────────────────────────────────────────────────

const CARD_COLORS = [
  { bg: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-800',   badge: 'bg-blue-100 text-blue-700'   },
  { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-800', badge: 'bg-purple-100 text-purple-700' },
  { bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-800',  badge: 'bg-green-100 text-green-700'  },
  { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-800', badge: 'bg-orange-100 text-orange-700' },
  { bg: 'bg-pink-50',   border: 'border-pink-200',   text: 'text-pink-800',   badge: 'bg-pink-100 text-pink-700'   },
  { bg: 'bg-teal-50',   border: 'border-teal-200',   text: 'text-teal-800',   badge: 'bg-teal-100 text-teal-700'   },
];

const TASK_COLORS = [
  { header: 'bg-indigo-600', body: 'bg-indigo-50 border-indigo-100' },
  { header: 'bg-emerald-600', body: 'bg-emerald-50 border-emerald-100' },
  { header: 'bg-rose-600', body: 'bg-rose-50 border-rose-100' },
  { header: 'bg-amber-500', body: 'bg-amber-50 border-amber-100' },
];

// ── Flashcard viewer ─────────────────────────────────────────────────────────

function FlashcardViewer({ mod }: { mod: Module }) {
  const cards = mod.flashcards ?? [];
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  if (!cards.length) return <p className="text-gray-400 text-sm text-center py-12">No flashcards in this module.</p>;

  const card = cards[index];
  const col = CARD_COLORS[index % CARD_COLORS.length];

  return (
    <div>
      <div className={`rounded-2xl border-2 ${col.border} ${col.bg} p-8 cursor-pointer select-none min-h-[200px] flex flex-col items-center justify-center text-center`}
        onClick={() => setFlipped(f => !f)}>
        <span className={`text-xs font-bold uppercase tracking-widest mb-4 ${col.text} opacity-60`}>
          {flipped ? 'Definition' : 'Term'}
        </span>
        <p className={`text-lg font-semibold ${col.text} leading-snug`}>
          {flipped ? card.back : card.front}
        </p>
        <p className={`text-xs mt-4 ${col.text} opacity-50`}>Tap to flip</p>
      </div>
      <div className="flex items-center justify-between mt-4">
        <button onClick={() => { setIndex(i => (i > 0 ? i - 1 : cards.length - 1)); setFlipped(false); }}
          className="p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50">
          <ChevronLeft size={18} />
        </button>
        <div className="flex gap-1.5">
          {cards.map((_, i) => (
            <button key={i} onClick={() => { setIndex(i); setFlipped(false); }}
              className={`w-2 h-2 rounded-full transition-colors ${i === index ? 'bg-blue-500' : 'bg-gray-300'}`} />
          ))}
        </div>
        <button onClick={() => { setIndex(i => (i < cards.length - 1 ? i + 1 : 0)); setFlipped(false); }}
          className="p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50">
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="flex justify-center mt-3">
        <button onClick={() => { setIndex(0); setFlipped(false); }}
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
          <RotateCcw size={12} /> Restart
        </button>
      </div>
    </div>
  );
}

// ── Quiz viewer ───────────────────────────────────────────────────────────────

function QuizViewer({ mod }: { mod: Module }) {
  const questions = mod.quizQuestions ?? [];
  const [answers, setAnswers] = useState<(number | null)[]>(questions.map(() => null));
  const [submitted, setSubmitted] = useState(false);

  if (!questions.length) return <p className="text-gray-400 text-sm text-center py-12">No quiz questions in this module.</p>;

  const score = submitted ? answers.filter((a, i) => a === questions[i].correctAnswer).length : 0;
  const pct = Math.round((score / questions.length) * 100);

  function reset() { setAnswers(questions.map(() => null)); setSubmitted(false); }

  return (
    <div className="space-y-5">
      {submitted && (
        <div className={`rounded-xl p-5 border-2 ${pct === 100 ? 'bg-green-50 border-green-300' : pct >= 60 ? 'bg-blue-50 border-blue-300' : 'bg-orange-50 border-orange-300'}`}>
          <p className="font-bold text-lg text-gray-900">{pct === 100 ? '🎉 Perfect score!' : pct >= 60 ? '✅ Good work!' : '📚 Keep studying!'}</p>
          <p className="text-sm text-gray-600 mt-1 mb-3">You got {score} out of {questions.length} correct ({pct}%)</p>
          <ProgressBar value={score} max={questions.length} color={pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-blue-500' : 'bg-orange-500'} />
          <button onClick={reset} className="mt-3 inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"><RotateCcw size={12} /> Retake quiz</button>
        </div>
      )}
      {questions.map((q, qi) => {
        const sel = answers[qi];
        return (
          <div key={q.id} className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="font-semibold text-gray-900 mb-4">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold mr-2">{qi + 1}</span>
              {q.question}
            </p>
            <div className="space-y-2">
              {q.choices.map((choice, ci) => {
                let cls = 'border border-gray-200 bg-white hover:bg-gray-50 text-gray-800';
                if (submitted) {
                  if (ci === q.correctAnswer) cls = 'border-2 border-green-400 bg-green-50 text-green-800 font-medium';
                  else if (ci === sel) cls = 'border-2 border-red-300 bg-red-50 text-red-700 line-through';
                  else cls = 'border border-gray-100 bg-gray-50 text-gray-400';
                } else if (sel === ci) {
                  cls = 'border-2 border-blue-500 bg-blue-50 text-blue-800 font-medium';
                }
                return (
                  <button key={ci} disabled={submitted} onClick={() => { const a = [...answers]; a[qi] = ci; setAnswers(a); }}
                    className={`w-full text-left px-4 py-2.5 rounded-lg text-sm transition-all ${cls}`}>
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-current text-xs mr-2 opacity-60">
                      {String.fromCharCode(65 + ci)}
                    </span>
                    {choice}
                  </button>
                );
              })}
            </div>
            {submitted && (
              <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                <p className="text-xs font-semibold text-gray-700 mb-1">
                  {sel === q.correctAnswer ? '✅ Correct!' : `❌ Correct answer: "${q.choices[q.correctAnswer]}"`}
                </p>
                <p className="text-xs text-gray-500 leading-relaxed">{q.explanation}</p>
              </div>
            )}
          </div>
        );
      })}
      {!submitted && (
        <button onClick={() => setSubmitted(true)} disabled={answers.some(a => a === null)}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          Submit Quiz
        </button>
      )}
    </div>
  );
}

// ── Practice tasks viewer ─────────────────────────────────────────────────────

function TasksViewer({ mod }: { mod: Module }) {
  const tasks = mod.practiceTasks ?? [];
  const [responses, setResponses] = useState<string[]>(tasks.map(() => ''));
  const [revealed, setRevealed] = useState<boolean[]>(tasks.map(() => false));

  if (!tasks.length) return <p className="text-gray-400 text-sm text-center py-12">No practice tasks in this module.</p>;

  return (
    <div className="space-y-5">
      {tasks.map((task, i) => {
        const col = TASK_COLORS[i % TASK_COLORS.length];
        return (
          <div key={task.id} className="overflow-hidden rounded-xl border border-gray-200">
            <div className={`${col.header} px-5 py-3`}>
              <p className="font-semibold text-white text-sm">Task {i + 1}: {task.title}</p>
            </div>
            <div className={`${col.body} p-5`}>
              <p className="text-sm text-gray-700 leading-relaxed mb-4">{task.description}</p>
              <label className="block text-sm font-medium text-gray-700 mb-2">Your Response</label>
              <RichField value={responses[i]} onChange={v => { const r = [...responses]; r[i] = v; setResponses(r); }} placeholder="Write your response here…" minHeight="100px" />
              <div className="mt-3">
                {!revealed[i] ? (
                  <button onClick={() => { const r = [...revealed]; r[i] = true; setRevealed(r); }}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-gray-600">
                    Reveal Answer Key
                  </button>
                ) : (
                  <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                    <p className="text-xs font-bold text-green-700 mb-1">✅ Answer Key</p>
                    <p className="text-sm text-green-800 leading-relaxed">{task.answerKey}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

const TABS = ['Lesson', 'Flashcards', 'Quiz', 'Practice Tasks'];
const TAB_COLORS = ['text-blue-700 border-blue-600', 'text-purple-700 border-purple-600', 'text-orange-700 border-orange-600', 'text-green-700 border-green-600'];

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PublicModulePage() {
  const params = useParams();
  const id = params.id as string;
  const moduleId = params.moduleId as string;

  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(0);
  const [progress, setProgress] = useState<Record<string, boolean>>({});

  useEffect(() => {
    dbGetCourse(id).then(c => {
      setCourse(c);
      setLoading(false);
      if (c) setProgress(getProgress(c.id));
    });
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-7 h-7 border-3 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  const mod = course?.modules.find(m => m.id === moduleId);

  if (!course || !mod || course.status !== 'published') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Module not available.</p>
      </div>
    );
  }

  const modIndex = course.modules.findIndex(m => m.id === moduleId);
  const prevMod = modIndex > 0 ? course.modules[modIndex - 1] : null;
  const nextMod = modIndex < course.modules.length - 1 ? course.modules[modIndex + 1] : null;
  const isDone = progress[mod.id] === true;

  function complete() { markModuleComplete(id, moduleId); setProgress(getProgress(id)); }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link href={`/course/${id}`} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 font-medium">
            <ArrowLeft size={14} /> Back
          </Link>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">{mod.title}</p>
            <p className="text-xs text-gray-400">Module {modIndex + 1} of {course.modules.length}</p>
          </div>
          {isDone && <CheckCircle size={18} className="text-green-500 flex-shrink-0" />}
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Tab bar */}
        <div className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
          {TABS.map((t, i) => (
            <button key={t} onClick={() => setTab(i)}
              className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${tab === i ? TAB_COLORS[i] : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t}
            </button>
          ))}
        </div>

        {/* Lesson */}
        {tab === 0 && (
          <div className="space-y-4">
            {mod.objective && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                <p className="text-xs font-bold text-blue-700 uppercase tracking-wide mb-1">Objective</p>
                <p className="text-sm text-blue-800 leading-relaxed">{mod.objective}</p>
              </div>
            )}
            {mod.lessonNotes && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-base font-semibold text-gray-900 mb-3">Lesson Notes</h2>
                <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{mod.lessonNotes}</div>
              </div>
            )}
            {mod.examples && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-1">Examples</p>
                <div className="text-sm text-amber-900 leading-relaxed whitespace-pre-wrap">{mod.examples}</div>
              </div>
            )}
          </div>
        )}

        {tab === 1 && <FlashcardViewer mod={mod} />}
        {tab === 2 && <QuizViewer mod={mod} />}
        {tab === 3 && <TasksViewer mod={mod} />}

        {/* Bottom nav */}
        <div className="flex items-center justify-between mt-10 pt-4 border-t border-gray-200">
          {prevMod
            ? <Link href={`/course/${id}/module/${prevMod.id}`} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white hover:bg-gray-50"><ChevronLeft size={13} /> Prev</Link>
            : <div />}
          {!isDone && (
            <button onClick={complete} className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700">
              <CheckCircle size={14} /> Mark Complete
            </button>
          )}
          {nextMod
            ? <Link href={`/course/${id}/module/${nextMod.id}`} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Next <ChevronRight size={13} /></Link>
            : <Link href={`/course/${id}`} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white hover:bg-gray-50">Back to Guide</Link>}
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Save, Trash2, Plus, Globe, Lock, Download,
  Settings2, MessageSquare, ChevronDown, ChevronUp, CheckCircle,
  Eye, RotateCcw,
} from 'lucide-react';
import Layout from '@/components/Layout';
import { dbGetCourse, dbSaveCourse, dbDeleteCourse, dbGetQuizAttempts, dbDeleteQuizAttempts, uid } from '@/lib/db';
import { RichField } from '@/components/RichNotesEditor';
import ProgressBar from '@/components/ProgressBar';
import type {
  Course, QuizQuestion, QuizConfig, QuizFeedbackSettings,
  LearnerLevel, QuizDifficulty, QuestionType,
} from '@/lib/types';
import clsx from 'clsx';

// ── Helpers ───────────────────────────────────────────────────────────────────

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400';

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle}
      className={clsx('relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none flex-shrink-0', on ? 'bg-orange-500' : 'bg-gray-200')}>
      <span className={clsx('inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform', on ? 'translate-x-4.5' : 'translate-x-0.5')} />
    </button>
  );
}

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  multiple_choice: 'Multiple Choice',
  true_false:      'True or False',
  multiple_select: 'Multiple Select',
};

// ── Question Editor Row ───────────────────────────────────────────────────────

function QuestionEditor({
  q, idx, onPatch, onDelete,
}: {
  q: QuizQuestion & { modIdx: number; qIdx: number };
  idx: number;
  onPatch: (modIdx: number, qIdx: number, patch: Partial<QuizQuestion>) => void;
  onDelete: (modIdx: number, qIdx: number) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex items-center gap-2 px-4 py-3 cursor-pointer select-none" onClick={() => setExpanded(e => !e)}>
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-orange-100 text-orange-700 text-xs font-bold flex-shrink-0">{idx + 1}</span>
        <span className={clsx('text-xs px-1.5 py-0.5 rounded font-semibold', {
          'bg-blue-100 text-blue-700':   q.type === 'multiple_choice',
          'bg-violet-100 text-violet-700': q.type === 'true_false',
          'bg-teal-100 text-teal-700':  q.type === 'multiple_select',
        })}>{QUESTION_TYPE_LABELS[q.type]}</span>
        <p className="flex-1 text-sm text-gray-700 truncate min-w-0">{q.question || <span className="text-gray-300">Question text…</span>}</p>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button onClick={e => { e.stopPropagation(); onDelete(q.modIdx, q.qIdx); }}
            className="p-1 text-gray-300 hover:text-red-400"><Trash2 size={13} /></button>
          {expanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-3">
          {/* Type selector */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Question Type</label>
            <select className={clsx(inp, 'text-xs')} value={q.type}
              onChange={e => {
                const newType = e.target.value as QuestionType;
                const patch: Partial<QuizQuestion> = { type: newType };
                if (newType === 'true_false') patch.choices = ['True', 'False'];
                else if (q.type === 'true_false') patch.choices = ['', '', '', ''];
                if (newType !== 'multiple_select') patch.correctAnswers = undefined;
                onPatch(q.modIdx, q.qIdx, patch);
              }}>
              <option value="multiple_choice">Multiple Choice</option>
              <option value="true_false">True or False</option>
              <option value="multiple_select">Multiple Select</option>
            </select>
          </div>

          {/* Question text */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Question</label>
            <RichField value={q.question} onChange={v => onPatch(q.modIdx, q.qIdx, { question: v })} placeholder="Enter question…" minHeight="60px" />
          </div>

          {/* Choices */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              {q.type === 'multiple_select' ? 'Choices — tick all correct:' : 'Choices — select correct:'}
            </label>
            <div className="space-y-1.5">
              {q.choices.map((choice, ci) => {
                const isMulti = q.type === 'multiple_select';
                const isCorrectMulti = (q.correctAnswers ?? []).includes(ci);
                const isCorrectSingle = q.correctAnswer === ci;

                return (
                  <div key={ci} className="flex items-center gap-2">
                    {isMulti ? (
                      <input type="checkbox" checked={isCorrectMulti}
                        onChange={() => {
                          const prev = q.correctAnswers ?? [];
                          const next = isCorrectMulti ? prev.filter(x => x !== ci) : [...prev, ci];
                          onPatch(q.modIdx, q.qIdx, { correctAnswers: next });
                        }}
                        className="accent-orange-500 flex-shrink-0" />
                    ) : (
                      <input type="radio" name={`correct-${q.id}`} checked={isCorrectSingle}
                        onChange={() => onPatch(q.modIdx, q.qIdx, { correctAnswer: ci })}
                        className="accent-orange-500 flex-shrink-0" />
                    )}
                    <input
                      disabled={q.type === 'true_false'}
                      className={clsx(inp, 'py-1 text-xs',
                        (isMulti ? isCorrectMulti : isCorrectSingle) ? 'border-green-400 bg-green-50' : '',
                        q.type === 'true_false' && 'opacity-70 cursor-not-allowed'
                      )}
                      value={choice}
                      onChange={e => {
                        const ch = [...q.choices];
                        ch[ci] = e.target.value;
                        onPatch(q.modIdx, q.qIdx, { choices: ch });
                      }}
                      placeholder={`Choice ${ci + 1}…`}
                    />
                  </div>
                );
              })}
            </div>

            {/* Add/remove choice for MC/multi-select */}
            {q.type !== 'true_false' && q.choices.length < 6 && (
              <button type="button"
                onClick={() => onPatch(q.modIdx, q.qIdx, { choices: [...q.choices, ''] })}
                className="mt-1.5 text-xs text-orange-500 hover:underline">
                + Add choice
              </button>
            )}
          </div>

          {/* Explanation */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Explanation</label>
            <RichField value={q.explanation} onChange={v => onPatch(q.modIdx, q.qIdx, { explanation: v })}
              placeholder="Why is this the correct answer?" minHeight="60px" />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function QuizEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [course, setCourse] = useState<Course | null>(null);
  const [attempts, setAttempts] = useState<Awaited<ReturnType<typeof dbGetQuizAttempts>>>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const DELAYS = [300, 700, 1500, 2500, 3000];
      let c = await dbGetCourse(id);
      for (let i = 0; !c && i < DELAYS.length; i++) {
        await new Promise(r => setTimeout(r, DELAYS[i]));
        c = await dbGetCourse(id);
      }
      if (!c || c.contentType !== 'quiz') { router.replace('/dashboard'); return; }
      setCourse(c);
    })();
    dbGetQuizAttempts(id).then(setAttempts);
  }, [id, router]);

  if (!course) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-orange-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const cfg = course.quizConfig!;
  const fb  = cfg.feedbackSettings;

  const allQuestions = course.modules.flatMap((m, mi) =>
    m.quizQuestions.map((q, qi) => ({ ...q, modIdx: mi, qIdx: qi }))
  );

  function update(patch: Partial<Course>) {
    const updated = { ...course!, ...patch };
    setCourse(updated);
    dbSaveCourse(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  function patchConfig(patch: Partial<QuizConfig>) {
    update({ quizConfig: { ...cfg, ...patch } });
  }

  function patchFeedback(patch: Partial<QuizFeedbackSettings>) {
    patchConfig({ feedbackSettings: { ...fb, ...patch } });
  }

  function patchQuestion(modIdx: number, qIdx: number, patch: Partial<QuizQuestion>) {
    const modules = course!.modules.map((m, mi) => {
      if (mi !== modIdx) return m;
      return { ...m, quizQuestions: m.quizQuestions.map((q, qi) => qi === qIdx ? { ...q, ...patch } : q) };
    });
    update({ modules });
  }

  function deleteQuestion(modIdx: number, qIdx: number) {
    const modules = course!.modules.map((m, mi) => {
      if (mi !== modIdx) return m;
      return { ...m, quizQuestions: m.quizQuestions.filter((_, qi) => qi !== qIdx) };
    });
    update({ modules });
  }

  function addQuestion() {
    const modules = [...course!.modules];
    if (!modules.length) {
      modules.push({ id: uid(), title: 'Quiz', objective: '', lessonNotes: '', examples: '', flashcards: [], quizQuestions: [], practiceTasks: [] });
    }
    const newQ: QuizQuestion = {
      id: uid(),
      type: 'multiple_choice',
      question: '',
      choices: ['', '', '', ''],
      correctAnswer: 0,
      explanation: '',
    };
    modules[0] = { ...modules[0], quizQuestions: [...modules[0].quizQuestions, newQ] };
    update({ modules });
  }

  function togglePublish() {
    update({ status: course!.status === 'published' ? 'draft' : 'published' });
  }

  const passingScore = cfg.passingScore ?? 70;
  const avgScore = attempts.length > 0
    ? Math.round(attempts.reduce((sum, a) => sum + a.percentageScore, 0) / attempts.length)
    : null;
  const passRate = attempts.length > 0
    ? Math.round((attempts.filter(a => a.passed).length / attempts.length) * 100)
    : null;

  return (
    <Layout>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <button onClick={() => router.push('/dashboard')}
            className="mt-1 p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 flex-shrink-0">
            <ArrowLeft size={16} />
          </button>
          <div className="flex-1 min-w-0">
            <input
              className="w-full text-xl font-bold border-b border-transparent hover:border-gray-300 focus:border-orange-400 bg-transparent focus:outline-none pb-0.5 text-gray-900"
              value={course.title}
              onChange={e => update({ title: e.target.value })}
            />
            <div className="flex items-center gap-2 mt-1">
              <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold',
                course.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                {course.status === 'published' ? <><Globe size={10} /> Published</> : <><Lock size={10} /> Draft</>}
              </span>
              <span className="text-xs text-gray-400">{allQuestions.length} questions</span>
              {saved && <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle size={11} /> Saved</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <a href={`/api/quiz-pdf/${id}`} target="_blank" rel="noopener"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
            <Download size={13} /> PDF
          </a>
          <Link href={`/quiz/${id}`} target="_blank"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
            <Eye size={13} /> Preview
          </Link>
          <button onClick={togglePublish}
            className={clsx('inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors',
              course.status === 'published'
                ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                : 'bg-orange-500 text-white hover:bg-orange-600')}>
            {course.status === 'published' ? <><Lock size={13} /> Unpublish</> : <><Globe size={13} /> Publish</>}
          </button>
          <button onClick={() => { dbDeleteCourse(id); dbDeleteQuizAttempts(id); router.push('/dashboard'); }}
            className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Public link */}
      {course.status === 'published' && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4 flex items-center gap-3 text-sm">
          <Globe size={14} className="text-green-600 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-green-800 font-medium">Quiz is live</p>
            <p className="text-xs text-green-600 truncate">{typeof window !== 'undefined' ? `${window.location.origin}/quiz/${id}` : `/quiz/${id}`}</p>
          </div>
          <Link href={`/quiz/${id}`} target="_blank"
            className="px-3 py-1 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 flex-shrink-0">
            Open
          </Link>
        </div>
      )}


      <div className="space-y-4">
        {/* ── Quiz Settings ──────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-200">
          <button onClick={() => setShowSettings(s => !s)}
            className="w-full flex items-center justify-between p-4 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-xl">
            <span className="flex items-center gap-2"><Settings2 size={14} className="text-orange-500" /> Quiz Settings</span>
            {showSettings ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {showSettings && (
            <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-4">

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Target Audience</label>
                  <select className={inp} value={cfg.targetAudience}
                    onChange={e => patchConfig({ targetAudience: e.target.value as LearnerLevel })}>
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Difficulty</label>
                  <select className={inp} value={cfg.difficulty}
                    onChange={e => patchConfig({ difficulty: e.target.value as QuizDifficulty })}>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                    <option value="mixed">Mixed</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Passing Score (%)</label>
                  <input type="number" min={1} max={100} className={inp} value={cfg.passingScore}
                    onChange={e => patchConfig({ passingScore: Math.min(100, Math.max(1, parseInt(e.target.value) || 70)) })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Attempts Allowed</label>
                  <select className={inp}
                    value={cfg.attemptsAllowed === 'unlimited' ? 'unlimited' : String(cfg.attemptsAllowed)}
                    onChange={e => patchConfig({ attemptsAllowed: e.target.value === 'unlimited' ? 'unlimited' : parseInt(e.target.value) })}>
                    <option value="unlimited">Unlimited</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="5">5</option>
                  </select>
                </div>
              </div>

              <div className="space-y-3 pt-1">
                {([
                  { key: 'shuffleQuestions' as const, label: 'Shuffle questions' },
                  { key: 'shuffleChoices' as const,   label: 'Shuffle answer choices' },
                ] as const).map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between">
                    <p className="text-sm text-gray-700">{label}</p>
                    <Toggle on={cfg[key]} onToggle={() => patchConfig({ [key]: !cfg[key] })} />
                  </div>
                ))}
              </div>

              {/* Passing score visual */}
              <div>
                <p className="text-xs text-gray-500 mb-1">Passing threshold at {passingScore}%</p>
                <ProgressBar value={passingScore} max={100} color="bg-orange-400" />
              </div>

              {/* Reset attempts */}
              {attempts.length > 0 && (
                <div className="pt-2 border-t border-gray-100">
                  <button onClick={() => dbDeleteQuizAttempts(id)}
                    className="inline-flex items-center gap-1.5 text-xs text-red-500 hover:underline">
                    <RotateCcw size={11} /> Reset all attempt data ({attempts.length} attempts)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Answer & Feedback Settings ─────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-200">
          <button onClick={() => setShowFeedback(s => !s)}
            className="w-full flex items-center justify-between p-4 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-xl">
            <span className="flex items-center gap-2"><MessageSquare size={14} className="text-gray-400" /> Answer & Feedback Settings</span>
            {showFeedback ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {showFeedback && (
            <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Show the correct answer:</label>
                <div className="space-y-2">
                  {([
                    { v: 'immediately' as const,      label: 'Immediately after each question' },
                    { v: 'after_submission' as const, label: 'Only after quiz submission' },
                  ]).map(({ v, label }) => (
                    <label key={v} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input type="radio" name="showAnswerTiming-edit" value={v}
                        checked={fb.showAnswerTiming === v}
                        onChange={() => patchFeedback({ showAnswerTiming: v })}
                        className="accent-orange-500" />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              {([
                { key: 'showExplanations' as const,    label: 'Show explanations',                  desc: 'Show AI explanation for each question'           },
                { key: 'allowRetryIncorrect' as const, label: 'Allow retry on incorrect questions',  desc: 'Let takers re-attempt questions they got wrong'  },
                { key: 'showFinalScore' as const,      label: 'Show final score',                   desc: 'Display total score at the end'                  },
                { key: 'showAnswerReview' as const,    label: 'Show answer review',                 desc: 'Let takers review all questions after submitting' },
                { key: 'answersPublished' as const,    label: 'Answers visible to takers',          desc: 'Uncheck to hide answers until you\'re ready'     },
              ]).map(({ key, label, desc }) => (
                <div key={key} className="flex items-center justify-between border-t border-gray-100 pt-3">
                  <div>
                    <p className="text-sm font-medium text-gray-700">{label}</p>
                    <p className="text-xs text-gray-400">{desc}</p>
                  </div>
                  <Toggle on={fb[key] as boolean} onToggle={() => patchFeedback({ [key]: !fb[key] })} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Questions ─────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-900">
              Questions
              <span className="ml-2 text-xs font-normal text-gray-400">{allQuestions.length}</span>
            </h2>
            <button onClick={addQuestion}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-orange-300 rounded-lg text-orange-600 hover:bg-orange-50">
              <Plus size={12} /> Add Question
            </button>
          </div>

          <div className="space-y-3">
            {allQuestions.map((q, i) => (
              <QuestionEditor key={q.id} q={q} idx={i} onPatch={patchQuestion} onDelete={deleteQuestion} />
            ))}
            {!allQuestions.length && (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
                No questions yet.{' '}
                <button onClick={addQuestion} className="text-orange-500 underline">Add the first one</button>
              </div>
            )}
          </div>
        </div>

        {/* Bottom save */}
        <div className="flex items-center justify-between pt-2">
          <button onClick={() => dbSaveCourse(course)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600">
            <Save size={14} /> Save Changes
          </button>
          {saved && <p className="text-xs text-green-600 flex items-center gap-1"><CheckCircle size={11} /> Changes saved</p>}
        </div>
      </div>
    </Layout>
  );
}

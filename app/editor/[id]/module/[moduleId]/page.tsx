'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Save, Plus, Trash2 } from 'lucide-react';
import Layout from '@/components/Layout';
import { dbGetCourse, dbSaveCourse, uid } from '@/lib/db';
import type { Course, Module, Flashcard, QuizQuestion, PracticeTask } from '@/lib/types';
import RichNotesEditor, { RichField } from '@/components/RichNotesEditor';

const TABS = ['Lesson', 'Flashcards', 'Quiz', 'Practice Tasks'];
const TAB_COLORS = ['border-blue-600 text-blue-700', 'border-purple-600 text-purple-700', 'border-orange-500 text-orange-700', 'border-green-600 text-green-700'];

export default function ModuleEditorPage() {
  const params = useParams();
  const router = useRouter();
  const courseId = params.id as string;
  const moduleId = params.moduleId as string;
  const [course, setCourse] = useState<Course | null>(null);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    dbGetCourse(courseId).then(c => { if (c) setCourse(c); });
  }, [courseId]);

  if (!course) return <Layout><p className="text-center py-20 text-gray-500">Loading…</p></Layout>;
  const modIndex = course.modules.findIndex(m => m.id === moduleId);
  if (modIndex < 0) return <Layout><p className="text-center py-20 text-gray-500">Module not found.</p></Layout>;
  const mod = course.modules[modIndex];

  function patchModule(patch: Partial<Module>) {
    const modules = [...course!.modules];
    modules[modIndex] = { ...modules[modIndex], ...patch };
    const updated = { ...course!, modules };
    setCourse(updated);
    dbSaveCourse(updated);
  }

  function patchFlashcard(idx: number, patch: Partial<Flashcard>) {
    const flashcards = [...mod.flashcards];
    flashcards[idx] = { ...flashcards[idx], ...patch };
    patchModule({ flashcards });
  }
  function patchQuestion(idx: number, patch: Partial<QuizQuestion>) {
    const quizQuestions = [...mod.quizQuestions];
    quizQuestions[idx] = { ...quizQuestions[idx], ...patch };
    patchModule({ quizQuestions });
  }
  function patchTask(idx: number, patch: Partial<PracticeTask>) {
    const practiceTasks = [...mod.practiceTasks];
    practiceTasks[idx] = { ...practiceTasks[idx], ...patch };
    patchModule({ practiceTasks });
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <Layout>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push(`/editor/${courseId}`)} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft size={15} /> Back
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900 truncate">{mod.title}</h1>
          <p className="text-xs text-gray-400">{course.title}</p>
        </div>
        <button onClick={() => dbSaveCourse(course!)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"><Save size={13} /> Save</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-5 overflow-x-auto">
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
          {/* Module Title */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Module Title</label>
            <input className={inp} value={mod.title} onChange={e => patchModule({ title: e.target.value })} />
          </div>
          {/* Objective */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Objective</label>
            <RichField value={mod.objective} onChange={v => patchModule({ objective: v })} placeholder="What will learners achieve?" minHeight="70px" />
          </div>
          {/* Lesson Notes */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Lesson Notes</label>
            <RichField value={mod.lessonNotes ?? ''} onChange={v => patchModule({ lessonNotes: v })} placeholder="Lesson content…" minHeight="240px" />
          </div>
          {/* Examples */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Examples</label>
            <RichField value={mod.examples} onChange={v => patchModule({ examples: v })} placeholder="Worked examples…" minHeight="80px" accentColor="#d97706" />
          </div>
        </div>
      )}

      {/* Flashcards */}
      {tab === 1 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-500">{mod.flashcards.length} flashcard{mod.flashcards.length !== 1 ? 's' : ''}</p>
            <button onClick={() => patchModule({ flashcards: [...mod.flashcards, { id: uid(), front: '', back: '' }] })}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"><Plus size={12} /> Add Card</button>
          </div>
          <div className="space-y-3">
            {mod.flashcards.map((card, i) => (
              <div key={card.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Card {i + 1}</span>
                  <button onClick={() => patchModule({ flashcards: mod.flashcards.filter((_, j) => j !== i) })} className="text-gray-300 hover:text-red-400"><Trash2 size={13} /></button>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Front (Term)</label>
                    <RichField value={card.front} onChange={v => patchFlashcard(i, { front: v })} placeholder="Term…" minHeight="70px" accentColor="#7c3aed" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Back (Definition)</label>
                    <RichField value={card.back} onChange={v => patchFlashcard(i, { back: v })} placeholder="Definition…" minHeight="70px" accentColor="#7c3aed" />
                  </div>
                </div>
              </div>
            ))}
            {!mod.flashcards.length && <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400 text-sm">No flashcards yet.</div>}
          </div>
        </div>
      )}

      {/* Quiz */}
      {tab === 2 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-500">{mod.quizQuestions.length} question{mod.quizQuestions.length !== 1 ? 's' : ''}</p>
            <button onClick={() => patchModule({ quizQuestions: [...mod.quizQuestions, { id: uid(), type: 'multiple_choice' as const, question: '', choices: ['', '', '', ''], correctAnswer: 0, explanation: '' }] })}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"><Plus size={12} /> Add Question</button>
          </div>
          <div className="space-y-4">
            {mod.quizQuestions.map((q, qi) => (
              <div key={q.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-gray-400 uppercase">Q{qi + 1}</span>
                  <button onClick={() => patchModule({ quizQuestions: mod.quizQuestions.filter((_, j) => j !== qi) })} className="text-gray-300 hover:text-red-400"><Trash2 size={13} /></button>
                </div>
                <RichField value={q.question} onChange={v => patchQuestion(qi, { question: v })} placeholder="Question…" minHeight="60px" accentColor="#ea580c" />
                <label className="block text-xs font-medium text-gray-600 mb-2 mt-3">Choices — select correct:</label>
                {q.choices.map((c, ci) => (
                  <div key={ci} className="flex items-center gap-2 mb-2">
                    <input type="radio" name={`correct-${q.id}`} checked={q.correctAnswer === ci} onChange={() => patchQuestion(qi, { correctAnswer: ci })} className="accent-blue-600 flex-shrink-0" />
                    <input className={`${inp} py-1 ${q.correctAnswer === ci ? 'border-green-400 bg-green-50' : ''}`} value={c} onChange={e => { const ch = [...q.choices]; ch[ci] = e.target.value; patchQuestion(qi, { choices: ch }); }} placeholder={`Choice ${ci + 1}…`} />
                  </div>
                ))}
                <label className="block text-xs font-medium text-gray-600 mb-1 mt-3">Explanation</label>
                <RichField value={q.explanation} onChange={v => patchQuestion(qi, { explanation: v })} placeholder="Why is this correct?" minHeight="60px" accentColor="#ea580c" />
              </div>
            ))}
            {!mod.quizQuestions.length && <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400 text-sm">No questions yet.</div>}
          </div>
        </div>
      )}

      {/* Practice Tasks */}
      {tab === 3 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-500">{mod.practiceTasks.length} task{mod.practiceTasks.length !== 1 ? 's' : ''}</p>
            <button onClick={() => patchModule({ practiceTasks: [...mod.practiceTasks, { id: uid(), title: '', topic: '', difficulty: 'beginner' as const, description: '', activity: '', answerFormat: '', hint: '', answerKey: '', explanation: '', incorrectFeedback: '' }] })}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"><Plus size={12} /> Add Task</button>
          </div>
          <div className="space-y-4">
            {mod.practiceTasks.map((task, ti) => (
              <div key={task.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-gray-400 uppercase">Task {ti + 1}</span>
                  <button onClick={() => patchModule({ practiceTasks: mod.practiceTasks.filter((_, j) => j !== ti) })} className="text-gray-300 hover:text-red-400"><Trash2 size={13} /></button>
                </div>
                <div className="space-y-3">
                  <input className={inp} value={task.title} onChange={e => patchTask(ti, { title: e.target.value })} placeholder="Task title…" />
                  <RichField value={task.description} onChange={v => patchTask(ti, { description: v })} placeholder="Task instructions…" minHeight="100px" accentColor="#16a34a" />
                  <RichField value={task.answerKey} onChange={v => patchTask(ti, { answerKey: v })} placeholder="Answer key…" minHeight="80px" accentColor="#16a34a" />
                </div>
              </div>
            ))}
            {!mod.practiceTasks.length && <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400 text-sm">No tasks yet.</div>}
          </div>
        </div>
      )}

      {/* Suppress unused import */}
      {false && <RichNotesEditor value="" onChange={() => {}} />}
    </Layout>
  );
}

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Save, Trash2, Plus } from 'lucide-react';
import Layout from '@/components/Layout';
import { dbGetCourse, dbSaveCourse, dbDeleteCourse, uid } from '@/lib/db';
import type { Course, Flashcard, QuizQuestion, PracticeTask } from '@/lib/types';
import { RichField } from '@/components/RichNotesEditor';
import { cleanTitle } from '@/lib/cleanTitle';

export default function EditorPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [course, setCourse] = useState<Course | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);

  useEffect(() => {
    (async () => {
      const DELAYS = [300, 700, 1500, 2500, 3000];
      let c = await dbGetCourse(id);
      for (let i = 0; !c && i < DELAYS.length; i++) {
        await new Promise(r => setTimeout(r, DELAYS[i]));
        c = await dbGetCourse(id);
      }
      if (!c) return;
      const ct = c.contentType as string;
      if (ct === 'resource_page' || ct === 'visual_notes') { router.replace(`/visual-guide/${id}`); return; }
      if (ct === 'review_cards'  || ct === 'flashcards')   { router.replace(`/editor/${id}/flashcards`); return; }
      if (ct === 'branded_guide' || ct === 'pdf_pack')     { router.replace(`/pdf-pack/${id}`); return; }
      if (ct === 'quiz')                                   { router.replace(`/quiz/${id}/edit`); return; }
      if (ct === 'activities'    || ct === 'tasks')        { router.replace(`/tasks/${id}/edit`); return; }
      setCourse(c);
    })();
  }, [id, router]);

  if (!course) return (
    <Layout>
      <p className="text-center py-20 text-gray-500">
        Loading… <Link href="/dashboard" className="text-blue-600 underline">Back to dashboard</Link>
      </p>
    </Layout>
  );

  function update(patch: Partial<Course>) {
    const updated = { ...course!, ...patch };
    setCourse(updated);
    dbSaveCourse(updated);
  }

  const contentTypeStr = course.contentType as string;

  // ── Flatten all items across modules ──────────────────────────────────────
  const allFlashcards: (Flashcard & { modIdx: number; cardIdx: number })[] =
    course.modules.flatMap((m, mi) => m.flashcards.map((f, fi) => ({ ...f, modIdx: mi, cardIdx: fi })));

  const allQuestions: (QuizQuestion & { modIdx: number; qIdx: number })[] =
    course.modules.flatMap((m, mi) => m.quizQuestions.map((q, qi) => ({ ...q, modIdx: mi, qIdx: qi })));

  const allTasks: (PracticeTask & { modIdx: number; tIdx: number })[] =
    course.modules.flatMap((m, mi) => m.practiceTasks.map((t, ti) => ({ ...t, modIdx: mi, tIdx: ti })));

  function patchFlashcard(modIdx: number, cardIdx: number, patch: Partial<Flashcard>) {
    const modules = course!.modules.map((m, mi) => {
      if (mi !== modIdx) return m;
      const flashcards = m.flashcards.map((f, fi) => fi === cardIdx ? { ...f, ...patch } : f);
      return { ...m, flashcards };
    });
    update({ modules });
  }

  function deleteFlashcard(modIdx: number, cardIdx: number) {
    const modules = course!.modules.map((m, mi) => {
      if (mi !== modIdx) return m;
      return { ...m, flashcards: m.flashcards.filter((_, fi) => fi !== cardIdx) };
    });
    update({ modules });
  }

  function addFlashcard() {
    const modules = [...course!.modules];
    if (!modules.length) modules.push({ id: uid(), title: 'Deck', objective: '', lessonNotes: '', examples: '', flashcards: [], quizQuestions: [], practiceTasks: [] });
    modules[0] = { ...modules[0], flashcards: [...modules[0].flashcards, { id: uid(), front: '', back: '' }] };
    update({ modules });
  }

  function patchQuestion(modIdx: number, qIdx: number, patch: Partial<QuizQuestion>) {
    const modules = course!.modules.map((m, mi) => {
      if (mi !== modIdx) return m;
      const quizQuestions = m.quizQuestions.map((q, qi) => qi === qIdx ? { ...q, ...patch } : q);
      return { ...m, quizQuestions };
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
    if (!modules.length) modules.push({ id: uid(), title: 'Quiz', objective: '', lessonNotes: '', examples: '', flashcards: [], quizQuestions: [], practiceTasks: [] });
    modules[0] = { ...modules[0], quizQuestions: [...modules[0].quizQuestions, { id: uid(), type: 'multiple_choice' as const, question: '', choices: ['', '', '', ''], correctAnswer: 0, explanation: '' }] };
    update({ modules });
  }

  function patchTask(modIdx: number, tIdx: number, patch: Partial<PracticeTask>) {
    const modules = course!.modules.map((m, mi) => {
      if (mi !== modIdx) return m;
      const practiceTasks = m.practiceTasks.map((t, ti) => ti === tIdx ? { ...t, ...patch } : t);
      return { ...m, practiceTasks };
    });
    update({ modules });
  }

  function deleteTask(modIdx: number, tIdx: number) {
    const modules = course!.modules.map((m, mi) => {
      if (mi !== modIdx) return m;
      return { ...m, practiceTasks: m.practiceTasks.filter((_, ti) => ti !== tIdx) };
    });
    update({ modules });
  }

  function addTask() {
    const modules = [...course!.modules];
    if (!modules.length) modules.push({ id: uid(), title: 'Tasks', objective: '', lessonNotes: '', examples: '', flashcards: [], quizQuestions: [], practiceTasks: [] });
    modules[0] = { ...modules[0], practiceTasks: [...modules[0].practiceTasks, { id: uid(), title: '', topic: '', difficulty: 'beginner' as const, description: '', activity: '', answerFormat: '', hint: '', answerKey: '', explanation: '', incorrectFeedback: '' }] };
    update({ modules });
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <Layout>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <button onClick={() => router.push('/dashboard')} className="mt-1 p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 flex-shrink-0">
            <ArrowLeft size={16} />
          </button>
          <div className="flex-1 min-w-0">
            {editingTitle ? (
              <input autoFocus className="w-full text-2xl font-bold border-b-2 border-blue-500 bg-transparent focus:outline-none pb-1"
                value={course.title} onChange={e => update({ title: e.target.value })} onBlur={() => setEditingTitle(false)} />
            ) : (
              <h1 className="text-2xl font-bold text-gray-900 cursor-pointer hover:text-blue-600 transition-colors"
                onClick={() => setEditingTitle(true)} title="Click to edit">{cleanTitle(course.title)}</h1>
            )}
            <p className="text-xs text-gray-400 mt-0.5 capitalize">{course.learnerLevel}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => dbSaveCourse(course)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
            <Save size={13} /> Save
          </button>
          <button onClick={() => { dbDeleteCourse(course.id); router.push('/dashboard'); }}
            className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Description */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5">
        <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
        <input className={inp} value={course.title} onChange={e => update({ title: e.target.value })} />
        <label className="block text-sm font-medium text-gray-700 mb-2 mt-3">Description</label>
        <RichField value={course.description} onChange={v => update({ description: v })} placeholder="Describe what this covers…" />
      </div>

      {/* ── Flashcards ──────────────────────────────────────────────────────── */}
      {(contentTypeStr === 'flashcards' || contentTypeStr === 'review_cards') && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-900">Flashcards
              <span className="ml-2 text-xs font-normal text-gray-400">{allFlashcards.length} cards</span>
            </h2>
            <button onClick={addFlashcard} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">
              <Plus size={12} /> Add Card
            </button>
          </div>
          <div className="space-y-3">
            {allFlashcards.map((card, i) => (
              <div key={card.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Card {i + 1}</span>
                  <button onClick={() => deleteFlashcard(card.modIdx, card.cardIdx)} className="text-gray-300 hover:text-red-400"><Trash2 size={13} /></button>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Front (Term)</label>
                    <RichField value={card.front} onChange={v => patchFlashcard(card.modIdx, card.cardIdx, { front: v })} placeholder="Term or question…" minHeight="70px" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Back (Definition)</label>
                    <RichField value={card.back} onChange={v => patchFlashcard(card.modIdx, card.cardIdx, { back: v })} placeholder="Definition or answer…" minHeight="70px" />
                  </div>
                </div>
              </div>
            ))}
            {!allFlashcards.length && <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">No flashcards yet.</div>}
          </div>
        </div>
      )}

      {/* ── Quiz Questions ───────────────────────────────────────────────────── */}
      {course.contentType === 'quiz' && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-900">Quiz Questions
              <span className="ml-2 text-xs font-normal text-gray-400">{allQuestions.length} questions</span>
            </h2>
            <button onClick={addQuestion} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">
              <Plus size={12} /> Add Question
            </button>
          </div>
          <div className="space-y-4">
            {allQuestions.map((q, qi) => (
              <div key={q.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-gray-400 uppercase">Q{qi + 1}</span>
                  <button onClick={() => deleteQuestion(q.modIdx, q.qIdx)} className="text-gray-300 hover:text-red-400"><Trash2 size={13} /></button>
                </div>
                <RichField value={q.question} onChange={v => patchQuestion(q.modIdx, q.qIdx, { question: v })} placeholder="Question…" minHeight="60px" />
                <label className="block text-xs font-medium text-gray-600 mb-2 mt-3">Choices — select correct:</label>
                {q.choices.map((c, ci) => (
                  <div key={ci} className="flex items-center gap-2 mb-2">
                    <input type="radio" name={`correct-${q.id}`} checked={q.correctAnswer === ci}
                      onChange={() => patchQuestion(q.modIdx, q.qIdx, { correctAnswer: ci })} className="accent-blue-600 flex-shrink-0" />
                    <input className={`${inp} py-1 ${q.correctAnswer === ci ? 'border-green-400 bg-green-50' : ''}`} value={c}
                      onChange={e => { const ch = [...q.choices]; ch[ci] = e.target.value; patchQuestion(q.modIdx, q.qIdx, { choices: ch }); }}
                      placeholder={`Choice ${ci + 1}…`} />
                  </div>
                ))}
                <label className="block text-xs font-medium text-gray-600 mb-1 mt-3">Explanation</label>
                <RichField value={q.explanation} onChange={v => patchQuestion(q.modIdx, q.qIdx, { explanation: v })} placeholder="Why is this correct?" minHeight="60px" />
              </div>
            ))}
            {!allQuestions.length && <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">No questions yet.</div>}
          </div>
        </div>
      )}

      {/* ── Interactive Challenges ───────────────────────────────────────────── */}
      {(contentTypeStr === 'tasks' || contentTypeStr === 'activities') && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-900">Interactive Challenges
              <span className="ml-2 text-xs font-normal text-gray-400">{allTasks.length} tasks</span>
            </h2>
            <button onClick={addTask} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">
              <Plus size={12} /> Add Task
            </button>
          </div>
          <div className="space-y-3">
            {allTasks.map((task, ti) => (
              <div key={task.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-gray-400 uppercase">Task {ti + 1}</span>
                  <button onClick={() => deleteTask(task.modIdx, task.tIdx)} className="text-gray-300 hover:text-red-400"><Trash2 size={13} /></button>
                </div>
                <div className="space-y-3">
                  <input className={inp} value={task.title} onChange={e => patchTask(task.modIdx, task.tIdx, { title: e.target.value })} placeholder="Task title…" />
                  <RichField value={task.description} onChange={v => patchTask(task.modIdx, task.tIdx, { description: v })} placeholder="Task instructions…" minHeight="90px" />
                  <RichField value={task.answerKey} onChange={v => patchTask(task.modIdx, task.tIdx, { answerKey: v })} placeholder="Answer key…" minHeight="70px" accentColor="#16a34a" />
                </div>
              </div>
            ))}
            {!allTasks.length && <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">No tasks yet.</div>}
          </div>
        </div>
      )}

      {/* ── Content Guide Sections ──────────────────────────────────────────── */}
      {(contentTypeStr === 'pdf_pack' || contentTypeStr === 'branded_guide') && (
        <div className="mb-6 space-y-4">
          <h2 className="text-base font-semibold text-gray-900">Content Guide Sections</h2>
          {course.modules.map((mod, mi) => (
            <div key={mod.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <input className={`${inp} mb-3 font-semibold`} value={mod.title}
                onChange={e => { const modules = course.modules.map((m, i) => i === mi ? { ...m, title: e.target.value } : m); update({ modules }); }}
                placeholder="Section title…" />
              <RichField value={mod.lessonNotes} onChange={v => { const modules = course.modules.map((m, i) => i === mi ? { ...m, lessonNotes: v } : m); update({ modules }); }} placeholder="Notes for this section…" minHeight="200px" />
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}

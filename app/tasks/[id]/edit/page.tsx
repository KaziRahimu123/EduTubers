'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Save, Trash2, Plus, Globe, Lock, Eye,
  CheckCircle, ChevronDown, ChevronUp, Lightbulb, Settings2,
} from 'lucide-react';
import Layout from '@/components/Layout';
import { dbGetCourse, dbSaveCourse, dbDeleteCourse, dbProxy, uid } from '@/lib/db';
import { RichField } from '@/components/RichNotesEditor';
import type {
  Course, PracticeTask, PracticeTaskConfig,
  TaskDifficulty, LearnerLevel, TaskAnswerTiming,
} from '@/lib/types';
import clsx from 'clsx';

// ── Helpers ───────────────────────────────────────────────────────────────────

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500';

const DIFFICULTY_COLORS: Record<TaskDifficulty, string> = {
  beginner:     'bg-emerald-100 text-emerald-700',
  intermediate: 'bg-amber-100 text-amber-700',
  challenge:    'bg-rose-100 text-rose-700',
};

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle}
      className={clsx('relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none flex-shrink-0',
        on ? 'bg-green-600' : 'bg-gray-200')}>
      <span className={clsx('inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
        on ? 'translate-x-4.5' : 'translate-x-0.5')} />
    </button>
  );
}

// ── Task Editor Row ───────────────────────────────────────────────────────────

function TaskEditor({
  task, idx,
  onPatch, onDelete,
}: {
  task: PracticeTask & { modIdx: number; tIdx: number };
  idx: number;
  onPatch: (modIdx: number, tIdx: number, patch: Partial<PracticeTask>) => void;
  onDelete: (modIdx: number, tIdx: number) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      {/* Header row */}
      <div className="flex items-center gap-2 px-4 py-3 cursor-pointer select-none"
        onClick={() => setExpanded(e => !e)}>
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-green-100 text-green-700 text-xs font-bold flex-shrink-0">
          {idx + 1}
        </span>
        <span className={clsx('text-xs px-2 py-0.5 rounded-full font-semibold flex-shrink-0',
          DIFFICULTY_COLORS[task.difficulty ?? 'beginner'])}>
          {task.difficulty ?? 'beginner'}
        </span>
        <p className="flex-1 text-sm text-gray-700 truncate min-w-0">
          {task.title || <span className="text-gray-300 italic">Untitled task…</span>}
        </p>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button onClick={e => { e.stopPropagation(); onDelete(task.modIdx, task.tIdx); }}
            className="p-1 text-gray-300 hover:text-red-400">
            <Trash2 size={13} />
          </button>
          {expanded
            ? <ChevronUp size={14} className="text-gray-400" />
            : <ChevronDown size={14} className="text-gray-400" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-4 pb-5 pt-3 space-y-3">

          {/* Title + Topic + Difficulty */}
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Task Title</label>
              <input className={inp} value={task.title}
                onChange={e => onPatch(task.modIdx, task.tIdx, { title: e.target.value })}
                placeholder="e.g. Debug the Login Function…" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Difficulty</label>
              <select className={inp} value={task.difficulty ?? 'beginner'}
                onChange={e => onPatch(task.modIdx, task.tIdx, { difficulty: e.target.value as TaskDifficulty })}>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="challenge">Challenge</option>
              </select>
            </div>
          </div>

          {/* Topic */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Topic / Skill</label>
            <input className={inp} value={task.topic ?? ''}
              onChange={e => onPatch(task.modIdx, task.tIdx, { topic: e.target.value })}
              placeholder="e.g. Variable scope in Python…" />
          </div>

          {/* Instructions */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Instructions</label>
            <RichField value={task.description}
              onChange={v => onPatch(task.modIdx, task.tIdx, { description: v })}
              placeholder="Clear instructions for the learner…"
              minHeight="80px" />
          </div>

          {/* Activity */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Activity <span className="text-gray-400 font-normal">(the code, scenario, passage, problem, data…)</span>
            </label>
            <RichField value={task.activity ?? ''}
              onChange={v => onPatch(task.modIdx, task.tIdx, { activity: v })}
              placeholder="Paste the code snippet, scenario, word problem, passage, or data set here…"
              minHeight="120px" />
          </div>

          {/* Answer format */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Expected Answer Format</label>
            <input className={inp} value={task.answerFormat ?? ''}
              onChange={e => onPatch(task.modIdx, task.tIdx, { answerFormat: e.target.value })}
              placeholder="e.g. A corrected Python function / Short paragraph (3–5 sentences) / Numbered list…" />
          </div>

          {/* Hint */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1.5">
              <Lightbulb size={12} className="text-amber-500" /> Hint <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input className={inp} value={task.hint ?? ''}
              onChange={e => onPatch(task.modIdx, task.tIdx, { hint: e.target.value })}
              placeholder="A nudge that guides thinking without giving the answer away…" />
          </div>

          {/* Review note */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1.5">
              <span className="text-violet-500">📖</span> What to review <span className="text-gray-400 font-normal">(shown if learner is stuck)</span>
            </label>
            <input className={inp} value={task.reviewNote ?? ''}
              onChange={e => onPatch(task.modIdx, task.tIdx, { reviewNote: e.target.value })}
              placeholder="e.g. Review: Python PATH environment variable and how to add it on Windows…" />
          </div>

          {/* Answer Key */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1 text-green-700">
              ✓ Answer / Sample Solution
            </label>
            <RichField value={task.answerKey}
              onChange={v => onPatch(task.modIdx, task.tIdx, { answerKey: v })}
              placeholder="The correct answer or model solution…"
              minHeight="90px"
              accentColor="#16a34a" />
          </div>

          {/* Explanation */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Explanation</label>
            <RichField value={task.explanation ?? ''}
              onChange={v => onPatch(task.modIdx, task.tIdx, { explanation: v })}
              placeholder="Why is this the correct answer? What concept does it reinforce?"
              minHeight="70px" />
          </div>

          {/* Incorrect feedback */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Feedback for Incorrect Answers
            </label>
            <input className={inp} value={task.incorrectFeedback ?? ''}
              onChange={e => onPatch(task.modIdx, task.tIdx, { incorrectFeedback: e.target.value })}
              placeholder="Encouraging feedback pointing out the common mistake and what to review…" />
          </div>

        </div>
      )}
    </div>
  );
}

// ── Main Editor Page ──────────────────────────────────────────────────────────

export default function TasksEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [course, setCourse] = useState<Course | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const DELAYS = [300, 700, 1500, 2500, 3000];
      let c = await dbGetCourse(id);
      for (let i = 0; !c && i < DELAYS.length; i++) {
        await new Promise(r => setTimeout(r, DELAYS[i]));
        c = await dbGetCourse(id);
      }
      if (!c || c.contentType !== 'activities') { router.replace('/dashboard'); return; }
      setCourse(c);
    })();
  }, [id, router]);

  if (!course) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-purple-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const cfg: PracticeTaskConfig = course.taskConfig ?? {
    taskCount: 8,
    learnerLevel: 'beginner',
    difficulty: 'mixed',
    includeHints: true,
    showAnswerTiming: 'after_submission',
    showAnswers: true,
  };

  const allTasks = course.modules.flatMap((m, mi) =>
    m.practiceTasks.map((t, ti) => ({ ...t, modIdx: mi, tIdx: ti }))
  );

  function update(patch: Partial<Course>) {
    const updated = { ...course!, ...patch };
    setCourse(updated);
    dbSaveCourse(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  function patchConfig(patch: Partial<PracticeTaskConfig>) {
    update({ taskConfig: { ...cfg, ...patch } });
  }

  function patchTask(modIdx: number, tIdx: number, patch: Partial<PracticeTask>) {
    const modules = course!.modules.map((m, mi) => {
      if (mi !== modIdx) return m;
      return { ...m, practiceTasks: m.practiceTasks.map((t, ti) => ti === tIdx ? { ...t, ...patch } : t) };
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
    if (!modules.length) {
      modules.push({ id: uid(), title: 'Interactive Challenges', objective: '', lessonNotes: '', examples: '', flashcards: [], quizQuestions: [], practiceTasks: [] });
    }
    const newTask: PracticeTask = {
      id: uid(),
      title: '',
      topic: '',
      difficulty: 'beginner',
      description: '',
      activity: '',
      answerFormat: '',
      hint: '',
      reviewNote: '',
      answerKey: '',
      explanation: '',
      incorrectFeedback: '',
    };
    modules[0] = { ...modules[0], practiceTasks: [...modules[0].practiceTasks, newTask] };
    update({ modules });
  }

  async function togglePublish() {
    if (!course) return;
    const isPublishing = course.status !== 'published';
    let slug = course.slug;
    if (isPublishing && (!slug || slug.trim() === '')) {
      const res = await dbProxy<{ slug: string }>('make_slug', { title: course.title, existingCourseId: course.id });
      slug = res?.slug ?? course.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
    }
    const updated: Course = {
      ...course,
      status: isPublishing ? 'published' : 'draft',
      slug,
    };
    setCourse(updated);
    await dbSaveCourse(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  // ── Difficulty counts for the strip ──────────────────────────────────────

  const countsByDiff = allTasks.reduce<Record<string, number>>((acc, t) => {
    const d = t.difficulty ?? 'beginner';
    acc[d] = (acc[d] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Layout>
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <button onClick={() => router.push('/dashboard')}
            className="mt-1 p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 flex-shrink-0">
            <ArrowLeft size={16} />
          </button>
          <div className="flex-1 min-w-0">
            <input
              className="w-full text-xl font-bold border-b border-transparent hover:border-gray-300 focus:border-green-500 bg-transparent focus:outline-none pb-0.5 text-gray-900"
              value={course.title}
              onChange={e => update({ title: e.target.value })}
            />
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold',
                course.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                {course.status === 'published' ? <><Globe size={10} /> Published</> : <><Lock size={10} /> Draft</>}
              </span>
              <span className="text-xs text-gray-400">{allTasks.length} task{allTasks.length !== 1 ? 's' : ''}</span>
              {Object.entries(countsByDiff).map(([d, n]) => (
                <span key={d} className={clsx('text-xs px-1.5 py-0.5 rounded-full font-medium', DIFFICULTY_COLORS[d as TaskDifficulty])}>
                  {n} {d}
                </span>
              ))}
              {saved && <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle size={11} /> Saved</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <Link href={`/tasks/${id}`} target="_blank"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
            <Eye size={13} /> Preview
          </Link>
          <button onClick={togglePublish}
            className={clsx('inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors',
              course.status === 'published'
                ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                : 'bg-green-600 text-white hover:bg-green-700')}>
            {course.status === 'published'
              ? <><Lock size={13} /> Unpublish</>
              : <><Globe size={13} /> Publish</>}
          </button>
          <button onClick={() => { dbDeleteCourse(id); router.push('/dashboard'); }}
            className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* ── Published banner ─────────────────────────────────────────────── */}
      {course.status === 'published' && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4 flex items-center gap-3 text-sm">
          <Globe size={14} className="text-green-600 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-green-800 font-medium">Interactive Challenges are live</p>
            <p className="text-xs text-green-600 truncate">
              {typeof window !== 'undefined' ? `${window.location.origin}/tasks/${id}` : `/tasks/${id}`}
            </p>
          </div>
          <Link href={`/tasks/${id}`} target="_blank"
            className="px-3 py-1 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 flex-shrink-0">
            Open
          </Link>
        </div>
      )}

      <div className="space-y-4">

        {/* ── Settings ───────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-200">
          <button onClick={() => setShowSettings(s => !s)}
            className="w-full flex items-center justify-between p-4 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-xl">
            <span className="flex items-center gap-2">
              <Settings2 size={14} className="text-green-600" /> Task Settings
            </span>
            {showSettings ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {showSettings && (
            <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-4">

              {/* Description */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                <input className={inp} value={course.description}
                  onChange={e => update({ description: e.target.value })}
                  placeholder="What skills will learners practise?" />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Learner Level</label>
                  <select className={inp} value={cfg.learnerLevel}
                    onChange={e => patchConfig({ learnerLevel: e.target.value as LearnerLevel })}>
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Default Difficulty</label>
                  <select className={inp} value={cfg.difficulty}
                    onChange={e => patchConfig({ difficulty: e.target.value as TaskDifficulty | 'mixed' })}>
                    <option value="mixed">Mixed</option>
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="challenge">Challenge</option>
                  </select>
                </div>
              </div>

              {/* Answer timing */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Show the answer:</label>
                <div className="space-y-2">
                  {([
                    { v: 'immediately' as TaskAnswerTiming,      label: 'Immediately after each task (self-check mode)' },
                    { v: 'after_submission' as TaskAnswerTiming, label: 'Only after submitting all tasks' },
                  ]).map(({ v, label }) => (
                    <label key={v} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                      <input type="radio" name="taskAnswerTimingEdit" value={v}
                        checked={cfg.showAnswerTiming === v}
                        onChange={() => patchConfig({ showAnswerTiming: v })}
                        className="accent-green-600" />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Hints toggle */}
              <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                <div>
                  <p className="text-sm font-medium text-gray-700">Show hints to learners</p>
                  <p className="text-xs text-gray-400">Allow learners to reveal a hint for each task</p>
                </div>
                <Toggle on={cfg.includeHints} onToggle={() => patchConfig({ includeHints: !cfg.includeHints })} />
              </div>

              {/* Show answers toggle */}
              <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                <div>
                  <p className="text-sm font-medium text-gray-700">Show answers to learners</p>
                  <p className="text-xs text-gray-400">
                    {(cfg.showAnswers ?? true)
                      ? 'Learners can see the answer key after marking themselves'
                      : 'Answer key is hidden — learners only see feedback'}
                  </p>
                </div>
                <Toggle
                  on={cfg.showAnswers ?? true}
                  onToggle={() => patchConfig({ showAnswers: !(cfg.showAnswers ?? true) })}
                />
              </div>

            </div>
          )}
        </div>

        {/* ── Task list ─────────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-900">
              Tasks
              <span className="ml-2 text-xs font-normal text-gray-400">{allTasks.length}</span>
            </h2>
            <button onClick={addTask}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-green-300 rounded-lg text-green-700 hover:bg-green-50">
              <Plus size={12} /> Add Task
            </button>
          </div>

          <div className="space-y-3">
            {allTasks.map((task, i) => (
              <TaskEditor key={task.id} task={task} idx={i} onPatch={patchTask} onDelete={deleteTask} />
            ))}
            {!allTasks.length && (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
                No tasks yet.{' '}
                <button onClick={addTask} className="text-green-600 underline">Add the first one</button>
              </div>
            )}
          </div>
        </div>

        {/* ── Bottom save ───────────────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-2">
          <button onClick={() => dbSaveCourse(course)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700">
            <Save size={14} /> Save Changes
          </button>
          {saved && <p className="text-xs text-green-600 flex items-center gap-1"><CheckCircle size={11} /> Changes saved</p>}
        </div>

      </div>
    </Layout>
  );
}

'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Printer, ImageOff, Pencil, RefreshCw, Upload, StopCircle, Lock, Globe, CheckCircle, Trash2, Plus } from 'lucide-react';
import RichNotesEditor, { mdToHtml, htmlToMd } from '@/components/RichNotesEditor';
import { dbGetCourse, dbSaveCourse, dbUploadImage, dbIncrementViews, dbProxy } from '@/lib/db';
import { useIsCreator } from '@/lib/useIsCreator';
import type { Course, Module } from '@/lib/types';
import { cleanTitle } from '@/lib/cleanTitle';
import FeedbackForm from '@/components/FeedbackForm';

// ── Image generation helper ───────────────────────────────────────────────────
function extractImageQuery(examples: string): string {
  const match = examples?.match(/IMAGEQUERY:\s*(.+)/i);
  return match ? match[1].trim() : '';
}

// When courseId + cardIndex are supplied the server uploads to Storage AND
// patches courses.modules directly — returns publicUrl, no browser save needed.
async function callGenerateImage(
  title: string,
  context: string,
  imageQuery: string,
  courseId?: string,
  cardIndex?: number,
): Promise<string> {
  const res = await fetch('/api/generate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({ title: imageQuery || title, context, courseId, cardIndex }),
  });
  const data = await res.json() as { publicUrl?: string; dataUrl?: string; error?: string };
  if (data.error) throw new Error(data.error);
  if (data.publicUrl) return data.publicUrl;
  if (data.dataUrl) return data.dataUrl;
  throw new Error('No image returned');
}

// ── Section accent colours ────────────────────────────────────────────────────
const ACCENTS = [
  { bg: '#EFF6FF', pageBg: '#DBEAFE', border: '#BFDBFE', label: '#1D4ED8', text: '#1e3a5f' },
  { bg: '#F0FDF4', pageBg: '#DCFCE7', border: '#BBF7D0', label: '#15803D', text: '#14532d' },
  { bg: '#FFF7ED', pageBg: '#FFEDD5', border: '#FED7AA', label: '#C2410C', text: '#7c2d12' },
  { bg: '#FAF5FF', pageBg: '#EDE9FE', border: '#E9D5FF', label: '#7C3AED', text: '#3b0764' },
  { bg: '#FFF1F2', pageBg: '#FFE4E6', border: '#FECDD3', label: '#BE123C', text: '#881337' },
  { bg: '#F0FDFA', pageBg: '#CCFBF1', border: '#99F6E4', label: '#0F766E', text: '#134e4a' },
  { bg: '#FEFCE8', pageBg: '#FEF9C3', border: '#FEF08A', label: '#A16207', text: '#713f12' },
  { bg: '#F8FAFC', pageBg: '#E2E8F0', border: '#CBD5E1', label: '#334155', text: '#0f172a' },
];

// ── Inline editable text ──────────────────────────────────────────────────────
function EditableText({
  value,
  onChange,
  className,
  multiline,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  multiline?: boolean;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  function commit() { onChange(draft); setEditing(false); }

  // Multiline: rich editor inline
  if (multiline) {
    if (editing) {
      function execCmd(cmd: string) { editorRef.current?.focus(); document.execCommand(cmd, false, undefined); }
      function wrapBlock(tag: string) { editorRef.current?.focus(); document.execCommand('formatBlock', false, tag); }
      function handleDone() { onChange(htmlToMd(editorRef.current?.innerHTML ?? '')); setEditing(false); }
      return (
        <div className="border-2 border-indigo-400 rounded-xl overflow-hidden w-full print:hidden">
          <div className="flex items-center gap-0.5 px-2 py-1.5 bg-gray-50 border-b border-gray-200 flex-wrap">
            <VBtn onMouseDown={() => execCmd('bold')} title="Bold"><b>B</b></VBtn>
            <VBtn onMouseDown={() => execCmd('italic')} title="Italic"><i>I</i></VBtn>
            <div className="w-px h-4 bg-gray-300 mx-1" />
            <VBtn onMouseDown={() => wrapBlock('h3')} title="Heading">H2</VBtn>
            <VBtn onMouseDown={() => wrapBlock('h4')} title="Sub-heading">H3</VBtn>
            <VBtn onMouseDown={() => wrapBlock('p')} title="Normal">¶</VBtn>
            <div className="w-px h-4 bg-gray-300 mx-1" />
            <VBtn onMouseDown={() => execCmd('insertUnorderedList')} title="Bullet list">• List</VBtn>
            <VBtn onMouseDown={() => execCmd('insertOrderedList')} title="Numbered list">1. List</VBtn>
            <div className="w-px h-4 bg-gray-300 mx-1" />
            <VBtn onMouseDown={() => execCmd('undo')} title="Undo">↩</VBtn>
            <VBtn onMouseDown={() => execCmd('redo')} title="Redo">↪</VBtn>
          </div>
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            dangerouslySetInnerHTML={{ __html: mdToHtml(value) }}
            className={`min-h-[80px] p-2 text-sm text-gray-800 leading-relaxed focus:outline-none bg-white
              [&_h3]:text-base [&_h3]:font-bold [&_h3]:text-gray-900 [&_h3]:mt-2 [&_h3]:mb-0.5
              [&_h4]:text-sm [&_h4]:font-bold [&_h4]:text-gray-800 [&_h4]:mt-1.5 [&_h4]:mb-0.5
              [&_ul]:list-disc [&_ul]:list-inside [&_ul]:ml-2 [&_ul]:space-y-0.5
              [&_ol]:list-decimal [&_ol]:list-inside [&_ol]:ml-2 [&_ol]:space-y-0.5
              [&_li]:text-sm [&_li]:text-gray-700
              [&_strong]:font-semibold [&_strong]:text-gray-900
              [&_p]:mb-0.5 ${className ?? ''}`}
          />
          <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 border-t border-gray-200">
            <button onMouseDown={handleDone} className="px-3 py-1 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Done</button>
            <button onMouseDown={() => setEditing(false)} className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        </div>
      );
    }
    return (
      <span
        onClick={() => setEditing(true)}
        className={`cursor-text group relative print:cursor-default block ${className ?? ''}`}
        title="Click to edit"
      >
        {value
          ? <span className="print:contents" dangerouslySetInnerHTML={{ __html: mdToHtml(value) }} />
          : <span className="text-gray-300 italic">{placeholder}</span>}
        <Pencil size={11} className="print:hidden inline-block ml-1.5 opacity-0 group-hover:opacity-40 transition-opacity text-indigo-500 align-middle" />
      </span>
    );
  }

  // Single-line
  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => e.key === 'Enter' && commit()}
        className={`w-full border-b-2 border-indigo-400 bg-transparent focus:outline-none ${className ?? ''}`}
        placeholder={placeholder}
      />
    );
  }

  return (
    <span
      onClick={() => { setDraft(value); setEditing(true); }}
      className={`cursor-text group relative print:cursor-default ${className ?? ''}`}
      title="Click to edit"
    >
      {value || <span className="text-gray-300 italic">{placeholder}</span>}
      <Pencil size={11} className="print:hidden inline-block ml-1.5 opacity-0 group-hover:opacity-40 transition-opacity text-indigo-500" />
    </span>
  );
}

function VBtn({ onMouseDown, title, children }: { onMouseDown: () => void; title: string; children: React.ReactNode }) {
  return (
    <button onMouseDown={e => { e.preventDefault(); onMouseDown(); }} title={title}
      className="px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-200 rounded transition-colors">
      {children}
    </button>
  );
}

function CaptionField({ value, onChange, accentColor }: { value: string; onChange: (v: string) => void; accentColor: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { onChange(draft); setEditing(false); }}
        onKeyDown={e => { if (e.key === 'Enter') { onChange(draft); setEditing(false); } if (e.key === 'Escape') setEditing(false); }}
        placeholder="Add a caption…"
        className="w-full text-center text-xs px-2 py-1.5 bg-white/70 border-b-2 focus:outline-none"
        style={{ borderColor: accentColor }}
      />
    );
  }

  return (
    <div
      onClick={() => { setDraft(value); setEditing(true); }}
      className="w-full text-center text-xs px-2 py-1.5 cursor-text group print:cursor-default"
      style={{ color: accentColor }}
    >
      {value
        ? <span className="italic">{value}<Pencil size={9} className="print:hidden inline-block ml-1 opacity-0 group-hover:opacity-50 transition-opacity" /></span>
        : <span className="print:hidden opacity-40 italic">Click to add caption…</span>
      }
    </div>
  );
}

export default function VisualGuidePage() {
  const isCreator = useIsCreator();
  const params = useParams();
  const id = params.id as string;

  const [course, setCourse] = useState<Course | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [saved, setSaved] = useState(false);
  // imageUrls[i]: undefined=not started/no images, null=loading, ''=failed, string=url
  const [imageUrls, setImageUrls] = useState<Record<number, string | null | undefined>>({});
  const imageUrlsRef = useRef<Record<number, string | null | undefined>>({});
  const [imageErrors, setImageErrors] = useState<Record<number, string>>({});
  // generating: true while the auto-gen loop is running
  const [generating, setGenerating] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    imageUrlsRef.current = {};
    cancelledRef.current = false;

    // Retry up to ~8 seconds — the course is saved server-side just before the
    // redirect, but Supabase's anon-key read can lag the service-role write by
    // a few hundred ms, causing a spurious "Not found" on the first fetch.
    (async () => {
      const DELAYS = [300, 700, 1500, 2500, 3000];
      let c = await dbGetCourse(id);
      for (let i = 0; !c && i < DELAYS.length; i++) {
        if (cancelledRef.current) return;
        await new Promise(r => setTimeout(r, DELAYS[i]));
        c = await dbGetCourse(id);
      }
      if (cancelledRef.current) return;
      if (!c) { setNotFound(true); return; }
      setCourse(c);
      document.title = c.title.replace(/^illustrated explainer:\s*/i, '').replace(/^visual story:\s*/i, '').replace(/^visual explainer:\s*/i, '');
      if (c.status === 'published') dbIncrementViews(c.id);

      // Load already-saved images; validate each URL with a HEAD request so
      // broken/deleted storage objects don't stay stuck as "loaded" — they get
      // cleared and re-queued for generation instead.
      const initial: Record<number, string> = {};
      await Promise.all(c.modules.map(async (mod, i) => {
        if (!mod.imageUrl) return;
        try {
          const probe = await fetch(mod.imageUrl, { method: 'HEAD' });
          if (probe.ok) initial[i] = mod.imageUrl;
          // else: broken → omit so it falls into the generate queue below
        } catch {
          // network error → treat as broken
        }
      }));
      if (Object.keys(initial).length > 0) {
        imageUrlsRef.current = { ...initial };
        setImageUrls({ ...initial });
      }

      // Only auto-generate if creator opted in AND image not already valid
      if (!c.generateImages) return;

      // Mark all un-validated sections as loading immediately
      const toGenerate: number[] = [];
      c.modules.forEach((mod, i) => {
        if (initial[i]) return; // already validated — skip
        toGenerate.push(i);
        imageUrlsRef.current = { ...imageUrlsRef.current, [i]: null };
      });
      if (toGenerate.length === 0) return;

      setImageUrls(prev => {
        const next = { ...prev };
        toGenerate.forEach(i => { next[i] = null; });
        return next;
      });
      setGenerating(true);

      // Server handles upload + courses.modules patch atomically.
      // Browser only updates display state — no dbSaveCourse needed.
      for (const i of toGenerate) {
        if (cancelledRef.current) break;
        const mod = c.modules[i];
        const query = extractImageQuery(mod.examples ?? '');
        try {
          const publicUrl = await callGenerateImage(
            mod.title,
            `${mod.objective ? mod.objective + '. ' : ''}${mod.lessonNotes ?? ''}`.slice(0, 600),
            query,
            c.id,
            i,
          );
          if (cancelledRef.current) break;
          // Append a cache-buster so the browser fetches the new image even
          // when the storage path (and therefore URL) is identical to the old one.
          const displayUrl = `${publicUrl}?v=${Date.now()}`;
          imageUrlsRef.current = { ...imageUrlsRef.current, [i]: displayUrl };
          setImageUrls(prev => ({ ...prev, [i]: displayUrl }));
          const savedModules: Module[] = c!.modules.map((m, idx) =>
            idx === i ? { ...m, imageUrl: publicUrl } : m   // store clean URL
          );
          c = { ...c, modules: savedModules };
          setCourse({ ...c });
        } catch (err: unknown) {
          if (cancelledRef.current) break;
          const msg = err instanceof Error ? err.message : String(err);
          imageUrlsRef.current = { ...imageUrlsRef.current, [i]: '' };
          setImageUrls(prev => ({ ...prev, [i]: '' }));
          setImageErrors(prev => ({ ...prev, [i]: msg }));
        }
      }
      setGenerating(false);
    })();

    return () => {
      cancelledRef.current = true;
      setGenerating(false);
      document.title = 'Illustrated Explainer';
    };
  }, [id]);

  function regenerate(i: number) {
    if (!course) return;
    const mod = course.modules[i];
    const query = extractImageQuery(mod.examples ?? '');
    imageUrlsRef.current = { ...imageUrlsRef.current, [i]: null };
    setImageUrls(prev => ({ ...prev, [i]: null }));
    setImageErrors(prev => ({ ...prev, [i]: '' }));
    callGenerateImage(
      mod.title,
      `${mod.objective ? mod.objective + '. ' : ''}${mod.lessonNotes ?? ''}`.slice(0, 600),
      query,
      course.id,
      i,
    )
      .then(publicUrl => {
        // Cache-bust the display URL so the browser refetches the new image.
        const displayUrl = `${publicUrl}?v=${Date.now()}`;
        imageUrlsRef.current = { ...imageUrlsRef.current, [i]: displayUrl };
        setImageUrls(prev => ({ ...prev, [i]: displayUrl }));
        // Server already patched courses.modules — store the clean URL.
        setCourse(prev => {
          if (!prev) return prev;
          const modules = prev.modules.map((m, idx) =>
            idx === i ? { ...m, imageUrl: publicUrl } : m
          );
          return { ...prev, modules };
        });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        imageUrlsRef.current = { ...imageUrlsRef.current, [i]: '' };
        setImageUrls(prev => ({ ...prev, [i]: '' }));
        setImageErrors(prev => ({ ...prev, [i]: msg }));
      });
  }

  function handleImageUpload(i: number, file: File) {
    const reader = new FileReader();
    reader.onload = async e => {
      const dataUrl = e.target?.result as string;
      if (!dataUrl || !course) return;
      // Show local preview immediately
      setImageUrls(prev => ({ ...prev, [i]: dataUrl }));
      // Upload via server (route handles storage + returns public URL)
      const publicUrl = await dbUploadImage(course.id, i, dataUrl) ?? dataUrl;
      setImageUrls(prev => ({ ...prev, [i]: publicUrl }));
      const modules = course.modules.map((m, idx) =>
        idx === i ? { ...m, imageUrl: publicUrl } : m
      );
      const updated = { ...course, modules };
      setCourse(updated);
      await dbSaveCourse(updated);
    };
    reader.readAsDataURL(file);
  }

  function patchCourse(patch: Partial<Course>) {
    if (!course) return;
    const updated = { ...course, ...patch };
    setCourse(updated);
    dbSaveCourse(updated);
  }

  function patchModule(i: number, notes: string) {
    if (!course) return;
    const modules = course.modules.map((m, idx) => idx === i ? { ...m, lessonNotes: notes } : m);
    patchCourse({ modules });
  }

  function patchModuleTitle(i: number, title: string) {
    if (!course) return;
    const modules = course.modules.map((m, idx) => idx === i ? { ...m, title } : m);
    patchCourse({ modules });
  }

  function patchModuleObjective(i: number, objective: string) {
    if (!course) return;
    const modules = course.modules.map((m, idx) => idx === i ? { ...m, objective } : m);
    patchCourse({ modules });
  }

  function patchLearningGoal(i: number, value: string) {
    if (!course) return;
    const learningGoals = course.learningGoals.map((g, idx) => idx === i ? value : g);
    patchCourse({ learningGoals });
  }

  function patchCaption(i: number, caption: string) {
    if (!course) return;
    const modules = course.modules.map((m, idx) => idx === i ? { ...m, imageCaption: caption } : m);
    patchCourse({ modules });
  }

  function deleteSection(index: number) {
    if (!course) return;
    if (course.modules.length <= 1) {
      alert('An explainer must have at least 1 section.');
      return;
    }
    if (!confirm(`Are you sure you want to delete Section ${index + 1}?`)) return;
    const modules = course.modules.filter((_, i) => i !== index);
    patchCourse({ modules });
  }

  function addSection() {
    if (!course) return;
    const newIndex = course.modules.length + 1;
    const newModule: Module = {
      id: 'mod_' + Math.random().toString(36).slice(2),
      title: `Section ${newIndex}: New Concept`,
      objective: 'Key learning objective for this section.',
      lessonNotes: 'Detailed explanation and visual breakdown of this concept.',
    };
    const modules = [...course.modules, newModule];
    patchCourse({ modules });
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

  if (!course) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        {notFound ? (
          <p className="text-gray-500">Content not found.</p>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-4 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-400">Loading…</p>
          </div>
        )}
      </div>
    );
  }

  if (!isCreator && course.status !== 'published') {
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
          <a href="/" className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 text-white font-medium text-sm rounded-lg hover:bg-blue-700 transition-colors">
            Return Home
          </a>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ── Toolbar — screen only ─────────────────────────────────────────── */}
      <div className="print:hidden sticky top-0 z-40 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {isCreator && (
            <>
              <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900">
                <ArrowLeft size={15} /> Back
              </Link>
              <span className="text-gray-300">|</span>
            </>
          )}
          <span className="text-sm font-medium text-gray-700 truncate max-w-xs">{cleanTitle(course.title)}</span>
        </div>
        <div className="flex items-center gap-3">
          {isCreator && <span className="text-xs text-gray-400">Click any text to edit</span>}
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-700 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            <Printer size={14} /> Save as PDF
          </button>
        </div>
      </div>


      {/* ── Document ─────────────────────────────────────────────────────── */}
      <div id="print-body" className="bg-white min-h-screen">
        <div className="max-w-[800px] mx-auto px-10 py-12 print:px-0 print:max-w-none">

          {/* ── Cover page ─────────────────────────────────────────────────── */}
          {(() => {
            const coverAccent = ACCENTS[0];
            return (
              <div
                id="cover-page"
                className="mb-12 pb-8 border-b border-gray-200 print:mb-0 print:pb-0 print:border-0 print:rounded-none rounded-2xl overflow-hidden"
              >
                {/* Themed top band */}
                <div
                  className="px-8 pt-10 pb-8"
                  style={{ backgroundColor: coverAccent.pageBg }}
                >
                  <h1 className="text-4xl font-bold leading-tight mb-3 print:text-3xl" style={{ color: coverAccent.text }}>
                    <EditableText
                      value={cleanTitle(course.title)}
                      onChange={v => patchCourse({ title: v })}
                      className="text-4xl font-bold leading-tight print:text-3xl"
                      placeholder="Explainer title…"
                    />
                  </h1>
                  <div className="text-base leading-relaxed" style={{ color: coverAccent.text, opacity: 0.8 }}>
                    <EditableText
                      value={course.description}
                      onChange={v => patchCourse({ description: v })}
                      className="text-base leading-relaxed"
                      placeholder="Add a description…"
                    />
                  </div>
                </div>

                {/* Learning objectives on lighter bg */}
                {course.learningGoals.length > 0 && (
                  <div className="px-8 py-6" style={{ backgroundColor: coverAccent.bg }}>
                    <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: coverAccent.label }}>Learning Objectives</p>
                    <ul className="space-y-2">
                      {course.learningGoals.map((g, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm" style={{ color: coverAccent.text }}>
                          <span className="mt-0.5 flex-shrink-0 font-bold" style={{ color: coverAccent.label }}>→</span>
                          <EditableText
                            value={g}
                            onChange={v => patchLearningGoal(i, v)}
                            className="text-sm flex-1"
                            placeholder="Learning objective…"
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Sections ───────────────────────────────────────────────────── */}
          <div className="space-y-10 print:space-y-0">
            {/* Group into pairs for print — 2 sections per A4 page */}
            {Array.from({ length: Math.ceil(course.modules.length / 2) }, (_, pi) => {
              const pair = course.modules.slice(pi * 2, pi * 2 + 2);
              return (
                <div key={pi} className="print-page space-y-10 print:space-y-0">
                  {pair.map((mod, pj) => {
                    const i = pi * 2 + pj;
                    const accent = ACCENTS[i % ACCENTS.length];
                    const imgState = imageUrls[i];
                    const isLoading = imgState === null; // null = actively generating
                    const notStarted = imgState === undefined; // undefined = pending (no API key, or waiting)
                    const hasFailed = imgState === '';
                    const imgError = imageErrors[i] ?? '';
                     return (
                      <div
                        key={mod.id}
                        className="section-card rounded-2xl print:rounded-none overflow-hidden"
                        style={{ backgroundColor: accent.bg }}
                      >
                        {/* Header bar */}
                        <div
                          className="px-5 py-3 flex items-center justify-between gap-3"
                          style={{ backgroundColor: accent.pageBg, borderBottom: `2px solid ${accent.border}` }}
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <span
                              className="text-xs font-black w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                              style={{ color: '#fff', backgroundColor: accent.label }}
                            >
                              {i + 1}
                            </span>
                            <h2 className="text-lg font-bold flex-1 truncate" style={{ color: accent.text }}>
                              <EditableText
                                value={mod.title}
                                onChange={v => patchModuleTitle(i, v)}
                                className="text-lg font-bold"
                                placeholder="Section title…"
                              />
                            </h2>
                          </div>

                          {/* Delete section button — creator screen only */}
                          {isCreator && (
                            <button
                              onClick={() => deleteSection(i)}
                              className="print:hidden p-1.5 rounded-lg text-red-500 hover:text-red-700 hover:bg-red-50 transition-colors flex-shrink-0"
                              title="Delete this section"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>

                        {/* Two-column body */}
                        <div className="flex flex-row">
                          {/* Left: image column */}
                          <div className="w-2/5 flex items-center justify-center flex-shrink-0" style={{ backgroundColor: accent.pageBg, borderRight: `2px solid ${accent.border}` }}>
                            {isLoading && (
                              <div className="flex flex-col items-center justify-center gap-2 py-10">
                                <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                                <span className="text-xs text-gray-400">Generating…</span>
                                <button
                                  onClick={() => { cancelledRef.current = true; setGenerating(false); setImageUrls(prev => ({ ...prev, [i]: undefined })); }}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 border border-gray-300 bg-white rounded-lg hover:bg-gray-50"
                                >
                                  <StopCircle size={10} /> Stop
                                </button>
                              </div>
                            )}
                            {notStarted && (
                              <div className="print:hidden flex flex-col items-center justify-center gap-2 px-4 py-10">
                                <ImageOff size={20} style={{ color: accent.border }} />
                                <span className="text-xs text-center" style={{ color: accent.label }}>No image</span>
                                {isCreator && (
                                  <>
                                    <button onClick={() => regenerate(i)} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 border border-gray-300 bg-white rounded-lg hover:bg-gray-50">
                                      <RefreshCw size={10} /> Generate
                                    </button>
                                    <label className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 border border-gray-300 bg-white rounded-lg hover:bg-gray-50 cursor-pointer">
                                      <Upload size={10} /> Upload
                                      <input type="file" accept="image/*" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(i, f); }} />
                                    </label>
                                  </>
                                )}
                              </div>
                            )}
                            {!isLoading && !notStarted && hasFailed && (
                              <div className="flex flex-col items-center justify-center gap-2 px-4 py-10">
                                <ImageOff size={24} style={{ color: accent.border }} />
                                <span className="text-xs text-center" style={{ color: accent.label }}>Failed</span>
                                {imgError && <span className="text-xs text-red-500 text-center break-words">{imgError}</span>}
                                {isCreator && (
                                  <div className="print:hidden flex gap-1.5 flex-wrap justify-center">
                                    <button onClick={() => regenerate(i)} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 border border-gray-300 bg-white rounded-lg hover:bg-gray-50">
                                      <RefreshCw size={10} /> Retry
                                    </button>
                                    <label className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 border border-gray-300 bg-white rounded-lg hover:bg-gray-50 cursor-pointer">
                                      <Upload size={10} /> Upload
                                      <input type="file" accept="image/*" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(i, f); }} />
                                    </label>
                                  </div>
                                )}
                              </div>
                            )}
                            {!isLoading && !notStarted && !hasFailed && imgState && (
                              <div className="w-full">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={imgState}
                                  alt={mod.imageCaption || mod.title}
                                  className="w-full object-contain block"
                                  onError={() => setImageUrls(prev => ({ ...prev, [i]: '' }))}
                                />
                                {isCreator && (
                                  <div className="print:hidden flex gap-1 justify-center py-1.5 px-2">
                                    <button onClick={() => regenerate(i)} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 border border-gray-300 bg-white rounded-lg hover:bg-gray-50">
                                      <RefreshCw size={9} /> Regen
                                    </button>
                                    <label className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 border border-gray-300 bg-white rounded-lg hover:bg-gray-50 cursor-pointer">
                                      <Upload size={9} /> Replace
                                      <input type="file" accept="image/*" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(i, f); }} />
                                    </label>
                                  </div>
                                )}
                                <CaptionField
                                  value={mod.imageCaption ?? ''}
                                  onChange={v => patchCaption(i, v)}
                                  accentColor={accent.label}
                                />
                              </div>
                            )}
                          </div>

                          {/* Right: notes */}
                          <div className="w-3/5 flex flex-col p-5" style={{ backgroundColor: accent.bg }}>
                            {mod.objective !== undefined && (
                              <p className="text-sm font-semibold italic mb-3 pb-2 border-b" style={{ color: accent.label, borderColor: accent.border }}>
                                <EditableText
                                  value={mod.objective ?? ''}
                                  onChange={v => patchModuleObjective(i, v)}
                                  className="text-sm font-semibold italic"
                                  placeholder="Learning objective…"
                                />
                              </p>
                            )}
                            <div className="flex-1">
                              <p className="text-sm leading-relaxed whitespace-pre-line mb-2" style={{ color: accent.text }}>
                                {mod.lessonNotes}
                              </p>
                              <RichNotesEditor
                                value={mod.lessonNotes ?? ''}
                                onChange={notes => patchModule(i, notes)}
                                editLabel="Edit notes"
                                accentColor={accent.label}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {isCreator && (
            <div className="print:hidden mt-6 mb-2 flex justify-center">
              <button
                onClick={addSection}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 rounded-xl text-sm font-semibold transition-colors shadow-sm"
              >
                <Plus size={16} /> Add Section
              </button>
            </div>
          )}

          {/* Feedback — screen only */}
          <div className="print:hidden max-w-[800px] mx-auto px-10 pb-10 pt-4">
            <FeedbackForm courseId={course.id} contentTitle={course.title} accentColor="indigo" />
          </div>

        </div>
      </div>

      {/* ── Print styles ─────────────────────────────────────────────────── */}
      <style>{`
        @media print {
          /* Each pair of sections = one A4 page */
          .print-page {
            page-break-before: always;
            page-break-inside: avoid;
            height: 100vh;
            display: flex;
            flex-direction: column;
            box-sizing: border-box;
          }
          /* Each section card = exactly half the page */
          .section-card {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          .section-card > div:last-child {
            flex: 1;
          }
          /* Image column fills its height */
          .section-card .w-2\\/5 {
            position: relative;
          }
          /* Cover page: own full page */
          #cover-page {
            height: 100vh;
            padding: 2cm;
            box-sizing: border-box;
            page-break-after: always;
          }
          /* Strip screen wrapper padding */
          #print-body { padding: 0 !important; }
          #print-body > div { padding: 0 !important; }
        }
      `}</style>
    </>
  );
}

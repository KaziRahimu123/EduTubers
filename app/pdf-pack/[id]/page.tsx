'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Printer, ChevronDown, ChevronUp, BookOpen, Target, List, FileText, CheckSquare, Palette, Pencil, ImageOff, RefreshCw, Upload, Lock, Globe, CheckCircle } from 'lucide-react';
import { dbGetCourse, dbSaveCourse, dbUploadImage, dbIncrementViews, dbProxy } from '@/lib/db';
import { useIsCreator } from '@/lib/useIsCreator';
import type { PdfPack, PdfSection, Course } from '@/lib/types';
import { cleanTitle } from '@/lib/cleanTitle';
import FeedbackForm from '@/components/FeedbackForm';
import FontSelector from '@/components/FontSelector';
import RichNotesEditor, { mdToHtml, htmlToMd } from '@/components/RichNotesEditor';
import { loadFontSettings, saveFontSettings, loadFontSettingsFromCourse, getFontOption } from '@/lib/fontConfig';
import type { FontSettings } from '@/lib/fontConfig';

// ── Image generation helper ───────────────────────────────────────────────────
// Passes courseId + sectionIndex so the server uploads to Storage AND patches
// courses.modules[0].pdfPack.sections[sectionIndex].imageUrl directly.
// Falls back to dataUrl if publicUrl is absent (e.g. storage misconfiguration).
async function generateSectionImage(
  title: string,
  overview: string,
  courseId: string,
  sectionIndex: number,
): Promise<string> {
  const res = await fetch('/api/generate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, context: overview, courseId, sectionIndex }),
  });
  const data = await res.json() as { publicUrl?: string; dataUrl?: string; error?: string };
  if (data.error) throw new Error(data.error);
  const url = data.publicUrl || data.dataUrl;
  if (!url) throw new Error('No image returned');
  return url;
}

// ── Color palette ─────────────────────────────────────────────────────────────
interface PaletteEntry { bg: string; text: string; accent: string; lightBg: string; border: string; badge: string; }

const PALETTE: PaletteEntry[] = [
  { bg: '#1d4ed8', text: '#ffffff', accent: '#1d4ed8', lightBg: '#eff6ff', border: '#bfdbfe', badge: '#1e40af' },
  { bg: '#7c3aed', text: '#ffffff', accent: '#7c3aed', lightBg: '#f5f3ff', border: '#ddd6fe', badge: '#6d28d9' },
  { bg: '#059669', text: '#ffffff', accent: '#059669', lightBg: '#ecfdf5', border: '#a7f3d0', badge: '#047857' },
  { bg: '#d97706', text: '#ffffff', accent: '#d97706', lightBg: '#fffbeb', border: '#fde68a', badge: '#b45309' },
  { bg: '#db2777', text: '#ffffff', accent: '#db2777', lightBg: '#fdf2f8', border: '#fbcfe8', badge: '#be185d' },
  { bg: '#0891b2', text: '#ffffff', accent: '#0891b2', lightBg: '#ecfeff', border: '#a5f3fc', badge: '#0e7490' },
  { bg: '#e11d48', text: '#ffffff', accent: '#e11d48', lightBg: '#fff1f2', border: '#fecdd3', badge: '#be123c' },
  { bg: '#4f46e5', text: '#ffffff', accent: '#4f46e5', lightBg: '#eef2ff', border: '#c7d2fe', badge: '#4338ca' },
];

const SWATCH_COLORS = [
  '#1d4ed8', '#7c3aed', '#059669', '#d97706',
  '#db2777', '#0891b2', '#e11d48', '#4f46e5',
  '#1f2937', '#0f766e', '#92400e', '#831843',
];

function paletteFromHex(hex: string): PaletteEntry {
  return PALETTE.find(p => p.bg === hex) ?? { bg: hex, text: '#ffffff', accent: hex, lightBg: '#f8fafc', border: '#e2e8f0', badge: hex };
}

// ── Inline editable field ─────────────────────────────────────────────────────
function Editable({
  value, onChange, className, multiline, placeholder, style,
}: {
  value: string; onChange: (v: string) => void;
  className?: string; multiline?: boolean; placeholder?: string;
  style?: React.CSSProperties;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const richRef = useRef<HTMLDivElement>(null);

  function commit() { onChange(draft); setEditing(false); }

  // Multiline fields: open rich editor inline
  if (multiline) {
    if (editing) {
      return (
        <RichInlineEditor
          value={value}
          onDone={v => { onChange(v); setEditing(false); }}
          onCancel={() => setEditing(false)}
          className={className}
        />
      );
    }
    return (
      <span
        onClick={() => setEditing(true)}
        className={`cursor-text group relative print:cursor-default block ${className ?? ''}`}
        style={style}
        title="Click to edit"
      >
        {value
          ? <span className="print:contents" dangerouslySetInnerHTML={{ __html: mdToHtml(value) }} />
          : <span className="opacity-50 italic">{placeholder}</span>}
        <Pencil size={10} className="print:hidden inline-block ml-1 opacity-0 group-hover:opacity-60 transition-opacity align-middle" />
      </span>
    );
  }

  // Single-line fields: plain input — always dark text regardless of surrounding color scheme
  if (editing) {
    const base = 'w-full bg-white border-2 border-blue-400 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-300 text-gray-900';
    return <input autoFocus ref={richRef as React.RefObject<HTMLInputElement>} className={`${base} ${className ?? ''}`}
      value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={e => e.key === 'Enter' && commit()} />;
  }

  return (
    <span
      onClick={() => { setDraft(value); setEditing(true); }}
      className={`cursor-text group relative print:cursor-default ${className ?? ''}`}
      style={style}
      title="Click to edit"
    >
      {value || <span className="opacity-50 italic">{placeholder}</span>}
      <Pencil size={10} className="print:hidden inline-block ml-1 opacity-0 group-hover:opacity-60 transition-opacity" />
    </span>
  );
}

// ── Inline rich editor (used inside Editable for multiline fields) ────────────
function RichInlineEditor({
  value, onDone, onCancel, className,
}: {
  value: string; onDone: (v: string) => void; onCancel: () => void; className?: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);

  function execCmd(cmd: string) { editorRef.current?.focus(); document.execCommand(cmd, false, undefined); }
  function wrapBlock(tag: string) { editorRef.current?.focus(); document.execCommand('formatBlock', false, tag); }

  function handleDone() {
    onDone(htmlToMd(editorRef.current?.innerHTML ?? ''));
  }

  return (
    <div className="border-2 border-blue-400 rounded-xl overflow-hidden w-full print:hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 bg-gray-50 border-b border-gray-200 flex-wrap">
        <RichBtn onMouseDown={() => execCmd('bold')} title="Bold"><b>B</b></RichBtn>
        <RichBtn onMouseDown={() => execCmd('italic')} title="Italic"><i>I</i></RichBtn>
        <div className="w-px h-4 bg-gray-300 mx-1" />
        <RichBtn onMouseDown={() => wrapBlock('h3')} title="Heading">H2</RichBtn>
        <RichBtn onMouseDown={() => wrapBlock('h4')} title="Sub-heading">H3</RichBtn>
        <RichBtn onMouseDown={() => wrapBlock('p')} title="Normal">¶</RichBtn>
        <div className="w-px h-4 bg-gray-300 mx-1" />
        <RichBtn onMouseDown={() => execCmd('insertUnorderedList')} title="Bullet list">• List</RichBtn>
        <RichBtn onMouseDown={() => execCmd('insertOrderedList')} title="Numbered list">1. List</RichBtn>
        <div className="w-px h-4 bg-gray-300 mx-1" />
        <RichBtn onMouseDown={() => execCmd('undo')} title="Undo">↩</RichBtn>
        <RichBtn onMouseDown={() => execCmd('redo')} title="Redo">↪</RichBtn>
      </div>
      {/* Content */}
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
      {/* Actions */}
      <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 border-t border-gray-200">
        <button onMouseDown={handleDone} className="px-3 py-1 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700">Done</button>
        <button onMouseDown={onCancel} className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
      </div>
    </div>
  );
}

function RichBtn({ onMouseDown, title, children }: { onMouseDown: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onMouseDown={e => { e.preventDefault(); onMouseDown(); }}
      title={title}
      className="px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-200 rounded transition-colors"
    >
      {children}
    </button>
  );
}

// ── Editable list item ────────────────────────────────────────────────────────
function EditableListItem({
  value, onChange, className, style,
}: { value: string; onChange: (v: string) => void; className?: string; style?: React.CSSProperties }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  function commit() { onChange(draft); setEditing(false); }
  if (editing) {
    return <input autoFocus className="flex-1 bg-white border border-gray-300 rounded px-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
      value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={e => e.key === 'Enter' && commit()} />;
  }
  return (
    <span onClick={() => { setDraft(value); setEditing(true); }}
      className={`cursor-text group flex-1 print:cursor-default ${className ?? ''}`}
      style={style} title="Click to edit">
      {value}
      <Pencil size={9} className="print:hidden inline-block ml-1 opacity-0 group-hover:opacity-50 transition-opacity" />
    </span>
  );
}

// ── Markdown renderer ─────────────────────────────────────────────────────────
function RenderNotes({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('### ')) {
      elements.push(<h4 key={i} className="text-sm font-bold text-gray-800 mt-4 mb-1">{line.slice(4)}</h4>);
    } else if (line.startsWith('## ')) {
      elements.push(<h3 key={i} className="text-base font-bold text-gray-900 mt-5 mb-1">{line.slice(3)}</h3>);
    } else if (line.match(/^[-•] /)) {
      const bullets: string[] = [];
      while (i < lines.length && lines[i].match(/^[-•] /)) { bullets.push(lines[i].slice(2)); i++; }
      elements.push(<ul key={`ul-${i}`} className="list-disc list-inside space-y-0.5 mb-2 ml-2">
        {bullets.map((b, bi) => <li key={bi} className="text-sm text-gray-700 leading-relaxed">{renderInline(b)}</li>)}
      </ul>);
      continue;
    } else if (line.match(/^\d+\. /)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\. /)) { items.push(lines[i].replace(/^\d+\. /, '')); i++; }
      elements.push(<ol key={`ol-${i}`} className="list-decimal list-inside space-y-0.5 mb-2 ml-2">
        {items.map((item, ii) => <li key={ii} className="text-sm text-gray-700 leading-relaxed">{renderInline(item)}</li>)}
      </ol>);
      continue;
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(<p key={i} className="text-sm text-gray-700 leading-relaxed mb-1">{renderInline(line)}</p>);
    }
    i++;
  }
  return <>{elements}</>;
}

function renderInline(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>
      : part
  );
}

// ── Color picker popover ──────────────────────────────────────────────────────
function ColorPicker({ currentHex, onChange }: { currentHex: string; onChange: (hex: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div ref={ref} className="relative print:hidden">
      <button onClick={() => setOpen(o => !o)} title="Change colour"
        className="inline-flex items-center gap-1 px-2 py-1 text-xs text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-lg transition-colors">
        <Palette size={11} /> Color
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-lg p-3 w-44">
          <p className="text-xs font-semibold text-gray-500 mb-2">Section colour</p>
          <div className="grid grid-cols-6 gap-1.5 mb-2">
            {SWATCH_COLORS.map(hex => (
              <button key={hex} onClick={() => { onChange(hex); setOpen(false); }}
                className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                style={{ backgroundColor: hex, borderColor: hex === currentHex ? '#111' : 'transparent' }} />
            ))}
          </div>
          <div className="flex items-center gap-2 border-t border-gray-100 pt-2">
            <label className="text-xs text-gray-500">Custom</label>
            <input type="color" value={currentHex} onChange={e => onChange(e.target.value)}
              className="w-8 h-6 rounded cursor-pointer border border-gray-200" />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section card ──────────────────────────────────────────────────────────────
function SectionCard({
  section, index, showAnswers, color, onColorChange, onSectionChange,
  imageUrl, onRegenerateImage, onUploadImage,
}: {
  section: PdfSection; index: number; showAnswers: boolean;
  color: PaletteEntry; onColorChange: (hex: string) => void;
  onSectionChange: (s: PdfSection) => void;
  imageUrl: string | null | undefined;
  onRegenerateImage: () => void;
  onUploadImage: (file: File) => void;
}) {
  const [open, setOpen] = useState(true);

  function patchSection(patch: Partial<PdfSection>) {
    onSectionChange({ ...section, ...patch });
  }

  const isLoadingImg = imageUrl === null;
  const imgFailed    = imageUrl === '';

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden mb-6 print:rounded-none print:border-0 print:border-t-2 print:border-gray-200 print:mb-0 print:break-before-page">

      {/* Header — screen */}
      <div className="pdf-section-header print:hidden flex items-center justify-between px-6 py-4" style={{ backgroundColor: color.bg }}>
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-3 flex-1 text-left">
          <span className="w-7 h-7 rounded-full bg-white/20 text-xs font-bold flex items-center justify-center flex-shrink-0" style={{ color: color.text }}>
            {index + 1}
          </span>
          <Editable value={section.title} onChange={v => patchSection({ title: v })}
            className="text-base font-bold" style={{ color: color.text }} placeholder="Section title…" />
        </button>
        <div className="flex items-center gap-2">
          <ColorPicker currentHex={color.bg} onChange={onColorChange} />
          <button onClick={() => setOpen(o => !o)} style={{ color: color.text }} className="opacity-70 hover:opacity-100">
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* Header — print */}
      <div className="pdf-section-header hidden print:flex items-center gap-3 px-6 py-4" style={{ backgroundColor: color.bg }}>
        <span className="w-7 h-7 rounded-full bg-white/20 text-xs font-bold flex items-center justify-center flex-shrink-0" style={{ color: color.text }}>
          {index + 1}
        </span>
        <span className="text-base font-bold" style={{ color: color.text }}>{section.title}</span>
      </div>

      <div className={`pdf-section-body px-6 pb-6 pt-4 space-y-6 ${!open ? 'hidden print:block' : ''}`}>

        {/* Section illustration */}
        <div className="flex justify-center rounded-xl overflow-hidden border border-gray-100 print:border-0"
          style={{ backgroundColor: color.lightBg, minHeight: '140px' }}>
          {isLoadingImg && (
            <div className="flex flex-col items-center justify-center gap-2 py-10 w-full">
              <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
              <span className="text-xs text-gray-400">Generating illustration…</span>
            </div>
          )}
          {imgFailed && (
            <div className="flex flex-col items-center justify-center gap-2 py-8 w-full print:hidden">
              <ImageOff size={22} className="text-gray-300" />
              <span className="text-xs text-gray-400">Image generation failed</span>
              <div className="flex gap-2">
                <button onClick={onRegenerateImage}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-gray-600 border border-gray-200 bg-white rounded-lg hover:bg-gray-50">
                  <RefreshCw size={10} /> Retry
                </button>
                <label className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-gray-600 border border-gray-200 bg-white rounded-lg hover:bg-gray-50 cursor-pointer">
                  <Upload size={10} /> Upload
                  <input type="file" accept="image/*" className="sr-only"
                    onChange={e => { const f = e.target.files?.[0]; if (f) onUploadImage(f); }} />
                </label>
              </div>
            </div>
          )}
          {imageUrl && !isLoadingImg && (
            <div className="relative group w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt={section.title} className="w-full object-contain block" />
              <div className="print:hidden absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1.5">
                <button onClick={onRegenerateImage}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs text-white bg-black/50 rounded-lg hover:bg-black/70">
                  <RefreshCw size={9} /> Regen
                </button>
                <label className="inline-flex items-center gap-1 px-2 py-1 text-xs text-white bg-black/50 rounded-lg hover:bg-black/70 cursor-pointer">
                  <Upload size={9} /> Replace
                  <input type="file" accept="image/*" className="sr-only"
                    onChange={e => { const f = e.target.files?.[0]; if (f) onUploadImage(f); }} />
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Overview */}
        {section.overview !== undefined && (
          <Editable value={section.overview} onChange={v => patchSection({ overview: v })}
            className="text-sm text-gray-600 italic border-l-4 pl-3 block w-full"
            style={{ borderColor: color.border }} placeholder="Section overview…" multiline />
        )}

        {/* Prerequisites */}
        {section.prerequisites?.length > 0 && (
          <div className="rounded-xl p-4" style={{ backgroundColor: color.lightBg, border: `1px solid ${color.border}` }}>
            <p className="pdf-block-label text-xs font-bold uppercase tracking-widest mb-2" style={{ color: color.accent }}>Required Background</p>
            <ul className="space-y-1">
              {section.prerequisites.map((p, pi) => (
                <li key={pi} className="text-sm flex items-start gap-2">
                  <span className="mt-0.5 flex-shrink-0" style={{ color: color.accent }}>→</span>
                  <EditableListItem value={p} style={{ color: color.badge }}
                    onChange={v => { const a = [...section.prerequisites]; a[pi] = v; patchSection({ prerequisites: a }); }} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Notes */}
        {section.notes !== undefined && (
          <div>
            <p className="pdf-block-label text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Notes</p>
            {/* Rendered notes — always visible on screen and in print */}
            <div className="pdf-notes-block">
              <RenderNotes text={section.notes} />
            </div>
            {/* Edit button — screen only */}
            <RichNotesEditor value={section.notes} onChange={v => patchSection({ notes: v })} />
          </div>
        )}

        {/* Key points */}
        {section.keyPoints?.length > 0 && (
          <div className="pdf-key-points-box rounded-xl p-4" style={{ backgroundColor: color.lightBg, border: `1px solid ${color.border}` }}>
            <p className="pdf-block-label text-xs font-bold uppercase tracking-widest mb-3" style={{ color: color.accent }}>Key Points</p>
            <ul className="space-y-2">
              {section.keyPoints.map((pt, pi) => (
                <li key={pi} className="pdf-key-point flex items-start gap-2 text-sm text-gray-800">
                  <span className="font-bold flex-shrink-0 mt-0.5" style={{ color: color.accent }}>✓</span>
                  <EditableListItem value={pt}
                    onChange={v => { const a = [...section.keyPoints]; a[pi] = v; patchSection({ keyPoints: a }); }} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Key terms */}
        {section.keyTerms?.length > 0 && (
          <div>
            <p className="pdf-block-label text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Key Terms</p>
            <div className="pdf-key-terms-grid grid sm:grid-cols-2 gap-3">
              {section.keyTerms.map((kt, ki) => (
                <div key={ki} className="pdf-key-term border rounded-xl p-3 bg-white" style={{ borderColor: color.border }}>
                  <Editable value={kt.term}
                    onChange={v => { const a = [...section.keyTerms]; a[ki] = { ...a[ki], term: v }; patchSection({ keyTerms: a }); }}
                    className="text-sm font-bold mb-1 block" style={{ color: color.accent }} placeholder="Term…" />
                  <Editable value={kt.definition}
                    onChange={v => { const a = [...section.keyTerms]; a[ki] = { ...a[ki], definition: v }; patchSection({ keyTerms: a }); }}
                    className="text-sm text-gray-600 mb-2 block" placeholder="Definition…" multiline />
                  {kt.example !== undefined && (
                    <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-2 py-1.5">
                      <span className="font-semibold">Example: </span>
                      <Editable value={kt.example}
                        onChange={v => { const a = [...section.keyTerms]; a[ki] = { ...a[ki], example: v }; patchSection({ keyTerms: a }); }}
                        className="inline" placeholder="Example…" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Worked examples */}
        {section.workedExamples?.length > 0 && (
          <div>
            <p className="pdf-block-label text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Worked Examples</p>
            <div className="space-y-4">
              {section.workedExamples.map((ex, ei) => (
                <div key={ei} className="pdf-worked-example border border-gray-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-gray-100" style={{ backgroundColor: color.lightBg }}>
                    <Editable value={ex.title}
                      onChange={v => { const a = [...section.workedExamples]; a[ei] = { ...a[ei], title: v }; patchSection({ workedExamples: a }); }}
                      className="text-sm font-semibold text-gray-900" placeholder="Example title…" />
                  </div>
                  <div className="px-4 py-3 space-y-2">
                    {ex.steps.map((s, si) => (
                      <div key={si} className="pdf-step flex gap-3">
                        <span className="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5"
                          style={{ backgroundColor: color.lightBg, color: color.accent }}>{si + 1}</span>
                        <div className="flex-1">
                          <Editable value={s.step}
                            onChange={v => { const a = [...section.workedExamples]; a[ei] = { ...a[ei], steps: a[ei].steps.map((st, i) => i === si ? { ...st, step: v } : st) }; patchSection({ workedExamples: a }); }}
                            className="text-sm text-gray-900 font-medium block" placeholder="Step…" />
                          <Editable value={s.reason}
                            onChange={v => { const a = [...section.workedExamples]; a[ei] = { ...a[ei], steps: a[ei].steps.map((st, i) => i === si ? { ...st, reason: v } : st) }; patchSection({ workedExamples: a }); }}
                            className="text-xs text-gray-500 mt-0.5 block" placeholder="Why…" />
                        </div>
                      </div>
                    ))}
                  </div>
                  {ex.commonMistake !== undefined && (
                    <div className="px-4 py-2.5 bg-red-50 border-t border-red-100 flex items-start gap-2">
                      <span className="text-red-500 font-bold text-xs mt-0.5 flex-shrink-0">⚠</span>
                      <div className="flex-1 text-xs text-red-700">
                        <span className="font-semibold">Common mistake: </span>
                        <Editable value={ex.commonMistake}
                          onChange={v => { const a = [...section.workedExamples]; a[ei] = { ...a[ei], commonMistake: v }; patchSection({ workedExamples: a }); }}
                          className="inline" placeholder="Describe the common mistake…" />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Comparison table */}
        {section.comparisonTable && section.comparisonTable.rows?.length > 0 && (() => {
          const ct = section.comparisonTable!;
          return (
          <div>
            <p className="pdf-block-label text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Comparison</p>
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200" style={{ backgroundColor: color.lightBg }}>
                    <th className="text-left px-4 py-2.5 text-xs font-bold text-gray-500 uppercase w-1/4">Aspect</th>
                    <th className="text-left px-4 py-2.5 text-xs font-bold uppercase" style={{ color: color.accent }}>
                      <Editable value={ct.labelA}
                        onChange={v => patchSection({ comparisonTable: { ...ct, labelA: v } })}
                        className="text-xs font-bold uppercase" style={{ color: color.accent }} placeholder="Label A…" />
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-bold text-gray-600 uppercase">
                      <Editable value={ct.labelB}
                        onChange={v => patchSection({ comparisonTable: { ...ct, labelB: v } })}
                        className="text-xs font-bold uppercase text-gray-600" placeholder="Label B…" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ct.rows.map((row, ri) => (
                    <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-2.5 text-xs font-semibold text-gray-600 border-b border-gray-100">
                        <Editable value={row.aspect}
                          onChange={v => { const rows = [...ct.rows]; rows[ri] = { ...rows[ri], aspect: v }; patchSection({ comparisonTable: { ...ct, rows } }); }}
                          className="text-xs font-semibold text-gray-600" placeholder="Aspect…" />
                      </td>
                      <td className="px-4 py-2.5 text-sm text-gray-700 border-b border-gray-100">
                        <Editable value={row.optionA}
                          onChange={v => { const rows = [...ct.rows]; rows[ri] = { ...rows[ri], optionA: v }; patchSection({ comparisonTable: { ...ct, rows } }); }}
                          className="text-sm text-gray-700" placeholder="Option A…" multiline />
                      </td>
                      <td className="px-4 py-2.5 text-sm text-gray-700 border-b border-gray-100">
                        <Editable value={row.optionB}
                          onChange={v => { const rows = [...ct.rows]; rows[ri] = { ...rows[ri], optionB: v }; patchSection({ comparisonTable: { ...ct, rows } }); }}
                          className="text-sm text-gray-700" placeholder="Option B…" multiline />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          );
        })()}

        {/* Discussion prompts */}
        {section.reviewQuestions?.length > 0 && (
          <div>
            <p className="pdf-block-label text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Discussion Prompts</p>
            <div className="space-y-3">
              {section.reviewQuestions.map((rq, qi) => (
                <div key={qi} className="pdf-review-question border border-gray-200 rounded-xl p-4">
                  <div className="flex items-start gap-1.5 mb-2">
                    <span className="text-gray-400 text-sm font-semibold flex-shrink-0">Q{qi + 1}.</span>
                    <Editable value={rq.question}
                      onChange={v => { const a = [...section.reviewQuestions]; a[qi] = { ...a[qi], question: v }; patchSection({ reviewQuestions: a }); }}
                      className="text-sm font-semibold text-gray-900 flex-1" placeholder="Question…" multiline />
                  </div>
                  {showAnswers && (
                    <div className="mt-2 pt-2 border-t border-green-100 bg-green-50 rounded-lg px-3 py-2">
                      <p className="text-xs font-bold text-green-700 mb-1">Answer</p>
                      <Editable value={rq.answer}
                        onChange={v => { const a = [...section.reviewQuestions]; a[qi] = { ...a[qi], answer: v }; patchSection({ reviewQuestions: a }); }}
                        className="text-sm text-green-900 block" placeholder="Answer…" multiline />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PdfPackPage() {
  const isCreator = useIsCreator();
  const params = useParams();
  const id = params.id as string;

  const [pack, setPack] = useState<PdfPack | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [course, setCourseState] = useState<Course | null>(null);
  const [saved, setSaved] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);
  const [sectionColors, setSectionColors] = useState<Record<number, string>>({});
  const [coverColor, setCoverColor] = useState<string>(PALETTE[0].bg);
  const [showCoverPicker, setShowCoverPicker] = useState(false);
  const coverPickerRef = useRef<HTMLDivElement>(null);
  const [fontSettings, setFontSettings] = useState<FontSettings>({ fontId: 'system', bold: false });

  // imageState[i]: undefined=pending, null=loading, ''=failed, string=dataUrl
  const [imageState, setImageState] = useState<Record<number, string | null | undefined>>({});
  const imageStateRef = useRef<Record<number, string | null | undefined>>({});

  useEffect(() => {
    function h(e: MouseEvent) { if (coverPickerRef.current && !coverPickerRef.current.contains(e.target as Node)) setShowCoverPicker(false); }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => {
    imageStateRef.current = {};
    (async () => {
      const DELAYS = [300, 700, 1500, 2500, 3000];
      let c = await dbGetCourse(id);
      for (let i = 0; !c && i < DELAYS.length; i++) {
        await new Promise(r => setTimeout(r, DELAYS[i]));
        c = await dbGetCourse(id);
      }
      if (!c) { setNotFound(true); return; }
      setCourseState(c);
      document.title = cleanTitle(c.title);
      if (c.status === 'published') dbIncrementViews(c.id);
      const p = c.modules[0]?.pdfPack;
      if (p) {
        setPack(p);
        const defaults: Record<number, string> = {};
        p.sections.forEach((_, i) => { defaults[i] = PALETTE[i % PALETTE.length].bg; });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const saved = (p as any).__sectionColors as Record<number, string> | undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const savedCover = (p as any).__coverColor as string | undefined;
        setSectionColors(saved ?? defaults);
        if (savedCover) setCoverColor(savedCover);

        // Generate images for each section (sequentially to avoid rate limits)
        // Only runs if the course was created with generateImages=true
        const generateAll = async (loadedCourse: Course, loadedPack: PdfPack) => {
          // Track the latest sections so each save includes all previously-saved images
          let latestSections = [...loadedPack.sections];
          for (let i = 0; i < loadedPack.sections.length; i++) {
            const section = loadedPack.sections[i];
            // Always show already-saved image immediately
            if (section.imageUrl) {
              imageStateRef.current = { ...imageStateRef.current, [i]: section.imageUrl };
              setImageState(prev => ({ ...prev, [i]: section.imageUrl }));
              continue;
            }
            // Only generate new images if the course was opted in
            if (!loadedCourse.generateImages) continue;
            imageStateRef.current = { ...imageStateRef.current, [i]: null };
            setImageState(prev => ({ ...prev, [i]: null }));
            try {
              // Server uploads to Storage AND patches courses.modules[0].pdfPack.sections[i].imageUrl
              // directly — returns publicUrl (or dataUrl fallback). Belt-and-suspenders: also
              // call dbSaveCourse so the full course row is guaranteed up-to-date.
              const publicUrl = await generateSectionImage(section.title, section.overview ?? '', loadedCourse.id, i);
              imageStateRef.current = { ...imageStateRef.current, [i]: publicUrl };
              setImageState(prev => ({ ...prev, [i]: publicUrl }));
              latestSections = latestSections.map((s, j) => j === i ? { ...s, imageUrl: publicUrl } : s);
              const updatedPack = { ...loadedPack, sections: latestSections };
              const updatedCourse = { ...loadedCourse, modules: loadedCourse.modules.map((m, idx) => idx === 0 ? { ...m, pdfPack: updatedPack } : m) };
              setPack(updatedPack);
              setCourseState(updatedCourse);
              await dbSaveCourse(updatedCourse);
            } catch {
              // Timeout or network error — surface Retry/Upload buttons immediately
              imageStateRef.current = { ...imageStateRef.current, [i]: '' };
              setImageState(prev => ({ ...prev, [i]: '' }));
            }
          }
        };
        generateAll(c, p);
      }
    })();
    return () => { document.title = 'Content Guide'; };
  }, [id]);

  // Load font settings — prefer value saved on the course row (Supabase), fall back to localStorage
  useEffect(() => {
    if (!id) return;
    // course state may not be set yet; re-read it when course loads (handled below)
    setFontSettings(loadFontSettings(id));
  }, [id]);

  // Once the course loads, sync font settings from the Supabase row
  useEffect(() => {
    if (!course) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const saved = loadFontSettingsFromCourse(id, course.modules[0] as any);
    setFontSettings(saved);
  }, [course, id]);

  function handleFontChange(s: FontSettings) {
    setFontSettings(s);
    // Save to localStorage for immediate local access
    saveFontSettings(id, s);
    // Also persist to Supabase inside the module row so it survives on any device
    if (course) {
      const updatedCourse = {
        ...course,
        modules: course.modules.map((m, i) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          i === 0 ? { ...m, fontSettings: s } as any : m
        ),
      };
      setCourseState(updatedCourse);
      dbSaveCourse(updatedCourse);
    }
    // Inject Google Font link if needed
    const font = getFontOption(s.fontId);
    if (font.url && !document.querySelector(`link[data-font="${s.fontId}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = font.url;
      link.setAttribute('data-font', s.fontId);
      document.head.appendChild(link);
    }
  }

  // Persist pack edits back to course in Supabase
  const persistPack = useCallback((updatedPack: PdfPack) => {
    setPack(updatedPack);
    if (!course) return;
    const updatedCourse = { ...course, modules: course.modules.map((m, i) => i === 0 ? { ...m, pdfPack: updatedPack } : m) };
    setCourseState(updatedCourse);
    dbSaveCourse(updatedCourse);
  }, [course]);

  function patchPackColors(colors: Record<number, string>, cover: string) {
    if (!pack || !course) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = { ...pack, __sectionColors: colors, __coverColor: cover } as any;
    persistPack(updated);
  }

  function updateSectionColor(index: number, hex: string) {
    const next = { ...sectionColors, [index]: hex };
    setSectionColors(next);
    patchPackColors(next, coverColor);
  }

  function updateCoverColor(hex: string) {
    setCoverColor(hex);
    patchPackColors(sectionColors, hex);
  }

  function updateSection(index: number, section: PdfSection) {
    if (!pack) return;
    const sections = pack.sections.map((s, i) => i === index ? section : s);
    persistPack({ ...pack, sections });
  }

  function regenerateImage(index: number) {
    const section = pack?.sections[index];
    if (!section || !pack || !course) return;
    imageStateRef.current = { ...imageStateRef.current, [index]: null };
    setImageState(prev => ({ ...prev, [index]: null }));
    // Server uploads to Storage AND patches the course row directly
    generateSectionImage(section.title, section.overview ?? '', course.id, index)
      .then(publicUrl => {
        imageStateRef.current = { ...imageStateRef.current, [index]: publicUrl };
        setImageState(prev => ({ ...prev, [index]: publicUrl }));
        const sections = pack.sections.map((s, i) => i === index ? { ...s, imageUrl: publicUrl } : s);
        persistPack({ ...pack, sections });
      })
      .catch(() => {
        // Timeout or network error — surface Retry/Upload buttons immediately
        imageStateRef.current = { ...imageStateRef.current, [index]: '' };
        setImageState(prev => ({ ...prev, [index]: '' }));
      });
  }

  function uploadImage(index: number, file: File) {
    if (!pack || !course) return;
    const reader = new FileReader();
    reader.onload = async e => {
      const dataUrl = e.target?.result as string;
      if (dataUrl) {
        // Show local preview immediately
        imageStateRef.current = { ...imageStateRef.current, [index]: dataUrl };
        setImageState(prev => ({ ...prev, [index]: dataUrl }));
        // Upload to Storage and swap to public URL
        const publicUrl = await dbUploadImage(course.id, index, dataUrl) ?? dataUrl;
        imageStateRef.current = { ...imageStateRef.current, [index]: publicUrl };
        setImageState(prev => ({ ...prev, [index]: publicUrl }));
        const sections = pack.sections.map((s, i) => i === index ? { ...s, imageUrl: publicUrl } : s);
        persistPack({ ...pack, sections });
      }
    };
    reader.readAsDataURL(file);
  }

  function printPdf() {
    window.print();
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
    setCourseState(updated);
    await dbSaveCourse(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  if (!pack) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        {notFound ? (
          <p className="text-gray-500">Content not found.</p>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-4 border-green-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-400">Loading…</p>
          </div>
        )}
      </div>
    );
  }

  if (!isCreator && course && course.status !== 'published') {
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

  const coverPalette = paletteFromHex(coverColor);

  return (
    <>
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
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
          <span className="text-sm font-medium text-gray-700 truncate max-w-xs">{cleanTitle(course?.title ?? '')}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="print:hidden text-xs text-gray-400 hidden sm:block">Click any text to edit</span>
          <button onClick={() => setShowAnswers(s => !s)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${showAnswers ? 'bg-green-50 border-green-300 text-green-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            <CheckSquare size={13} /> {showAnswers ? 'Hide Answers' : 'Show Answers'}
          </button>
          <button onClick={printPdf}
            className="inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-semibold rounded-lg transition-colors"
            style={{ backgroundColor: coverColor }}>
            <Printer size={14} /> Save as PDF
          </button>
        </div>
      </div>

      {/* ── Document ─────────────────────────────────────────────────────── */}
      <div className="bg-gray-50 min-h-screen print:bg-white">
        <div id="pdf-print-content" className="pdf-page-wrapper max-w-[820px] mx-auto px-6 py-10 print:px-0 print:py-0 print:max-w-none">

          {/* ── Cover ────────────────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden mb-6 print:rounded-none print:border-0 print:mb-0">
            <div className="px-8 pt-10 pb-8 relative" style={{ backgroundColor: coverPalette.bg }}>
              {/* Cover color picker */}
              <div ref={coverPickerRef} className="absolute top-3 right-3 print:hidden">
                <button onClick={() => setShowCoverPicker(o => !o)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-white/15 hover:bg-white/25 rounded-lg transition-colors"
                  style={{ color: coverPalette.text }}>
                  <Palette size={11} /> Cover colour
                </button>
                {showCoverPicker && (
                  <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-lg p-3 w-44">
                    <p className="text-xs font-semibold text-gray-500 mb-2">Cover colour</p>
                    <div className="grid grid-cols-6 gap-1.5 mb-2">
                      {SWATCH_COLORS.map(hex => (
                        <button key={hex} onClick={() => { updateCoverColor(hex); setShowCoverPicker(false); }}
                          className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                          style={{ backgroundColor: hex, borderColor: hex === coverColor ? '#111' : 'transparent' }} />
                      ))}
                    </div>
                    <div className="flex items-center gap-2 border-t border-gray-100 pt-2">
                      <label className="text-xs text-gray-500">Custom</label>
                      <input type="color" value={coverColor} onChange={e => updateCoverColor(e.target.value)} className="w-8 h-6 rounded cursor-pointer border border-gray-200" />
                    </div>
                  </div>
                )}
              </div>
              <h1 className="text-3xl font-bold leading-tight mb-3">
                <Editable value={pack.title} onChange={v => persistPack({ ...pack, title: v })}
                  className="text-3xl font-bold leading-tight" style={{ color: coverPalette.text }} placeholder="Pack title…" />
              </h1>
              <Editable value={pack.description} onChange={v => persistPack({ ...pack, description: v })}
                className="text-base leading-relaxed block" style={{ color: coverPalette.text, opacity: 0.85 }}
                placeholder="Description…" multiline />
            </div>

            {/* Topic overview + contents */}
            <div className="px-8 py-6 grid sm:grid-cols-3 gap-6 border-b border-gray-100">
              <div className="sm:col-span-2">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2 flex items-center gap-1.5">
                  <BookOpen size={11} /> Topic Overview
                </p>
                <Editable value={pack.topicOverview} onChange={v => persistPack({ ...pack, topicOverview: v })}
                  className="text-sm text-gray-700 leading-relaxed block" placeholder="Topic overview…" multiline />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2 flex items-center gap-1.5">
                  <List size={11} /> Contents
                </p>
                <ul className="space-y-1">
                  {pack.sections.map((s, i) => {
                    const c = paletteFromHex(sectionColors[i] ?? PALETTE[i % PALETTE.length].bg);
                    return (
                      <li key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
                        <span className="font-bold flex-shrink-0" style={{ color: c.accent }}>{i + 1}.</span>
                        <Editable value={s.title}
                          onChange={v => { const sections = pack.sections.map((sec, si) => si === i ? { ...sec, title: v } : sec); persistPack({ ...pack, sections }); }}
                          className="text-xs text-gray-600" placeholder="Section title…" />
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            {/* Learning objectives + required background */}
            <div className="px-8 py-6 grid sm:grid-cols-2 gap-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2 flex items-center gap-1.5">
                  <Target size={11} /> Learning Objectives
                </p>
                <ul className="space-y-1.5">
                  {pack.learningObjectives.map((obj, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <span className="font-bold mt-0.5 flex-shrink-0" style={{ color: coverPalette.accent }}>→</span>
                      <EditableListItem value={obj}
                        onChange={v => { const a = [...pack.learningObjectives]; a[i] = v; persistPack({ ...pack, learningObjectives: a }); }} />
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2 flex items-center gap-1.5">
                  <FileText size={11} /> Required Background
                </p>
                <ul className="space-y-1.5">
                  {pack.requiredBackground.map((req, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                      <span className="text-gray-400 flex-shrink-0">•</span>
                      <EditableListItem value={req}
                        onChange={v => { const a = [...pack.requiredBackground]; a[i] = v; persistPack({ ...pack, requiredBackground: a }); }} />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* ── Sections ─────────────────────────────────────────────────── */}
          {pack.sections.map((section, i) => {
            const hex = sectionColors[i] ?? PALETTE[i % PALETTE.length].bg;
            return (
              <SectionCard
                key={section.id ?? i}
                section={section}
                index={i}
                showAnswers={showAnswers}
                color={paletteFromHex(hex)}
                onColorChange={hex => updateSectionColor(i, hex)}
                onSectionChange={s => updateSection(i, s)}
                imageUrl={imageState[i]}
                onRegenerateImage={() => regenerateImage(i)}
                onUploadImage={file => uploadImage(i, file)}
              />
            );
          })}

          {/* ── Final summary ─────────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden print:rounded-none print:border-0 print:border-t-2 print:border-gray-200 print:break-before-page">
            <div className="px-6 py-4" style={{ backgroundColor: '#111827' }}>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-0.5">Final Summary</p>
              <h2 className="text-lg font-bold text-white">What You Must Know</h2>
            </div>
            <div className="px-6 py-6 grid sm:grid-cols-2 gap-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Main Takeaways</p>
                <ul className="space-y-2">
                  {pack.summary.mainTakeaways.map((t, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <span className="font-bold flex-shrink-0 mt-0.5" style={{ color: coverPalette.accent }}>✓</span>
                      <EditableListItem value={t}
                        onChange={v => { const a = [...pack.summary.mainTakeaways]; a[i] = v; persistPack({ ...pack, summary: { ...pack.summary, mainTakeaways: a } }); }} />
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Must Remember ✓</p>
                <ul className="space-y-2">
                  {pack.summary.mustRemember.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <span className="w-4 h-4 rounded border-2 border-gray-300 flex-shrink-0 mt-0.5" />
                      <EditableListItem value={item}
                        onChange={v => { const a = [...pack.summary.mustRemember]; a[i] = v; persistPack({ ...pack, summary: { ...pack.summary, mustRemember: a } }); }} />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ── Print styles ─────────────────────────────────────────────────── */}
      <style>{`
        @media print {
          /*
           * @page margin: 0 removes the browser's date/time/URL/title/page-number
           * chrome entirely. Spacing is handled via .pdf-page-wrapper padding below.
           */
          @page {
            margin: 0.5in;
            size: A4 portrait;
          }

          /* Force all background colours to print */
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }

          body {
            font-size: 10.5pt;
            margin: 0;
            padding: 0;
            background: white !important;
          }

          /* @page handles all margins — no extra padding needed */
          .pdf-page-wrapper {
            padding: 0 !important;
          }

          .print\\:break-before-page {
            page-break-before: always;
          }

          /* Glue section header to the first block below it */
          .pdf-section-header { page-break-after: avoid; }

          /* Never split these blocks mid-page */
          .pdf-key-term,
          .pdf-worked-example,
          .pdf-review-question,
          .pdf-step,
          .pdf-key-points-box { page-break-inside: avoid; }

          /* Never orphan a label from its content */
          .pdf-block-label { page-break-after: avoid; }

          /* Notes: allow breaks between paragraphs but not inside them */
          .pdf-notes-block p,
          .pdf-notes-block li { page-break-inside: avoid; }
          .pdf-notes-block h3,
          .pdf-notes-block h4 { page-break-after: avoid; }

          /* Key terms: single column in print */
          .pdf-key-terms-grid { display: block !important; }
          .pdf-key-terms-grid > * { margin-bottom: 0.3cm; }

          /* Hide screen-only UI */
          .print\\:hidden { display: none !important; }
        }
      `}</style>

      {/* Feedback — screen only */}
      {pack && course && (
        <div className="print:hidden max-w-4xl mx-auto px-6 pb-10">
          <FeedbackForm courseId={course.id} contentTitle={course.title} accentColor="rose" />
        </div>
      )}
    </>
  );
}

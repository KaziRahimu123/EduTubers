'use client';

import { useState, useRef } from 'react';
import { Pencil } from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineMdToHtml(text: string): string {
  return escHtml(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/** Convert stored markdown string → HTML for contentEditable display */
export function mdToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('## ')) {
      out.push(`<h3>${escHtml(line.slice(3))}</h3>`);
    } else if (line.startsWith('### ')) {
      out.push(`<h4>${escHtml(line.slice(4))}</h4>`);
    } else if (line.match(/^[-•] /)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[-•] /)) { items.push(lines[i].slice(2)); i++; }
      out.push(`<ul>${items.map(b => `<li>${inlineMdToHtml(b)}</li>`).join('')}</ul>`);
      continue;
    } else if (line.match(/^\d+\. /)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\. /)) { items.push(lines[i].replace(/^\d+\. /, '')); i++; }
      out.push(`<ol>${items.map(b => `<li>${inlineMdToHtml(b)}</li>`).join('')}</ol>`);
      continue;
    } else if (line.trim() === '') {
      out.push('<p><br></p>');
    } else {
      out.push(`<p>${inlineMdToHtml(line)}</p>`);
    }
    i++;
  }
  return out.join('');
}

/** Convert contentEditable HTML → markdown to store */
export function htmlToMd(html: string): string {
  const lines: string[] = [];
  const tmp = document.createElement('div');
  tmp.innerHTML = html;

  function nodeToMd(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    const el = node as HTMLElement;
    const tag = el.tagName?.toLowerCase();
    const inner = Array.from(el.childNodes).map(nodeToMd).join('');
    if (tag === 'strong' || tag === 'b') return `**${inner}**`;
    if (tag === 'br') return '\n';
    if (tag === 'h3') { lines.push(`## ${inner.trim()}`); return ''; }
    if (tag === 'h4') { lines.push(`### ${inner.trim()}`); return ''; }
    if (tag === 'li') return inner;
    if (tag === 'ul') {
      Array.from(el.querySelectorAll(':scope > li')).forEach(li =>
        lines.push(`- ${Array.from(li.childNodes).map(nodeToMd).join('')}`)
      );
      return '';
    }
    if (tag === 'ol') {
      Array.from(el.querySelectorAll(':scope > li')).forEach((li, idx) =>
        lines.push(`${idx + 1}. ${Array.from(li.childNodes).map(nodeToMd).join('')}`)
      );
      return '';
    }
    if (tag === 'p' || tag === 'div') {
      const text = inner.trim();
      lines.push(text === '' || text === '\n' ? '' : text);
      return '';
    }
    return inner;
  }

  Array.from(tmp.childNodes).forEach(nodeToMd);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── Shared toolbar ────────────────────────────────────────────────────────────

function Toolbar({ exec, wrap }: { exec: (cmd: string) => void; wrap: (tag: string) => void }) {
  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 bg-gray-50 border-b border-gray-200 flex-wrap">
      <TBtn onMouseDown={() => exec('bold')} title="Bold"><b>B</b></TBtn>
      <TBtn onMouseDown={() => exec('italic')} title="Italic"><i>I</i></TBtn>
      <div className="w-px h-4 bg-gray-300 mx-1" />
      <TBtn onMouseDown={() => wrap('h3')} title="Heading">H2</TBtn>
      <TBtn onMouseDown={() => wrap('h4')} title="Sub-heading">H3</TBtn>
      <TBtn onMouseDown={() => wrap('p')} title="Normal text">¶</TBtn>
      <div className="w-px h-4 bg-gray-300 mx-1" />
      <TBtn onMouseDown={() => exec('insertUnorderedList')} title="Bullet list">• List</TBtn>
      <TBtn onMouseDown={() => exec('insertOrderedList')} title="Numbered list">1. List</TBtn>
      <div className="w-px h-4 bg-gray-300 mx-1" />
      <TBtn onMouseDown={() => exec('undo')} title="Undo">↩</TBtn>
      <TBtn onMouseDown={() => exec('redo')} title="Redo">↪</TBtn>
    </div>
  );
}

function TBtn({ onMouseDown, title, children }: { onMouseDown: () => void; title: string; children: React.ReactNode }) {
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

const EDITOR_CLASSES = `
  min-h-[80px] p-3 text-sm text-gray-800 leading-relaxed focus:outline-none bg-white
  [&_h3]:text-base [&_h3]:font-bold [&_h3]:text-gray-900 [&_h3]:mt-3 [&_h3]:mb-1
  [&_h4]:text-sm [&_h4]:font-bold [&_h4]:text-gray-800 [&_h4]:mt-2 [&_h4]:mb-0.5
  [&_ul]:list-disc [&_ul]:list-inside [&_ul]:ml-2 [&_ul]:space-y-0.5
  [&_ol]:list-decimal [&_ol]:list-inside [&_ol]:ml-2 [&_ol]:space-y-0.5
  [&_li]:text-sm [&_li]:text-gray-700
  [&_strong]:font-semibold [&_strong]:text-gray-900
  [&_p]:mb-1
`.trim();

// ── RichField ─────────────────────────────────────────────────────────────────
/**
 * RichField — always-visible rich text editor, drop-in for <textarea>.
 * Use wherever you have a labelled text area in an editor form.
 * onChange fires on every keystroke (live), matching textarea behaviour.
 */
export function RichField({
  value,
  onChange,
  placeholder,
  minHeight = '80px',
  accentColor = '#2563eb',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minHeight?: string;
  accentColor?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  function exec(cmd: string) { ref.current?.focus(); document.execCommand(cmd, false, undefined); }
  function wrap(tag: string) { ref.current?.focus(); document.execCommand('formatBlock', false, tag); }

  return (
    <div className="border-2 rounded-xl overflow-hidden" style={{ borderColor: accentColor }}>
      <Toolbar exec={exec} wrap={wrap} />
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        dangerouslySetInnerHTML={{ __html: mdToHtml(value) }}
        onInput={() => { if (ref.current) onChange(htmlToMd(ref.current.innerHTML)); }}
        data-placeholder={placeholder}
        className={`${EDITOR_CLASSES} empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400 empty:before:italic`}
        style={{ minHeight }}
      />
    </div>
  );
}

// ── RichNotesEditor ───────────────────────────────────────────────────────────
/**
 * RichNotesEditor — collapsed by default, opens on "Edit notes" click.
 * Used inside PDF pack / visual guide section note areas.
 */
export default function RichNotesEditor({
  value,
  onChange,
  editLabel = 'Edit notes',
  accentColor = '#2563eb',
}: {
  value: string;
  onChange: (v: string) => void;
  editLabel?: string;
  accentColor?: string;
}) {
  const [editing, setEditing] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  function exec(cmd: string) { editorRef.current?.focus(); document.execCommand(cmd, false, undefined); }
  function wrap(tag: string) { editorRef.current?.focus(); document.execCommand('formatBlock', false, tag); }

  function handleDone() {
    onChange(htmlToMd(editorRef.current?.innerHTML ?? ''));
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="print:hidden mt-1 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 transition-colors"
      >
        <Pencil size={10} /> {editLabel}
      </button>
    );
  }

  return (
    <div className="print:hidden mt-2 border-2 border-blue-400 rounded-xl overflow-hidden">
      <Toolbar exec={exec} wrap={wrap} />
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        dangerouslySetInnerHTML={{ __html: mdToHtml(value) }}
        className={`${EDITOR_CLASSES} min-h-[140px]`}
      />
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-t border-gray-200">
        <button
          onClick={handleDone}
          className="px-3 py-1 text-xs font-semibold text-white rounded-lg hover:opacity-90"
          style={{ backgroundColor: accentColor }}
        >
          Done
        </button>
        <button onClick={() => setEditing(false)} className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700">
          Cancel
        </button>
      </div>
    </div>
  );
}

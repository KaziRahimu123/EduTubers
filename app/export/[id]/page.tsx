'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Copy, Download, Globe, Check, Printer, Share2, FileText, Code } from 'lucide-react';
import Layout from '@/components/Layout';
import { dbGetCourse, dbSaveCourse, dbMakeSlug } from '@/lib/db';
import type { Course } from '@/lib/types';
import { cleanTitle } from '@/lib/cleanTitle';

function toMarkdown(course: Course): string {
  const lines = [`# ${cleanTitle(course.title)}`, '', course.description, '', `**Level:** ${course.learnerLevel}`, '', '## Goals', ...course.learningGoals.map(g => `- ${g}`), ''];
  course.modules.forEach((mod, i) => {
    lines.push(`## Module ${i + 1}: ${mod.title}`, '', `**Objective:** ${mod.objective}`, '', mod.lessonNotes, '');
    mod.flashcards.forEach(f => lines.push(`- **${f.front}** — ${f.back}`));
    mod.quizQuestions.forEach((q, qi) => { lines.push(`**Q${qi + 1}:** ${q.question}`); q.choices.forEach((c, ci) => lines.push(`${ci === q.correctAnswer ? '✅' : '  '} ${ci + 1}. ${c}`)); lines.push(`> ${q.explanation}`, ''); });
  });
  return lines.join('\n');
}

export default function ExportPage() {
  const params = useParams();
  const id = params.id as string;
  const [course, setCourse] = useState<Course | null>(null);

  useEffect(() => {
    dbGetCourse(id).then(c => { if (c) setCourse(c); });
  }, [id]);
  const [copied, setCopied] = useState<string | null>(null);

  if (!course) return <Layout><p className="text-center py-20 text-gray-500">Guide not found.</p></Layout>;

  async function copy(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key); setTimeout(() => setCopied(null), 2000);
  }
  function download(content: string, filename: string, type: string) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([content], { type })), download: filename });
    a.click(); URL.revokeObjectURL(a.href);
  }
  async function togglePublish() {
    if (!course) return;
    const isPublishing = course.status !== 'published';
    let slug = course.slug;
    if (isPublishing && !slug) {
      slug = await dbMakeSlug(cleanTitle(course.title), course.id);
    }
    const updated: Course = {
      ...course,
      status: isPublishing ? 'published' : 'draft',
      slug: isPublishing ? slug : undefined,
    };
    setCourse(updated);
    await dbSaveCourse(updated);
  }

  const md = toMarkdown(course);
  const json = JSON.stringify(course, null, 2);
  const slug = `${typeof window !== 'undefined' ? window.location.origin : ''}/course/${course.id}`;
  const sharePack = `📚 ${cleanTitle(course.title)}\n\n${course.description}\n\nWhat you'll learn:\n${course.learningGoals.map(g => `• ${g}`).join('\n')}\n\n${course.shareText}`;

  const CopyBtn = ({ text, label }: { text: string; label: string }) => (
    <button onClick={() => copy(text, label)} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">
      {copied === label ? <><Check size={11} className="text-green-500" /> Copied!</> : <><Copy size={11} /> Copy</>}
    </button>
  );

  return (
    <Layout>
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/editor/${course.id}`} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft size={15} /> Editor</Link>
        <h1 className="text-2xl font-bold text-gray-900 flex-1">Export & Publish</h1>
      </div>

      {/* Publish */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div><h2 className="text-base font-semibold text-gray-900">Publish Status</h2>
            <p className="text-sm text-gray-500">Publishing makes the course accessible via a public link.</p></div>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${course.status === 'published' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{course.status}</span>
        </div>
        {course.status === 'published' && (
          <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg mb-3">
            <Globe size={13} className="text-blue-600 flex-shrink-0" />
            <code className="text-xs text-blue-700 flex-1 break-all">{slug}</code>
            <CopyBtn text={slug} label="link" />
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={togglePublish} className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg ${course.status === 'published' ? 'border border-gray-200 text-gray-600 hover:bg-gray-50' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
            <Globe size={13} /> {course.status === 'published' ? 'Unpublish' : 'Publish Course'}
          </button>
          {course.status === 'published' && <Link href={`/course/${course.id}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50"><Globe size={13} /> View</Link>}
        </div>
      </div>

      {/* Share pack */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
        <div className="flex items-center justify-between mb-2"><h2 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Share2 size={15} /> Share Pack</h2><CopyBtn text={sharePack} label="share" /></div>
        <pre className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 overflow-auto max-h-36 whitespace-pre-wrap">{sharePack}</pre>
      </div>

      {/* Markdown */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2"><FileText size={15} /> Markdown</h2>
          <div className="flex gap-2"><CopyBtn text={md} label="md" /><button onClick={() => download(md, `${course.title}.md`, 'text/markdown')} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"><Download size={11} /> .md</button></div>
        </div>
        <pre className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 overflow-auto max-h-36 whitespace-pre-wrap">{md.slice(0, 500)}{md.length > 500 ? '\n…' : ''}</pre>
      </div>

      {/* JSON */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Code size={15} /> JSON</h2>
          <div className="flex gap-2"><CopyBtn text={json} label="json" /><button onClick={() => download(json, `${course.title}.json`, 'application/json')} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"><Download size={11} /> .json</button></div>
        </div>
        <pre className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 overflow-auto max-h-36">{json.slice(0, 500)}{json.length > 500 ? '\n…' : ''}</pre>
      </div>

      {/* Print */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-1"><h2 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Printer size={15} /> Print / PDF</h2>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"><Printer size={11} /> Print</button>
        </div>
        <p className="text-sm text-gray-500">Use your browser&apos;s print dialog to save as PDF.</p>
      </div>
    </Layout>
  );
}

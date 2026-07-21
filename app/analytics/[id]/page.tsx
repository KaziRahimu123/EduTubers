'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Eye, CheckCircle, Star, BarChart2 } from 'lucide-react';
import Layout from '@/components/Layout';
import ProgressBar from '@/components/ProgressBar';
import { dbGetCourse, dbSaveCourse, dbGetFeedback } from '@/lib/db';
import type { Course, FeedbackComment } from '@/lib/types';

export default function AnalyticsPage() {
  const params = useParams();
  const id = params.id as string;
  const [course, setCourse] = useState<Course | undefined>();
  const [feedback, setFeedback] = useState<FeedbackComment[]>([]);

  useEffect(() => {
    dbGetCourse(id).then(c => { if (c) setCourse(c); });
    dbGetFeedback(id).then(setFeedback);
  }, [id]);

  if (!course) return <Layout><p className="text-center py-20 text-gray-500">Guide not found.</p></Layout>;

  const avg = feedback.length ? (feedback.reduce((s, f) => s + f.rating, 0) / feedback.length).toFixed(1) : '—';
  const pct = course.views > 0 ? Math.round((course.completions / course.views) * 100) : 0;
  const flashcardCount = course.modules.reduce((s, m) => s + m.flashcards.length, 0);
  const quizCount = course.modules.reduce((s, m) => s + m.quizQuestions.length, 0);

  function bump(field: 'views' | 'completions') {
    const c = course!;
    const updated: Course = { ...c, [field]: c[field] + 1 };
    dbSaveCourse(updated); setCourse(updated);
  }

  return (
    <Layout>
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/editor/${course.id}`} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft size={15} /> Editor</Link>
        <div className="flex-1"><h1 className="text-2xl font-bold text-gray-900">{course.title}</h1><p className="text-sm text-gray-500">Analytics</p></div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Views', value: course.views, color: 'text-blue-600' },
          { label: 'Completions', value: course.completions, color: 'text-green-600' },
          { label: 'Avg Rating', value: avg, color: 'text-amber-500' },
          { label: 'Completion Rate', value: `${pct}%`, color: 'text-purple-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase font-medium tracking-wide">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <h2 className="text-base font-semibold text-gray-900 mb-3">Completion Rate</h2>
        <ProgressBar value={course.completions} max={Math.max(course.views, 1)} label={`${course.completions} of ${course.views} viewers completed`} />
      </div>

      <div className="grid sm:grid-cols-3 gap-4 mb-4">
        {[['Modules', course.modules.length, 'text-blue-600'], ['Flashcards', flashcardCount, 'text-purple-600'], ['Quiz Questions', quizCount, 'text-orange-500']].map(([l, v, c]) => (
          <div key={l as string} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className={`text-2xl font-bold ${c}`}>{v}</p><p className="text-xs text-gray-500 mt-1">{l}</p>
          </div>
        ))}
      </div>

      {feedback.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <h2 className="text-base font-semibold text-gray-900 mb-3">Recent Feedback</h2>
          {feedback.slice(0, 5).map(f => (
            <div key={f.id} className="p-3 bg-gray-50 rounded-lg mb-2">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium">{f.name}</p>
                <span className="text-xs text-amber-500">{'★'.repeat(f.rating)}{'☆'.repeat(5 - f.rating)}</span>
              </div>
              <p className="text-sm text-gray-600">{f.comment}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border-2 border-dashed border-gray-200 p-4">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Demo Controls</h2>
        <p className="text-xs text-gray-400 mb-3">Simulate engagement for demo purposes.</p>
        <div className="flex gap-2">
          <button onClick={() => bump('views')} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"><Eye size={12} /> +1 View</button>
          <button onClick={() => bump('completions')} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"><CheckCircle size={12} /> +1 Completion</button>
        </div>
      </div>
    </Layout>
  );
}

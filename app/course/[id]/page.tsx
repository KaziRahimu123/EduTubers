'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronRight, CheckCircle, Lock } from 'lucide-react';
import EduTubersLogo from '@/components/EduTubersLogo';
import ProgressBar from '@/components/ProgressBar';
import { dbGetCourse } from '@/lib/db';
import type { Course } from '@/lib/types';
import { cleanTitle } from '@/lib/cleanTitle';

export default function PublicCoursePage() {
  const params = useParams();
  const id = params.id as string;
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress] = useState<Record<string, boolean>>({});

  useEffect(() => {
    dbGetCourse(id).then(c => { setCourse(c); setLoading(false); });
  }, [id]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!course || course.status !== 'published') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Lock size={40} className="mx-auto text-gray-300 mb-4" />
          <h1 className="text-xl font-semibold text-gray-700 mb-2">Guide not available</h1>
          <p className="text-gray-500 text-sm">This guide hasn&apos;t been published yet.</p>
        </div>
      </div>
    );
  }

  const completed = Object.values(progress).filter(Boolean).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <EduTubersLogo size={22} />
            <span className="text-sm font-semibold text-gray-700">EduTubers</span>
          </div>
          <Link href={`/course/${id}/feedback`} className="text-xs text-gray-500 hover:text-blue-600">Leave Feedback</Link>
        </div>
      </header>

      <div className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 py-10">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="inline-flex px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full font-medium capitalize">{course.learnerLevel}</span>
            <span className="inline-flex px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded-full font-medium">{course.modules.length} modules</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{cleanTitle(course.title)}</h1>
          <p className="text-gray-500 leading-relaxed mb-4">{course.description}</p>
          {course.learningGoals.length > 0 && (
            <ul className="space-y-1">
              {course.learningGoals.map((g, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                  <CheckCircle size={14} className="text-green-500 flex-shrink-0 mt-0.5" /> {g}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-4">
        <ProgressBar value={completed} max={course.modules.length} label={`${completed} of ${course.modules.length} modules completed`} />
      </div>

      <div className="max-w-3xl mx-auto px-4 pb-12">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Modules</h2>
        <div className="space-y-3">
          {course.modules.map((mod, i) => {
            const done = progress[mod.id];
            return (
              <div key={mod.id} className={`bg-white rounded-xl border p-4 flex items-start gap-4 ${done ? 'border-green-200' : 'border-gray-200'}`}>
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${done ? 'bg-green-500 text-white' : 'bg-blue-100 text-blue-700'}`}>
                  {done ? <CheckCircle size={15} /> : i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900">{mod.title}</p>
                  {mod.objective && <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{mod.objective}</p>}
                  <div className="flex gap-3 mt-2 text-xs text-gray-400">
                    <span>{mod.flashcards.length} cards</span>
                    <span>{mod.quizQuestions.length} quiz Qs</span>
                    <span>{mod.practiceTasks.length} tasks</span>
                  </div>
                </div>
                <Link href={`/course/${id}/module/${mod.id}`}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 flex-shrink-0">
                  {done ? 'Review' : 'Start'} <ChevronRight size={12} />
                </Link>
              </div>
            );
          })}
        </div>

        {course.finalProject.title && (
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-5 mt-4">
            <h3 className="font-semibold text-purple-900 mb-1">🎯 Final Project: {course.finalProject.title}</h3>
            <p className="text-sm text-purple-700 leading-relaxed">{course.finalProject.description}</p>
          </div>
        )}
        <div className="mt-6">
          <Link href={`/course/${id}/feedback`} className="inline-flex items-center gap-1.5 px-4 py-2 border border-gray-200 bg-white text-sm text-gray-600 rounded-lg hover:bg-gray-50">Leave Feedback</Link>
        </div>
      </div>
    </div>
  );
}

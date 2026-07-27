'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { dbGetCourses } from '@/lib/db';
import { CONTENT_TYPES } from '@/lib/types';
import type { Course } from '@/lib/types';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { Zap } from 'lucide-react';

export default function Dashboard() {
  const router = useRouter();
  const ready = useAuthGuard();
  const [courses, setCourses] = useState<Course[]>([]);

  useEffect(() => {
    if (!ready) return;
    dbGetCourses().then(setCourses);
  }, [ready]);

  if (!ready) return null;

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">Your content assets.</p>
      </div>

      {courses.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
            <Zap size={24} className="text-blue-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">No content assets yet</h2>
          <p className="text-sm text-gray-500 max-w-md mx-auto mb-6">Upload your content and generate flashcard decks, quizzes, interactive challenges, content guides, and illustrated explainers.</p>
          <button
            onClick={() => router.push('/generate')}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Zap size={14} /> Start Creating
          </button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {CONTENT_TYPES.map(type => {
            const count = courses.filter(c => c.contentType === type.id).length;
            return (
              <button
                key={type.id}
                onClick={() => router.push(`/dashboard/${type.id}`)}
                className="text-left bg-white rounded-xl border border-gray-200 p-5 hover:border-gray-300 hover:shadow-md transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between mb-3">
                  <span className="text-2xl">{type.emoji}</span>
                  <span className="text-3xl font-bold text-gray-900">{count}</span>
                </div>
                <p className="font-semibold text-sm text-gray-900">{type.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{count === 1 ? '1 asset created' : `${count} assets created`}</p>
              </button>
            );
          })}
        </div>
      )}
    </Layout>
  );
}

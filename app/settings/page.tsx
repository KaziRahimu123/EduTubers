'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, Sun, ArrowLeft } from 'lucide-react';
import Layout from '@/components/Layout';
import { useAuthGuard } from '@/lib/useAuthGuard';

export default function SettingsPage() {
  const router = useRouter();
  const ready = useAuthGuard();
  const [saved, setSaved] = useState(false);

  if (!ready) return null;

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <Layout>
      <div className="max-w-xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
          >
            <ArrowLeft size={17} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900 leading-none">Settings</h1>
            <p className="text-xs text-gray-500 mt-0.5">App appearance and preferences.</p>
          </div>
        </div>

        {/* ── App Appearance ───────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4 shadow-sm">
          <h2 className="font-semibold text-gray-900 text-sm mb-1">App Appearance</h2>
          <p className="text-xs text-gray-500 mb-4">EduTubers is set to clean Light Mode theme.</p>
          <div className="max-w-xs">
            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-blue-500 bg-blue-50 text-blue-700 text-sm font-medium"
            >
              <Sun size={18} />
              Light Theme (Default)
            </button>
          </div>
          {saved && (
            <div className="flex items-center gap-2 text-sm text-green-700 mt-3">
              <CheckCircle size={13} /> Appearance preferences saved.
            </div>
          )}
        </div>

        {/* Done */}
        <button
          onClick={() => router.back()}
          className="w-full py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-700 transition-colors"
        >
          Done
        </button>

      </div>
    </Layout>
  );
}

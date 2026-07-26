'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, Sun, Moon, Monitor, ArrowLeft } from 'lucide-react';
import Layout from '@/components/Layout';
import { useTheme } from '@/components/ThemeProvider';
import type { Theme } from '@/lib/auth';
import { useAuthGuard } from '@/lib/useAuthGuard';
import clsx from 'clsx';

const THEMES: { id: Theme; label: string; Icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { id: 'light',  label: 'Light',  Icon: Sun },
  { id: 'dark',   label: 'Dark',   Icon: Moon },
  { id: 'system', label: 'System', Icon: Monitor },
];

export default function SettingsPage() {
  const router = useRouter();
  const ready = useAuthGuard();
  const { theme, setTheme } = useTheme();
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
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-700 transition-colors"
          >
            <ArrowLeft size={17} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white leading-none">Settings</h1>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">App appearance and account preferences.</p>
          </div>
        </div>

        {/* ── App Appearance ───────────────────────────────────────────── */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-600 p-5 mb-4">
          <h2 className="font-semibold text-gray-900 dark:text-white text-sm mb-1">App Appearance</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">Controls the app screen only. Does not affect your creator brand themes.</p>
          <div className="grid grid-cols-3 gap-2">
            {THEMES.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => { setTheme(id); handleSave(); }}
                className={clsx(
                  'flex flex-col items-center gap-2 py-3.5 rounded-xl border-2 text-sm font-medium transition-all',
                  theme === id
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                    : 'border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-400 hover:border-gray-300 dark:hover:border-slate-500 hover:bg-gray-50 dark:hover:bg-slate-700',
                )}
              >
                <Icon size={18} />
                {label}
              </button>
            ))}
          </div>
          {saved && (
            <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 mt-3">
              <CheckCircle size={13} /> Appearance saved.
            </div>
          )}
        </div>

        {/* Done */}
        <button
          onClick={() => router.back()}
          className="w-full py-2.5 bg-gray-900 dark:bg-slate-200 text-white dark:text-slate-900 text-sm font-semibold rounded-xl hover:bg-gray-700 dark:hover:bg-white transition-colors"
        >
          Done
        </button>

      </div>
    </Layout>
  );
}

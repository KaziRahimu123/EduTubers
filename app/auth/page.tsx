'use client';

import { Zap, Video, Download, CheckCircle } from 'lucide-react';
import EduTubersLogo, { EduTubersWordmark } from '@/components/EduTubersLogo';

const features = [
  { icon: Video,    text: 'Upload video, PDF, or paste a transcript' },
  { icon: Zap,      text: 'AI generates flashcard decks, quizzes, practice tasks, content guides & visual explainers' },
  { icon: Download, text: 'Publish with a shareable link' },
];

const pills = ['Flashcard Decks', 'Interactive Quizzes', 'Practice Tasks', 'Downloadable Content Guide', 'Visual Explainer'];

export default function AuthPage() {
  return (
    <div className="min-h-screen flex">

      {/* ── Left panel ───────────────────────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[55%] flex-col justify-between bg-blue-600 p-12 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-blue-500/50" />
        <div className="absolute bottom-20 -left-20 w-64 h-64 rounded-full bg-blue-700/60" />
        <div className="absolute top-1/2 right-8 w-40 h-40 rounded-full bg-blue-400/30" />

        <div className="relative z-10 inline-flex items-center gap-2.5">
          <EduTubersLogo size={36} />
          <span className="text-xl font-bold text-white">EduTubers</span>
        </div>

        <div className="relative z-10 flex-1 flex flex-col justify-center py-12">
          <div className="inline-flex items-center gap-2 bg-white/15 text-white/90 text-xs font-semibold px-3 py-1.5 rounded-full mb-6 w-fit">
            <Zap size={11} /> Turn educational content into active learning
          </div>
          <h1 className="text-4xl xl:text-5xl font-bold text-white leading-tight mb-4">
            Your content.<br />
            <span className="text-blue-200">Instantly</span><br />
            made learnable.
          </h1>
          <p className="text-blue-100 text-sm leading-relaxed mb-8 max-w-sm">
            Paste a transcript, upload a video, or drop a PDF — EduTubers builds
            flashcard decks, quizzes, practice tasks, content guides, and visual explainers in seconds.
          </p>
          <div className="space-y-3 mb-8">
            {features.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-white/15 flex items-center justify-center flex-shrink-0">
                  <Icon size={14} className="text-white" />
                </div>
                <span className="text-sm text-blue-100">{text}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {pills.map(p => (
              <span key={p} className="inline-flex items-center gap-1 px-3 py-1 bg-white/15 text-white text-xs font-medium rounded-full">
                <CheckCircle size={10} /> {p}
              </span>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-blue-200/70 text-xs">© EduTubers</p>
      </div>

      {/* ── Right panel ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 dark:bg-slate-900 px-6 py-12">

        <div className="mb-8 lg:hidden">
          <EduTubersWordmark iconSize={26} className="text-base" />
        </div>

        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Get started</h2>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Sign in to create and save your study materials.
            </p>
          </div>

          <div className="space-y-3">
            {/* Google */}
            <a
              href="/auth/login?connection=google-oauth2"
              className="flex items-center justify-center gap-3 w-full px-4 py-3 bg-white border border-gray-200 dark:border-slate-600 dark:bg-slate-800 text-gray-700 dark:text-white text-sm font-medium rounded-xl hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
            >
              <svg width="18" height="18" viewBox="0 0 18 18">
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"/>
                <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
              </svg>
              Continue with Google
            </a>

            {/* GitHub */}
            <a
              href="/auth/login?connection=github"
              className="flex items-center justify-center gap-3 w-full px-4 py-3 bg-gray-900 dark:bg-slate-700 text-white text-sm font-medium rounded-xl hover:bg-gray-800 dark:hover:bg-slate-600 transition-colors shadow-sm"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.303 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.298 24 12c0-6.63-5.37-12-12-12z"/>
              </svg>
              Continue with GitHub
            </a>

            {/* Divider */}
            <div className="flex items-center gap-3 my-2">
              <div className="flex-1 h-px bg-gray-200 dark:bg-slate-700" />
              <span className="text-xs text-gray-400 dark:text-slate-500">or</span>
              <div className="flex-1 h-px bg-gray-200 dark:bg-slate-700" />
            </div>

            {/* Email / password via Auth0 universal login */}
            <a
              href="/auth/login"
              className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm shadow-blue-600/30"
            >
              Sign in with Email
            </a>
          </div>

          <p className="text-xs text-center text-gray-400 dark:text-slate-500 mt-6">
            New to EduTubers? Just sign in — your account is created automatically.
          </p>

          {/* Mobile pills */}
          <div className="mt-8 pt-6 border-t border-gray-100 dark:border-slate-800 lg:hidden">
            <div className="flex flex-wrap gap-1.5 justify-center">
              {pills.map(p => (
                <span key={p} className="px-2.5 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-medium rounded-full">
                  {p}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import Link from 'next/link';
import { Zap, BookOpen, CheckSquare, FileText, Layout, ArrowRight, Star, PlayCircle, Mic, Newspaper, GraduationCap } from 'lucide-react';
import EduTubersLogo from '@/components/EduTubersLogo';
import Nav from '@/components/Nav';

const OUTPUT_TYPES = [
  {
    icon: BookOpen,
    label: 'Flashcard Decks',
    desc: 'Auto-generated flashcard decks from your video or transcript — ready for your audience to explore and engage with key ideas.',
    color: 'text-rose-600',
    bg: 'bg-rose-50',
  },
  {
    icon: CheckSquare,
    label: 'Audience Quizzes',
    desc: 'Multiple-choice, true/false, and multiple-select quizzes with scoring, explanations, and instant feedback tied to your content.',
    color: 'text-orange-600',
    bg: 'bg-orange-50',
  },
  {
    icon: Layout,
    label: 'Interactive Challenges',
    desc: 'Applied challenges tailored to your content — coding exercises, scenario walkthroughs, decision tasks, and reflection prompts.',
    color: 'text-purple-600',
    bg: 'bg-purple-50',
  },
  {
    icon: FileText,
    label: 'Content Guide',
    desc: 'A printable, exportable content guide combining notes, key takeaways, definitions, and discussion prompts from your content.',
    color: 'text-green-600',
    bg: 'bg-green-50',
  },
  {
    icon: Star,
    label: 'Illustrated Explainer',
    desc: 'AI-illustrated explainer — section-by-section visual summaries that bring your content to life for your audience.',
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
  },
];

const CREATOR_TYPES = [
  { icon: PlayCircle,   label: 'YouTubers',            desc: 'Turn your videos into flashcard decks, quizzes, and content guides your viewers actually use.' },
  { icon: Mic,          label: 'Podcasters',            desc: 'Convert episodes into flashcard decks, interactive challenges, and content guides.' },
  { icon: Newspaper,    label: 'Newsletter Writers',    desc: 'Turn issues into audience quizzes and content guides that deepen audience engagement.' },
  { icon: GraduationCap, label: 'Educators & Coaches', desc: 'Build downloadable audience content from your lessons, lectures, and course content.' },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-950">
      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <Nav />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="max-w-4xl mx-auto px-4 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-semibold px-3 py-1 rounded-full mb-6">
          <Zap size={12} /> Turn your content into interactive audience experiences
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold text-gray-900 dark:text-white leading-tight mb-4">
          Your content.<br /><span className="text-blue-600">Instantly made interactive.</span>
        </h1>
        <p className="text-lg text-gray-500 dark:text-slate-400 max-w-2xl mx-auto mb-8">
          Paste a transcript, upload a video, or drop a PDF — EduTubers builds flashcard decks, audience quizzes, interactive challenges, content guides, and illustrated explainers in seconds.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/generate" className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors">
            <Zap size={16} /> Start for Free
          </Link>
          <Link href="/dashboard" className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 font-semibold rounded-lg border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors">
            View Dashboard <ArrowRight size={14} />
          </Link>
        </div>
        <p className="text-xs text-gray-400 dark:text-slate-500 mt-4">Works for YouTubers, podcasters, newsletter writers, educators, coaches, and more.</p>
      </section>

      {/* ── 5 Output Types ───────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-center text-gray-900 dark:text-white mb-3">5 audience-ready content formats — from any content</h2>
        <p className="text-center text-gray-500 dark:text-slate-400 text-sm mb-10">Generated from your video, podcast, article, or transcript. Editable before publishing.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {OUTPUT_TYPES.map(({ icon: Icon, label, desc, color, bg }) => (
            <div key={label} className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
              <div className={`w-10 h-10 rounded-lg ${bg} dark:bg-opacity-20 flex items-center justify-center mb-3`}>
                <Icon size={18} className={color} />
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-1">{label}</h3>
              <p className="text-sm text-gray-500 dark:text-slate-400 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section className="bg-gray-50 dark:bg-slate-900 border-y border-gray-100 dark:border-slate-800 py-16">
        <div className="max-w-4xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center text-gray-900 dark:text-white mb-10">How it works</h2>
          <div className="grid sm:grid-cols-4 gap-6">
            {[
              { step: '1', label: 'Upload your content', desc: 'Paste a transcript, upload a PDF, or drop an audio / video file up to 100 MB.' },
              { step: '2', label: 'IBM Granite 3.0 + GPT Pipeline', desc: 'IBM Granite 3.0 analyzes 100% of your video or PDF across a 128K context window, passing a complete topic blueprint to GPT for best-in-class asset generation.' },
              { step: '3', label: 'Get 5 content formats', desc: 'Flashcard decks, quizzes, interactive challenges, content guides, and illustrated explainers — all in one click.' },
              { step: '4', label: 'Share with your audience', desc: 'Every asset is editable and published with its own shareable link.' },
            ].map(({ step, label, desc }) => (
              <div key={step} className="text-center">
                <div className="w-10 h-10 rounded-full bg-blue-600 text-white font-bold text-lg flex items-center justify-center mx-auto mb-3">{step}</div>
                <h3 className="font-semibold text-gray-900 dark:text-white text-sm mb-1">{label}</h3>
                <p className="text-xs text-gray-500 dark:text-slate-400 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Creator types ─────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-center text-gray-900 dark:text-white mb-2">Built for content creators</h2>
        <p className="text-center text-gray-500 dark:text-slate-400 text-sm mb-10">Anyone who teaches, explains, or informs — EduTubers turns your content into interactive audience experiences.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {CREATOR_TYPES.map(({ icon: Icon, label, desc }) => (
            <div key={label} className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-5 text-center">
              <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center mx-auto mb-2">
                <Icon size={20} className="text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-1 text-sm">{label}</h3>
              <p className="text-xs text-gray-500 dark:text-slate-400 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section className="bg-blue-50 dark:bg-blue-900/20 border-y border-blue-100 dark:border-blue-900/40 py-16">
        <div className="max-w-3xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center text-gray-900 dark:text-white mb-8">Everything you need</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
                'Upload text, PDF, audio, or video (up to 100 MB)',
                'Auto-transcription for audio and video files',
                'Flashcard decks with front/back and image support',
                'Scored quizzes with explanations and retry options',
                'Interactive challenges tailored to your content',
                'Content guide for every generation',
                'AI-illustrated explainers with section images',
                'Each asset published with its own shareable link',
                'Dark mode, light mode, and system appearance',
              ].map(item => (
              <div key={item} className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                <div className="w-4 h-4 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 4L3 5.5L6.5 2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section className="bg-blue-600 py-16">
        <div className="max-w-xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold text-white mb-3">Turn your content into an audience experience</h2>
          <p className="text-blue-100 mb-6 text-sm">Upload your content and generate flashcard decks, quizzes, interactive challenges, content guides, and illustrated explainers in under 60 seconds.</p>
          <Link href="/generate" className="inline-flex items-center gap-2 px-6 py-3 bg-white text-blue-700 font-semibold rounded-lg hover:bg-blue-50 transition-colors">
            <Zap size={16} /> Get Started Free
          </Link>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-100 dark:border-slate-800 py-6">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-gray-400 dark:text-slate-500">
          <div className="flex items-center gap-2">
            <EduTubersLogo size={18} />
            <span>EduTubers</span>
          </div>
          <div className="flex gap-4">
            <Link href="/dashboard" className="hover:text-gray-600 dark:hover:text-slate-300">Dashboard</Link>
            <Link href="/generate" className="hover:text-gray-600 dark:hover:text-slate-300">Create</Link>
            <Link href="/settings" className="hover:text-gray-600 dark:hover:text-slate-300">Settings</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

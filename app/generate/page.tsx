'use client';

import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { getSessionAsync } from '@/lib/auth';
import { dbGetGenUsed3Days, dbMakeSlug } from '@/lib/db';
import type {
  ContentType, GeneratorOptions, FlashcardDeckOptions,
  QuizConfig, PracticeTaskConfig, QuestionType, QuizFeedbackSettings,
  LearnerLevel, TaskDifficulty,
} from '@/lib/types';
import {
  CONTENT_TYPES, GENERATION_LIMIT_PER_3_DAYS,
} from '@/lib/types';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { Zap, Upload, FileText, Mic, Video, X, ChevronDown, ChevronUp } from 'lucide-react';

const MAX_FILE_MB = 100;
const MAX_MEDIA_MB = 100; // server chunks large files for Whisper

const DEFAULT_TASK_CONFIG: PracticeTaskConfig = {
  taskCount: 'ai', learnerLevel: 'beginner', difficulty: 'mixed',
  includeHints: true, showAnswerTiming: 'after_submission', showAnswers: true,
};

const TASK_COUNTS = [4, 6, 8, 10, 15] as const;

const DEFAULT_QUIZ_CONFIG: QuizConfig = {
  quizTitle: '', targetAudience: 'beginner', questionCount: 'ai',
  questionTypes: ['multiple_choice', 'true_false'],
  difficulty: 'medium', passingScore: 70, attemptsAllowed: 'unlimited',
  shuffleQuestions: true, shuffleChoices: true,
  feedbackSettings: {
    showAnswerTiming: 'after_submission', showExplanations: true,
    allowRetryIncorrect: false, showFinalScore: true, showAnswerReview: true,
    answersPublished: true,
  },
};

const QUESTION_COUNTS = [5, 10, 15, 20] as const;
const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  multiple_choice: 'Multiple Choice',
  true_false:      'True / False',
  multiple_select: 'Multiple Select',
};

function Toggle({ on, onToggle, disabled }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${on ? 'bg-blue-600' : 'bg-gray-200 dark:bg-slate-600'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : 'translate-x-1'}`} />
    </button>
  );
}

type InputMode = 'text' | 'pdf' | 'audio' | 'video';
type MediaStatus = 'idle' | 'uploading' | 'transcribing' | 'done' | 'error';

export default function Generator() {
  const router = useRouter();
  const ready = useAuthGuard();
  const fileRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<HTMLInputElement>(null);
  const [contentType, setContentType] = useState<ContentType | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>('text');
  const [transcript, setTranscript] = useState('');
  const [supplemental, setSupplemental] = useState('');
  const [showSupplemental, setShowSupplemental] = useState(false);

  // File state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfError, setPdfError] = useState('');
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaStatus, setMediaStatus] = useState<MediaStatus>('idle');
  const [mediaError, setMediaError] = useState('');

  // Options
  const [options, setOptions] = useState<Omit<GeneratorOptions, 'contentType'>>({
    learnerLevel: 'beginner',
    quizDifficulty: 'medium',
    tone: 'friendly',
    flashcardCount: 0,
    flashcardImages: false,
  });

  const [fcOptions, setFcOptions] = useState<FlashcardDeckOptions>({
    cardCount: 'ai', colorful: false, includeImages: false,
  });

  const [quizConfig, setQuizConfig] = useState<QuizConfig>(DEFAULT_QUIZ_CONFIG);
  const [showFeedbackPanel, setShowFeedbackPanel] = useState(false);
  const [customCount, setCustomCount] = useState(false);

  const [taskConfig, setTaskConfig] = useState<PracticeTaskConfig>(DEFAULT_TASK_CONFIG);
  const [customTaskCount, setCustomTaskCount] = useState(false);

  const [generateImages, setGenerateImages] = useState(false);

  const [userId, setUserId]   = useState<string | null>(null);
  const [genUsed, setGenUsed] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [error, setError]               = useState('');
  const [dragOver, setDragOver]         = useState(false);

  useEffect(() => {
    if (!ready) return;
    getSessionAsync().then(session => {
      if (session) {
        setUserId(session.id);
        dbGetGenUsed3Days().then(setGenUsed);
      }
    });

    // Re-fetch quota whenever the tab regains focus (e.g. after navigating back)
    function onFocus() { dbGetGenUsed3Days().then(setGenUsed); }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [ready]);

  // ── Drag-and-drop helpers ────────────────────────────────────────────────

  function onDragOver(e: React.DragEvent) { e.preventDefault(); setDragOver(true); }
  function onDragLeave(e: React.DragEvent) { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }
  function onDragEnd() { setDragOver(false); }

  async function handleFileDropped(file: File) {
    setDragOver(false);
    if (inputMode === 'pdf') {
      // Synthesise a ChangeEvent-like object the existing handler can consume
      const dt = new DataTransfer();
      dt.items.add(file);
      const fakeInput = document.createElement('input');
      fakeInput.type = 'file';
      Object.defineProperty(fakeInput, 'files', { value: dt.files });
      await handlePdfUpload({ target: fakeInput } as unknown as ChangeEvent<HTMLInputElement>);
    } else {
      // audio / video — same approach
      const dt = new DataTransfer();
      dt.items.add(file);
      const fakeInput = document.createElement('input');
      fakeInput.type = 'file';
      Object.defineProperty(fakeInput, 'files', { value: dt.files });
      await handleMediaUpload({ target: fakeInput } as unknown as ChangeEvent<HTMLInputElement>);
    }
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    // Auto-switch mode based on dropped file type
    if (file.type === 'application/pdf') {
      setInputMode('pdf');
    } else if (file.type.startsWith('video/')) {
      setInputMode('video');
    } else if (file.type.startsWith('audio/')) {
      setInputMode('audio');
    }

    await handleFileDropped(file);
  }

  // ── File upload handlers ─────────────────────────────────────────────────

  async function handlePdfUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset all previous PDF state before starting
    setPdfError('');
    setPdfPageCount(null);
    setTranscript('');
    setPdfFile(null);

    if (file.type !== 'application/pdf') { setPdfError('Only PDF files accepted.'); return; }
    if (file.size > MAX_FILE_MB * 1024 * 1024) { setPdfError(`File too large. Max ${MAX_FILE_MB} MB.`); return; }

    setPdfFile(file);
    setMediaStatus('uploading');

    try {
      // Read the file into an ArrayBuffer — done before any async PDF work
      const arrayBuffer = await file.arrayBuffer();

      // Dynamically import pdfjs-dist so it only runs in the browser,
      // never during SSR where DOMMatrix / DOMRect don't exist.
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

      // Load the PDF document using pdfjs-dist in the browser
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
      const pdf = await loadingTask.promise;
      const numPages = pdf.numPages;
      setPdfPageCount(numPages);

      // Extract text from every page
      let extractedText = '';
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        extractedText += `\n\nPage ${pageNum}\n${pageText}`;
      }

      const trimmed = extractedText.trim();

      if (!trimmed) {
        // PDF opened fine but has no selectable text — likely scanned
        setPdfError('No selectable text detected in this PDF. OCR is required to extract text from scanned documents. Please paste the text manually.');
        setPdfFile(null);
        setMediaStatus('error');
        return;
      }

      setTranscript(trimmed);
      setMediaStatus('done');
    } catch (error: unknown) {
      console.error('PDF extraction error:', error);
      const msg = error instanceof Error ? error.message : 'Failed to extract text from PDF.';
      // Distinguish password-protected PDFs
      const friendly = msg.includes('password')
        ? 'This PDF is password-protected. Please remove the password and try again.'
        : msg.includes('Invalid PDF')
        ? 'This file does not appear to be a valid PDF.'
        : msg;
      setPdfError(friendly);
      setPdfFile(null);
      setMediaStatus('error');
    }
  }

  async function handleMediaUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Clear any previous error/result immediately, but don't touch mediaStatus
    // yet — setting it to 'idle' here would overwrite a concurrent upload's state.
    setMediaError('');
    setTranscript('');

    if (file.size > MAX_MEDIA_MB * 1024 * 1024) {
      setMediaError(`File too large. Max ${MAX_MEDIA_MB} MB allowed.`);
      return;
    }

    // Mirror the server's ALLOWED_MIME_TYPES set so the client never rejects a
    // type the server would accept (was the primary cause of the first-attempt
    // failure — e.g. audio/wav, audio/webm, video/webm were server-allowed but
    // client-blocked, leading to an immediate error that looked like a server fault).
    const allowedAudio = new Set([
      'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm',
      'audio/ogg', 'audio/flac', 'audio/x-flac',
    ]);
    const allowedVideo = new Set([
      'video/mp4', 'video/quicktime', 'video/webm',
      'video/mpeg', 'video/x-msvideo',
    ]);
    const allowed = inputMode === 'audio' ? allowedAudio
                  : new Set([...allowedAudio, ...allowedVideo]);

    if (!allowed.has(file.type)) {
      setMediaError(
        `Unsupported file type. Accepted: ${
          inputMode === 'audio'
            ? 'MP3, WAV, OGG, FLAC, WebM audio'
            : 'MP4, MOV, WebM, MP3, WAV, OGG, FLAC'
        }`
      );
      return;
    }

    setMediaFile(file);
    setMediaStatus('transcribing');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
      const data = await res.json() as { transcript?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? 'Transcription failed.');
      setTranscript(data.transcript ?? '');
      setMediaStatus('done');
    } catch (err: unknown) {
      setMediaError(err instanceof Error ? err.message : 'Transcription failed. Try again.');
      setMediaFile(null);
      setMediaStatus('error');
    }
  }

  function clearMediaFile() {
    setMediaFile(null);
    setPdfFile(null);
    setPdfPageCount(null);
    setMediaStatus('idle');
    setMediaError('');
    setPdfError('');
    setTranscript('');
    if (mediaRef.current) mediaRef.current.value = '';
    if (fileRef.current) fileRef.current.value = '';
  }

  function toggleQuestionType(qt: QuestionType) {
    setQuizConfig(c => {
      const has = c.questionTypes.includes(qt);
      if (has && c.questionTypes.length === 1) return c;
      return {
        ...c,
        questionTypes: has ? c.questionTypes.filter(t => t !== qt) : [...c.questionTypes, qt],
      };
    });
  }

  function patchFeedback(patch: Partial<QuizFeedbackSettings>) {
    setQuizConfig(c => ({ ...c, feedbackSettings: { ...c.feedbackSettings, ...patch } }));
  }

  // ── Main generate handler ────────────────────────────────────────────────

  async function handleGenerate() {
    if (!contentType) { setError('Please select a content type first.'); return; }
    if (!transcript.trim()) { setError('Please add your content first (paste text, upload a PDF, or upload audio/video).'); return; }
    if (!userId) { setError('Please sign in to generate content assets.'); return; }
    if (genUsed >= GENERATION_LIMIT_PER_3_DAYS) {
      setError(`Limit reached (${GENERATION_LIMIT_PER_3_DAYS} per 3 days). Come back in a few days!`); return;
    }
    if (contentType === 'quiz' && quizConfig.questionTypes.length === 0) {
      setError('Select at least one question type.'); return;
    }
    setError(''); setGenerating(true);
    try {
      const session = await getSessionAsync();

      const resolvedCount = customCount
        ? (quizConfig.customQuestionCount ?? 10)
        : quizConfig.questionCount; // 'ai' passes through as-is

      const finalQuizConfig: QuizConfig = { ...quizConfig, questionCount: resolvedCount };

      const resolvedTaskCount = customTaskCount
        ? (taskConfig.customTaskCount ?? 8)
        : taskConfig.taskCount; // 'ai' passes through as-is

      const finalTaskConfig: PracticeTaskConfig = { ...taskConfig, taskCount: resolvedTaskCount };

      const genOptions: GeneratorOptions = {
        ...options,
        contentType,
        flashcardCount: contentType === 'review_cards' ? (fcOptions.cardCount === 'ai' ? 0 : fcOptions.cardCount) : 0,
        flashcardImages: contentType === 'review_cards' ? fcOptions.includeImages : false,
        quizConfig: contentType === 'quiz' ? finalQuizConfig : undefined,
        taskConfig: contentType === 'activities' ? finalTaskConfig : undefined,
      };

      // Pre-generate slug for content types that publish with a public URL.
      // The title isn't known yet so we pass a placeholder; the server will
      // overwrite with the real title once the AI returns it.
      let slug: string | undefined;
      if (contentType === 'review_cards' || contentType === 'quiz') {
        slug = await dbMakeSlug(contentType === 'quiz' ? (finalQuizConfig.quizTitle || '') : '');
      }

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          input: { transcript, supplemental, options: genOptions },
          tierId: 'standard',
          ...(contentType === 'review_cards' ? { flashcardOptions: fcOptions, slug, creatorUsername: session?.username ?? '' } : {}),
          ...(contentType === 'quiz'         ? { quizConfig: finalQuizConfig, slug, creatorUsername: session?.username ?? '' } : {}),
          ...(contentType === 'activities'   ? { taskConfig: finalTaskConfig, creatorUsername: session?.username ?? '' } : {}),
          ...(contentType === 'resource_page' || contentType === 'branded_guide' ? { generateImages } : {}),
        }),
      });

      const data = await res.json() as { course?: { id: string; title: string }; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? 'Generation failed.');
      if (!data.course) throw new Error('No result returned.');

      // Await so the counter updates before navigation (handles the case where
      // the user immediately presses Back and returns to this page).
      await dbGetGenUsed3Days().then(setGenUsed);

      router.push(
        contentType === 'resource_page'  ? `/visual-guide/${data.course.id}` :
        contentType === 'branded_guide'  ? `/pdf-pack/${data.course.id}` :
        contentType === 'quiz'           ? `/quiz/${data.course.id}/edit` :
        contentType === 'activities'     ? `/tasks/${data.course.id}/edit` :
        contentType === 'review_cards'   ? `/editor/${data.course.id}/flashcards` :
                                           `/editor/${data.course.id}`
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Generation failed. Try again.');
    } finally {
      setGenerating(false);
    }
  }

  const sel      = contentType ? CONTENT_TYPES.find(t => t.id === contentType) : null;
  const genRemain = Math.max(0, GENERATION_LIMIT_PER_3_DAYS - genUsed);

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-800 text-gray-900 dark:text-white';

  if (!ready) return null;

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Create learning assets</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Paste a transcript, upload a video, or drop a PDF — get flashcard decks, quizzes, practice tasks, content guides, and visual explainers in seconds.</p>
          </div>
          <span className={`flex-shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border ${
            genRemain === 0
              ? 'bg-red-50 border-red-200 text-red-600 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400'
              : genRemain <= 3
              ? 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-400'
              : 'bg-gray-50 border-gray-200 text-gray-500 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-400'
          }`}>
            {genUsed} / {GENERATION_LIMIT_PER_3_DAYS} used (3 days)
          </span>
        </div>

        {/* ── Step 1: Output Type ─────────────────────────────────────────── */}
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-200 mb-3">1. Choose your output type</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {CONTENT_TYPES.map(type => (
              <button
                key={type.id}
                onClick={() => setContentType(type.id)}
                className={`text-left p-4 rounded-xl border-2 transition-all ${
                  contentType === type.id
                    ? `${type.color} border-current`
                    : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-500 bg-white dark:bg-slate-800'
                }`}
              >
                <div className="text-xl mb-1">{type.emoji}</div>
                <div className="font-semibold text-sm mb-0.5">{type.label}</div>
                <div className={`text-xs leading-relaxed ${contentType === type.id ? 'opacity-80' : 'text-gray-500 dark:text-slate-400'}`}>{type.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Step 2: Upload / Paste Content ────────────────────────────── */}
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-200 mb-3">2. Add your content</h2>

          {/* Input mode selector */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {([
              { id: 'text',  icon: FileText, label: 'Paste Text' },
              { id: 'pdf',   icon: FileText, label: 'PDF' },
              { id: 'audio', icon: Mic,      label: 'Audio' },
              { id: 'video', icon: Video,    label: 'Video' },
            ] as const).map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => { setInputMode(id); clearMediaFile(); }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  inputMode === id
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800'
                }`}
              >
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>

          {/* Text input */}
          {inputMode === 'text' && (
            <textarea
              className={`${inp} resize-none`}
              rows={10}
              value={transcript}
              onChange={e => setTranscript(e.target.value)}
              placeholder="Paste your content here — article, newsletter, blog post, transcript, script, notes, etc."
            />
          )}

          {/* PDF upload */}
          {inputMode === 'pdf' && (
            <div className="space-y-3">
              {!pdfFile ? (
                <label
                  className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-8 cursor-pointer transition-colors ${
                    dragOver
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 scale-[1.01]'
                      : 'border-gray-200 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/10'
                  }`}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDragEnd={onDragEnd}
                  onDrop={onDrop}
                >
                  <Upload size={24} className={dragOver ? 'text-blue-500' : 'text-gray-400 dark:text-slate-500'} />
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-700 dark:text-slate-300">
                      {dragOver ? 'Drop to upload' : 'Drag & drop or click to upload PDF'}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">Max {MAX_FILE_MB} MB</p>
                  </div>
                  <input ref={fileRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={handlePdfUpload} />
                </label>
              ) : (
                <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl">
                  <FileText size={18} className="text-blue-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{pdfFile.name}</p>
                    {mediaStatus === 'uploading' && (
                      <p className="text-xs text-gray-500 dark:text-slate-400">Extracting text…</p>
                    )}
                    {mediaStatus === 'done' && pdfPageCount !== null && (
                      <p className="text-xs text-green-600 dark:text-green-400">
                        {pdfPageCount} page{pdfPageCount !== 1 ? 's' : ''} · {transcript.trim().split(/\s+/).filter(Boolean).length.toLocaleString()} words extracted ✓
                      </p>
                    )}
                  </div>
                  <button type="button" onClick={clearMediaFile} className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0">
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* Extracted text preview — editable so user can trim/correct before generation */}
              {mediaStatus === 'done' && transcript && (
                <div className="bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-3">
                  <p className="text-xs font-medium text-gray-600 dark:text-slate-400 mb-2">Extracted text preview (editable):</p>
                  <textarea
                    className={`${inp} resize-none text-xs`}
                    rows={6}
                    value={transcript}
                    onChange={e => setTranscript(e.target.value)}
                  />
                </div>
              )}

              {pdfError && <p className="text-xs text-red-600 dark:text-red-400">{pdfError}</p>}
            </div>
          )}

          {/* Audio/Video upload */}
          {(inputMode === 'audio' || inputMode === 'video') && (
            <div>
              {!mediaFile ? (
                <label
                  className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-8 cursor-pointer transition-colors ${
                    dragOver
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 scale-[1.01]'
                      : 'border-gray-200 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/10'
                  }`}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDragEnd={onDragEnd}
                  onDrop={onDrop}
                >
                  {inputMode === 'audio'
                    ? <Mic size={24} className={dragOver ? 'text-blue-500' : 'text-gray-400 dark:text-slate-500'} />
                    : <Video size={24} className={dragOver ? 'text-blue-500' : 'text-gray-400 dark:text-slate-500'} />}
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-700 dark:text-slate-300">
                      {dragOver ? 'Drop to upload' : `Drag & drop or click to upload ${inputMode === 'audio' ? 'Audio' : 'Video'}`}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
                      {inputMode === 'audio' ? 'MP3' : 'MP4, MOV'} · Max {MAX_MEDIA_MB} MB
                    </p>
                    <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">Auto-transcribed using AI before generation</p>
                  </div>
                  <input
                    ref={mediaRef}
                    type="file"
                    accept={inputMode === 'audio'
                      ? 'audio/mpeg,.mp3'
                      : 'video/mp4,video/quicktime,video/mpeg,audio/mpeg,.mp3'
                    }
                    className="hidden"
                    onChange={handleMediaUpload}
                  />
                </label>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl">
                    {inputMode === 'audio' ? <Mic size={18} className="text-blue-600 flex-shrink-0" /> : <Video size={18} className="text-blue-600 flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{mediaFile.name}</p>
                      {mediaStatus === 'transcribing' && <p className="text-xs text-blue-600 dark:text-blue-400">Transcribing with AI… this may take a moment</p>}
                      {mediaStatus === 'done' && <p className="text-xs text-green-600 dark:text-green-400">Transcription complete ✓</p>}
                      {mediaStatus === 'error' && <p className="text-xs text-red-600 dark:text-red-400">{mediaError}</p>}
                    </div>
                    <button type="button" onClick={clearMediaFile} className="text-gray-400 hover:text-red-500 transition-colors">
                      <X size={14} />
                    </button>
                  </div>
                  {mediaStatus === 'done' && transcript && (
                    <div className="bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-3">
                      <p className="text-xs font-medium text-gray-600 dark:text-slate-400 mb-2">Transcript preview:</p>
                      <p className="text-xs text-gray-500 dark:text-slate-500 leading-relaxed line-clamp-4">{transcript}</p>
                      <button
                        type="button"
                        onClick={() => setInputMode('text')}
                        className="mt-2 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium"
                      >
                        Edit transcript
                      </button>
                    </div>
                  )}
                </div>
              )}
              {mediaError && !mediaFile && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{mediaError}</p>}
            </div>
          )}

          {/* Supplemental context */}
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowSupplemental(s => !s)}
              className="flex items-center gap-1 text-xs text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 font-medium"
            >
              {showSupplemental ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              Add supplemental context (optional)
            </button>
            {showSupplemental && (
              <textarea
                className={`${inp} resize-none mt-2`}
                rows={3}
                value={supplemental}
                onChange={e => setSupplemental(e.target.value)}
                placeholder="Extra context, target audience info, key points to emphasize, etc."
              />
            )}
          </div>
        </div>

        {/* ── Step 3: Output-specific options ─────────────────────────────── */}
        {contentType && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-200 mb-3">3. Configure your asset</h2>

            {/* Flashcard Deck options */}
            {contentType === 'review_cards' && (
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-2">Number of Cards</label>
                  <div className="flex gap-2 flex-wrap">
                    <button type="button"
                      onClick={() => setFcOptions(o => ({ ...o, cardCount: 'ai' }))}
                      className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-all ${fcOptions.cardCount === 'ai' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-400 hover:border-gray-300'}`}
                    >✦ AI decides</button>
                    {[5, 10, 15, 20].map(n => (
                      <button key={n} type="button"
                        onClick={() => setFcOptions(o => ({ ...o, cardCount: n }))}
                        className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-all ${fcOptions.cardCount === n ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-400 hover:border-gray-300'}`}
                      >{n}</button>
                    ))}
                  </div>
                  {fcOptions.cardCount === 'ai' && (
                    <p className="mt-2 text-xs text-blue-600 dark:text-blue-400">AI will analyse the key topics and generate the right number of cards to cover them — no more, no less.</p>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-700 dark:text-slate-300">Colorful card theme</p>
                    <p className="text-xs text-gray-400 dark:text-slate-500">Display cards with color accents</p>
                  </div>
                  <Toggle on={fcOptions.colorful} onToggle={() => setFcOptions(o => ({ ...o, colorful: !o.colorful }))} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-700 dark:text-slate-300">Include images on cards</p>
                    <p className="text-xs text-gray-400 dark:text-slate-500">AI-generated image per card</p>
                  </div>
                  <Toggle on={fcOptions.includeImages} onToggle={() => setFcOptions(o => ({ ...o, includeImages: !o.includeImages }))} />
                </div>
              </div>
            )}

            {/* Interactive Quizzes options */}
            {contentType === 'quiz' && (
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1">Quiz Title (optional — AI generates if blank)</label>
                  <input className={inp} value={quizConfig.quizTitle}
                    onChange={e => setQuizConfig(c => ({ ...c, quizTitle: e.target.value }))}
                    placeholder="AI will generate a title from the content" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1">Target Audience</label>
                  <select className={inp} value={quizConfig.targetAudience}
                    onChange={e => setQuizConfig(c => ({ ...c, targetAudience: e.target.value as LearnerLevel }))}>
                    {(['beginner', 'intermediate', 'advanced'] as const).map(v => (
                      <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1">Difficulty</label>
                  <select className={inp} value={quizConfig.difficulty}
                    onChange={e => setQuizConfig(c => ({ ...c, difficulty: e.target.value as typeof quizConfig.difficulty }))}>
                    {(['easy', 'medium', 'hard', 'mixed'] as const).map(v => (
                      <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-2">Question Types</label>
                  <div className="flex flex-wrap gap-2">
                    {(['multiple_choice', 'true_false', 'multiple_select'] as QuestionType[]).map(qt => (
                      <button
                        key={qt}
                        type="button"
                        onClick={() => toggleQuestionType(qt)}
                        className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-all ${
                          quizConfig.questionTypes.includes(qt)
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-400 hover:border-gray-300 dark:hover:border-slate-500'
                        }`}
                      >{QUESTION_TYPE_LABELS[qt]}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-2">Number of Questions</label>
                  <div className="flex gap-2 flex-wrap">
                    <button type="button"
                      onClick={() => { setCustomCount(false); setQuizConfig(c => ({ ...c, questionCount: 'ai' })); }}
                      className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-all ${!customCount && quizConfig.questionCount === 'ai' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-400 hover:border-gray-300 dark:hover:border-slate-500'}`}
                    >✦ AI decides</button>
                    {QUESTION_COUNTS.map(n => (
                      <button key={n} type="button"
                        onClick={() => { setCustomCount(false); setQuizConfig(c => ({ ...c, questionCount: n })); }}
                        className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-all ${!customCount && quizConfig.questionCount === n ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-400 hover:border-gray-300 dark:hover:border-slate-500'}`}
                      >{n}</button>
                    ))}
                    <button type="button"
                      onClick={() => { setCustomCount(true); setQuizConfig(c => ({ ...c, questionCount: 'custom' })); }}
                      className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-all ${customCount ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-400'}`}
                    >Custom</button>
                  </div>
                  {!customCount && quizConfig.questionCount === 'ai' && (
                    <p className="mt-2 text-xs text-blue-600 dark:text-blue-400">AI will analyse the key topics and generate one question per distinct concept — ensuring full coverage without padding.</p>
                  )}
                  {customCount && (
                    <input type="number" min={1} max={50} className={`${inp} mt-2 max-w-[120px]`}
                      value={quizConfig.customQuestionCount ?? ''}
                      onChange={e => setQuizConfig(c => ({ ...c, customQuestionCount: Math.min(50, Math.max(1, parseInt(e.target.value) || 1)) }))}
                      placeholder="Count" />
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1">Passing Score (%)</label>
                  <input type="number" min={1} max={100} className={inp}
                    value={quizConfig.passingScore}
                    onChange={e => setQuizConfig(c => ({ ...c, passingScore: Math.min(100, Math.max(1, parseInt(e.target.value) || 70)) }))} />
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-gray-700 dark:text-slate-300">Shuffle questions</p>
                  <Toggle on={quizConfig.shuffleQuestions} onToggle={() => setQuizConfig(c => ({ ...c, shuffleQuestions: !c.shuffleQuestions }))} />
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-gray-700 dark:text-slate-300">Shuffle answer choices</p>
                  <Toggle on={quizConfig.shuffleChoices} onToggle={() => setQuizConfig(c => ({ ...c, shuffleChoices: !c.shuffleChoices }))} />
                </div>
                {/* Feedback settings */}
                <div>
                  <button type="button" onClick={() => setShowFeedbackPanel(s => !s)}
                    className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 font-medium">
                    {showFeedbackPanel ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    Feedback settings
                  </button>
                  {showFeedbackPanel && (
                    <div className="mt-3 space-y-3 pl-2 border-l-2 border-blue-100 dark:border-blue-900/50">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-600 dark:text-slate-400">Show explanations after quiz</p>
                        <Toggle on={quizConfig.feedbackSettings.showExplanations} onToggle={() => patchFeedback({ showExplanations: !quizConfig.feedbackSettings.showExplanations })} />
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-600 dark:text-slate-400">Show final score</p>
                        <Toggle on={quizConfig.feedbackSettings.showFinalScore} onToggle={() => patchFeedback({ showFinalScore: !quizConfig.feedbackSettings.showFinalScore })} />
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-600 dark:text-slate-400">Allow retry on incorrect answers</p>
                        <Toggle on={quizConfig.feedbackSettings.allowRetryIncorrect} onToggle={() => patchFeedback({ allowRetryIncorrect: !quizConfig.feedbackSettings.allowRetryIncorrect })} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Practice Tasks options */}
            {contentType === 'activities' && (
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1">Target Audience</label>
                  <select className={inp} value={taskConfig.learnerLevel}
                    onChange={e => setTaskConfig(c => ({ ...c, learnerLevel: e.target.value as LearnerLevel }))}>
                    {(['beginner', 'intermediate', 'advanced'] as const).map(v => (
                      <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1">Difficulty</label>
                  <select className={inp} value={taskConfig.difficulty}
                    onChange={e => setTaskConfig(c => ({ ...c, difficulty: e.target.value as TaskDifficulty | 'mixed' }))}>
                    {(['beginner', 'intermediate', 'challenge', 'mixed'] as const).map(v => (
                      <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-2">Number of Activities</label>
                  <div className="flex gap-2 flex-wrap">
                    <button type="button"
                      onClick={() => { setCustomTaskCount(false); setTaskConfig(c => ({ ...c, taskCount: 'ai' })); }}
                      className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-all ${!customTaskCount && taskConfig.taskCount === 'ai' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-400 hover:border-gray-300 dark:hover:border-slate-500'}`}
                    >✦ AI decides</button>
                    {TASK_COUNTS.map(n => (
                      <button key={n} type="button"
                        onClick={() => { setCustomTaskCount(false); setTaskConfig(c => ({ ...c, taskCount: n })); }}
                        className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-all ${!customTaskCount && taskConfig.taskCount === n ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-400 hover:border-gray-300 dark:hover:border-slate-500'}`}
                      >{n}</button>
                    ))}
                    <button type="button"
                      onClick={() => { setCustomTaskCount(true); setTaskConfig(c => ({ ...c, taskCount: 'custom' })); }}
                      className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-all ${customTaskCount ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-400'}`}
                    >Custom</button>
                  </div>
                  {!customTaskCount && taskConfig.taskCount === 'ai' && (
                    <p className="mt-2 text-xs text-blue-600 dark:text-blue-400">AI will analyse the key topics and create one task per concept — covering everything without unnecessary padding.</p>
                  )}
                  {customTaskCount && (
                    <input type="number" min={1} max={30} className={`${inp} mt-2 max-w-[120px]`}
                      value={taskConfig.customTaskCount ?? ''}
                      onChange={e => setTaskConfig(c => ({ ...c, customTaskCount: Math.min(30, Math.max(1, parseInt(e.target.value) || 1)) }))}
                      placeholder="Count" />
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-700 dark:text-slate-300">Include hints</p>
                    <p className="text-xs text-gray-400 dark:text-slate-500">Subtle nudges without giving the answer</p>
                  </div>
                  <Toggle on={taskConfig.includeHints} onToggle={() => setTaskConfig(c => ({ ...c, includeHints: !c.includeHints }))} />
                </div>
              </div>
            )}

            {/* Downloadable Content Guide / Visual Explainer image option */}
            {(contentType === 'branded_guide' || contentType === 'resource_page') && (
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-slate-300">Generate images for this asset</p>
                    <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">AI-generated images with editable captions · Max 20 per 3 days</p>
                  </div>
                  <Toggle on={generateImages} onToggle={() => setGenerateImages(v => !v)} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Step 4: Tone ─────────────────────────────────────────────────── */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-200">4. Tone</h2>
          </div>
          <div className="flex gap-2 flex-wrap">
            {(['friendly', 'conversational', 'professional', 'academic'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setOptions(o => ({ ...o, tone: t }))}
                className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-all ${
                  options.tone === t
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-400 hover:border-gray-300 dark:hover:border-slate-500'
                }`}
              >{t.charAt(0).toUpperCase() + t.slice(1)}</button>
            ))}
          </div>
        </div>

        {/* ── Error ─────────────────────────────────────────────────────────── */}
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* ── Generate button ───────────────────────────────────────────────── */}
        <button
          onClick={handleGenerate}
          disabled={generating || mediaStatus === 'transcribing'}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors text-sm"
        >
          {generating ? (
            <>
              <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Generating your {sel?.label ?? 'asset'}…
            </>
          ) : mediaStatus === 'transcribing' ? (
            <>
              <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Transcribing…
            </>
          ) : (
            <><Zap size={15} /> Generate {sel?.label ?? 'Content Asset'}</>
          )}
        </button>


      </div>
    </Layout>
  );
}

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
import { Zap, Upload, FileText, Mic, Video, X, ChevronDown, ChevronUp, Layers } from 'lucide-react';

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_FILES       = 3;
const MAX_TOTAL_MB    = 100;
const MAX_TOTAL_BYTES = MAX_TOTAL_MB * 1024 * 1024;

const ALLOWED_AUDIO_TYPES = new Set([
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm',
  'audio/ogg', 'audio/flac', 'audio/x-flac',
]);
const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4', 'video/quicktime', 'video/webm',
  'video/mpeg', 'video/x-msvideo',
]);

const DEFAULT_TASK_CONFIG: PracticeTaskConfig = {
  taskCount: 'ai', learnerLevel: 'beginner', difficulty: 'mixed',
  includeHints: true, showAnswerTiming: 'after_submission', showAnswers: true,
};

const TASK_COUNTS = [4, 6, 8, 10, 15] as const;  // human-selectable preset counts (max custom = 15)

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

const QUESTION_COUNTS = [5, 10, 15, 20, 25] as const;
const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  multiple_choice: 'Multiple Choice',
  true_false:      'True / False',
  multiple_select: 'Multiple Select',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024)          return `${bytes} B`;
  if (bytes < 1024 * 1024)   return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileTypeLabel(mime: string): string {
  if (mime === 'application/pdf')        return 'PDF';
  if (mime.startsWith('audio/'))         return 'Audio';
  if (mime.startsWith('video/'))         return 'Video';
  return 'File';
}

function FileTypeIcon({ mime, size = 16 }: { mime: string; size?: number }) {
  if (mime === 'application/pdf')   return <FileText size={size} className="text-red-500 flex-shrink-0" />;
  if (mime.startsWith('audio/'))    return <Mic size={size} className="text-purple-500 flex-shrink-0" />;
  if (mime.startsWith('video/'))    return <Video size={size} className="text-blue-500 flex-shrink-0" />;
  return <FileText size={size} className="text-gray-400 flex-shrink-0" />;
}

// ── Sub-components ───────────────────────────────────────────────────────────

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

// ── Types ────────────────────────────────────────────────────────────────────

type FileStatus = 'idle' | 'processing' | 'done' | 'error';

interface UploadedFile {
  file: File;
  status: FileStatus;
  error: string;
  extractedText: string;
}

export default function Generator() {
  const router   = useRouter();
  const ready    = useAuthGuard();
  const dropRef  = useRef<HTMLInputElement>(null);

  const [contentType, setContentType] = useState<ContentType | null>(null);
  const [transcript,  setTranscript]  = useState('');
  const [supplemental, setSupplemental] = useState('');
  const [showSupplemental, setShowSupplemental] = useState(false);

  // ── Multi-file state ──────────────────────────────────────────────────────
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [fileError,     setFileError]     = useState('');
  const [dragOver,      setDragOver]      = useState(false);

  // ── Options ───────────────────────────────────────────────────────────────
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

  const [quizConfig,        setQuizConfig]        = useState<QuizConfig>(DEFAULT_QUIZ_CONFIG);
  const [showFeedbackPanel, setShowFeedbackPanel] = useState(false);
  const [customCount,       setCustomCount]       = useState(false);

  const [taskConfig,      setTaskConfig]      = useState<PracticeTaskConfig>(DEFAULT_TASK_CONFIG);
  const [customTaskCount, setCustomTaskCount] = useState(false);

  const [generateImages, setGenerateImages] = useState(false);

  const [userId,     setUserId]     = useState<string | null>(null);
  const [genUsed,    setGenUsed]    = useState(0);
  const [generating, setGenerating] = useState(false);
  const [error,      setError]      = useState('');

  // Whether any file is still being processed
  const isProcessing = uploadedFiles.some(f => f.status === 'processing');

  // ── Auth / quota ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!ready) return;
    getSessionAsync().then(session => {
      if (session) {
        setUserId(session.id);
        dbGetGenUsed3Days().then(setGenUsed);
      }
    });
    function onFocus() { dbGetGenUsed3Days().then(setGenUsed); }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [ready]);

  // ── Drag-and-drop ─────────────────────────────────────────────────────────

  function onDragOver(e: React.DragEvent) { e.preventDefault(); setDragOver(true); }
  function onDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
  }
  function onDragEnd() { setDragOver(false); }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) await addFiles(files);
  }

  // ── File validation & ingestion ───────────────────────────────────────────

  async function addFiles(incoming: File[]) {
    setFileError('');

    const existing     = uploadedFiles;
    const combined     = [...existing.map(u => u.file), ...incoming];
    const uniqueFiles  = combined.filter(
      (f, i, arr) => arr.findIndex(x => x.name === f.name && x.size === f.size) === i,
    );

    if (uniqueFiles.length > MAX_FILES) {
      setFileError(`Maximum ${MAX_FILES} files allowed. Remove a file before adding more.`);
      return;
    }

    const totalBytes = uniqueFiles.reduce((sum, f) => sum + f.size, 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      setFileError(`Combined file size exceeds ${MAX_TOTAL_MB} MB. Please use smaller files.`);
      return;
    }

    // Only process newly added files (not ones already in state)
    const newFiles = incoming.filter(
      f => !existing.some(u => u.file.name === f.name && u.file.size === f.size),
    );

    if (newFiles.length === 0) return;

    // Validate each new file's type
    for (const f of newFiles) {
      const ext = f.name.toLowerCase().split('.').pop() ?? '';
      const isKnownMediaExt = ['mov', 'mp4', 'webm', 'mp3', 'wav', 'flac', 'ogg', 'pdf'].includes(ext);
      const allowed =
        f.type === 'application/pdf' ||
        ALLOWED_AUDIO_TYPES.has(f.type) ||
        ALLOWED_VIDEO_TYPES.has(f.type) ||
        isKnownMediaExt;
      if (!allowed) {
        setFileError(`"${f.name}" is not a supported format. Accepted: PDF, MP4, MOV, WebM, MP3, WAV, FLAC.`);
        return;
      }
    }

    // Add all new files in 'processing' state before kicking off async work
    const newEntries: UploadedFile[] = newFiles.map(f => ({
      file: f, status: 'processing', error: '', extractedText: '',
    }));
    setUploadedFiles(prev => [...prev, ...newEntries]);

    // Process each new file independently & in parallel
    await Promise.all(newFiles.map(processFile));
  }

  async function processFile(file: File) {
    try {
      let text = '';

      if (file.type === 'application/pdf') {
        text = await extractPdf(file);
      } else {
        text = await transcribeMedia(file);
      }

      setUploadedFiles(prev =>
        prev.map(u =>
          u.file === file
            ? { ...u, status: 'done', extractedText: text }
            : u,
        ),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Processing failed.';
      setUploadedFiles(prev =>
        prev.map(u =>
          u.file === file
            ? { ...u, status: 'error', error: message }
            : u,
        ),
      );
    }
  }

  async function extractPdf(file: File): Promise<string> {
    // Run extraction client-side using pdfjs-dist (same as before)
    const arrayBuffer = await file.arrayBuffer();
    const pdfjsLib    = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

    const pdf      = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    let extracted  = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const page    = await pdf.getPage(p);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      extracted += `\n\nPage ${p}\n${pageText}`;
    }

    const trimmed = extracted.trim();
    if (!trimmed) {
      throw new Error(
        'No selectable text detected in this PDF. It may be scanned — please paste the text manually.',
      );
    }
    return trimmed;
  }

  async function extractAudioBlobFromMedia(file: File): Promise<Blob> {
    if (file.type.startsWith('audio/') && file.size <= 4 * 1024 * 1024) {
      return file;
    }
    return new Promise<Blob>(async (resolve) => {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return resolve(file);
        const audioCtx = new AudioCtx();

        let audioBuffer: AudioBuffer;
        try {
          audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        } catch {
          audioCtx.close();
          return resolve(file);
        }

        const targetSampleRate = 16000;
        const offlineCtx = new OfflineAudioContext(1, Math.ceil(audioBuffer.duration * targetSampleRate), targetSampleRate);
        const source = offlineCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineCtx.destination);
        source.start(0);

        const renderedBuffer = await offlineCtx.startRendering();
        audioCtx.close();

        const wavBlob = audioBufferToWavBlob(renderedBuffer);
        resolve(wavBlob);
      } catch {
        resolve(file);
      }
    });
  }

  function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
    const numOfChan = 1;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length * numOfChan * 2 + 44;
    const out = new DataView(new ArrayBuffer(length));
    const channel = buffer.getChannelData(0);

    function writeString(offset: number, str: string) {
      for (let i = 0; i < str.length; i++) {
        out.setUint8(offset + i, str.charCodeAt(i));
      }
    }

    writeString(0, 'RIFF');
    out.setUint32(4, 36 + buffer.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    out.setUint32(16, 16, true);
    out.setUint16(20, 1, true);
    out.setUint16(22, numOfChan, true);
    out.setUint32(24, sampleRate, true);
    out.setUint32(28, sampleRate * numOfChan * 2, true);
    out.setUint16(32, numOfChan * 2, true);
    out.setUint16(34, 16, true);
    writeString(36, 'data');
    out.setUint32(40, buffer.length * 2, true);

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      const sample = Math.max(-1, Math.min(1, channel[i]));
      out.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }

    return new Blob([out], { type: 'audio/wav' });
  }

  async function transcribeMedia(file: File): Promise<string> {
    let payloadFile: File | Blob = file;
    const ext = file.name.toLowerCase().split('.').pop() ?? '';
    if (file.size > 3 * 1024 * 1024 || file.type.startsWith('video/') || ['mov', 'mp4', 'webm'].includes(ext)) {
      try {
        payloadFile = await extractAudioBlobFromMedia(file);
      } catch {
        payloadFile = file;
      }
    }

    const formData = new FormData();
    const sendName = file.name.replace(/\.[^/.]+$/, "") + ".wav";
    formData.append('file', payloadFile, sendName);

    const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
    const text = await res.text();
    let data: { transcript?: string; error?: string } = {};
    try {
      data = JSON.parse(text);
    } catch {
      if (!res.ok) {
        throw new Error(
          res.status === 413
            ? 'File payload is too large for the server. Please use a shorter video clip.'
            : `Server error (${res.status}): ${text.slice(0, 120)}`
        );
      }
    }

    if (!res.ok || data.error) throw new Error(data.error ?? 'Transcription failed.');
    return data.transcript ?? '';
  }

  function removeFile(index: number) {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
    setFileError('');
  }

  // Build the merged corpus from all successfully extracted files
  function buildCorpus(): string {
    const done = uploadedFiles.filter(u => u.status === 'done');
    if (done.length === 0) return '';
    if (done.length === 1) return done[0].extractedText;
    return done
      .map((u, i) => `=== SOURCE FILE ${i + 1}: ${u.file.name} ===\n${u.extractedText}`)
      .join('\n\n');
  }

  // ── Quiz helpers ──────────────────────────────────────────────────────────

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

  // ── Main generate handler ─────────────────────────────────────────────────

  async function handleGenerate() {
    if (!contentType) { setError('Please select a content type first.'); return; }

    // Resolve final content — multi-file corpus OR manual text area
    const corpus = uploadedFiles.length > 0 ? buildCorpus() : transcript.trim();

    if (!corpus) {
      setError('Please add your content first (paste text, or upload up to 3 PDF / audio / video files).');
      return;
    }
    if (!userId) { setError('Please sign in to generate content assets.'); return; }
    if (genUsed >= GENERATION_LIMIT_PER_3_DAYS) {
      setError(`Limit reached (${GENERATION_LIMIT_PER_3_DAYS} per 3 days). Come back in a few days!`);
      return;
    }
    if (contentType === 'quiz' && quizConfig.questionTypes.length === 0) {
      setError('Select at least one question type.'); return;
    }
    setError(''); setGenerating(true);

    try {
      const session = await getSessionAsync();

      const resolvedCount = customCount
        ? (quizConfig.customQuestionCount ?? 10)
        : quizConfig.questionCount;

      const finalQuizConfig: QuizConfig = { ...quizConfig, questionCount: resolvedCount };

      const resolvedTaskCount = customTaskCount
        ? (taskConfig.customTaskCount ?? 8)
        : taskConfig.taskCount;

      const finalTaskConfig: PracticeTaskConfig = { ...taskConfig, taskCount: resolvedTaskCount };

      const genOptions: GeneratorOptions = {
        ...options,
        contentType,
        flashcardCount: contentType === 'review_cards' ? (fcOptions.cardCount === 'ai' ? 0 : fcOptions.cardCount) : 0,
        flashcardImages: contentType === 'review_cards' ? fcOptions.includeImages : false,
        quizConfig:  contentType === 'quiz'       ? finalQuizConfig : undefined,
        taskConfig:  contentType === 'activities' ? finalTaskConfig : undefined,
      };

      let slug: string | undefined;
      if (contentType === 'review_cards' || contentType === 'quiz') {
        slug = await dbMakeSlug(contentType === 'quiz' ? (finalQuizConfig.quizTitle || '') : '');
      }

      const res = await fetch('/api/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          input: { transcript: corpus, supplemental, options: genOptions },
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

      await dbGetGenUsed3Days().then(setGenUsed);

      router.push(
        contentType === 'resource_page' ? `/visual-guide/${data.course.id}` :
        contentType === 'branded_guide' ? `/pdf-pack/${data.course.id}` :
        contentType === 'quiz'          ? `/quiz/${data.course.id}/edit` :
        contentType === 'activities'    ? `/tasks/${data.course.id}/edit` :
        contentType === 'review_cards'  ? `/editor/${data.course.id}/flashcards` :
                                          `/editor/${data.course.id}`
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Generation failed. Try again.');
    } finally {
      setGenerating(false);
    }
  }

  // ── Computed ──────────────────────────────────────────────────────────────

  const sel        = contentType ? CONTENT_TYPES.find(t => t.id === contentType) : null;
  const genRemain  = Math.max(0, GENERATION_LIMIT_PER_3_DAYS - genUsed);
  const totalBytes = uploadedFiles.reduce((s, u) => s + u.file.size, 0);
  const canAddMore = uploadedFiles.length < MAX_FILES && totalBytes < MAX_TOTAL_BYTES;

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-800 text-gray-900 dark:text-white';

  if (!ready) return null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Create content assets</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Paste a transcript, or upload up to 3 files (PDFs, audio, or video) — get flashcard decks, quizzes, interactive challenges, content guides, and illustrated explainers in seconds.
            </p>
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

        {/* ── Step 2: Add Content ─────────────────────────────────────────── */}
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-200 mb-1">2. Add your content</h2>
          <p className="text-xs text-gray-400 dark:text-slate-500 mb-3">
            Upload up to {MAX_FILES} files (PDFs, audio, or video) — or paste text directly. Combined file limit: {MAX_TOTAL_MB} MB.
          </p>

          {/* ── File upload zone ─────────────────────────────────────────── */}
          <div className="space-y-3">

            {/* Uploaded file list */}
            {uploadedFiles.length > 0 && (
              <div className="space-y-2">
                {uploadedFiles.map((u, idx) => (
                  <div
                    key={`${u.file.name}-${u.file.size}`}
                    className="flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl"
                  >
                    <FileTypeIcon mime={u.file.type} size={17} />

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{u.file.name}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs text-gray-400 dark:text-slate-500">
                          {fileTypeLabel(u.file.type)} · {formatBytes(u.file.size)}
                        </span>
                        {u.status === 'processing' && (
                          <span className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                            <span className="inline-block w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                            {u.file.type === 'application/pdf' ? 'Extracting text…' : 'Transcribing…'}
                          </span>
                        )}
                        {u.status === 'done' && (
                          <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                            ✓ {u.extractedText.trim().split(/\s+/).filter(Boolean).length.toLocaleString()} words
                          </span>
                        )}
                        {u.status === 'error' && (
                          <span className="text-xs text-red-500 dark:text-red-400">{u.error}</span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0 p-1"
                      title="Remove file"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}

                {/* Combined word count badge */}
                {uploadedFiles.filter(u => u.status === 'done').length > 1 && (
                  <div className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <Layers size={13} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />
                    <p className="text-xs text-blue-700 dark:text-blue-300 font-medium">
                      {uploadedFiles.filter(u => u.status === 'done').length} sources merged ·{' '}
                      {buildCorpus().trim().split(/\s+/).filter(Boolean).length.toLocaleString()} total words — IBM Granite will synthesize across all files
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Drop zone / add-more button */}
            {canAddMore && (
              <label
                className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-6 cursor-pointer transition-colors ${
                  dragOver
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : uploadedFiles.length === 0
                    ? 'border-gray-200 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/10'
                    : 'border-gray-200 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500 bg-gray-50/50 dark:bg-slate-800/50'
                }`}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDragEnd={onDragEnd}
                onDrop={onDrop}
              >
                <Upload size={22} className={dragOver ? 'text-blue-500' : 'text-gray-400 dark:text-slate-500'} />
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-700 dark:text-slate-300">
                    {dragOver
                      ? 'Drop to add file'
                      : uploadedFiles.length === 0
                      ? 'Drag & drop or click to upload files'
                      : `Add another file (${uploadedFiles.length}/${MAX_FILES})`}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
                    PDF, MP4, MOV, WebM, MP3, WAV, FLAC · Up to {MAX_FILES} files · {MAX_TOTAL_MB} MB combined
                  </p>
                </div>
                <input
                  ref={dropRef}
                  type="file"
                  multiple
                  accept=".pdf,application/pdf,video/mp4,video/quicktime,video/webm,video/mpeg,audio/mpeg,.mp3,audio/wav,.wav,audio/flac,.flac,audio/webm,audio/ogg"
                  className="hidden"
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length > 0) addFiles(files);
                    // Reset so the same file can be re-added after removal
                    e.target.value = '';
                  }}
                />
              </label>
            )}

            {/* Manual text area — shown when no files are uploaded */}
            {uploadedFiles.length === 0 && (
              <div>
                <p className="text-xs text-gray-400 dark:text-slate-500 mb-1.5">— or paste text directly —</p>
                <textarea
                  className={`${inp} resize-none`}
                  rows={10}
                  value={transcript}
                  onChange={e => setTranscript(e.target.value)}
                  placeholder="Paste your content here — article, newsletter, blog post, transcript, script, notes, etc."
                />
              </div>
            )}

            {fileError && (
              <p className="text-xs text-red-600 dark:text-red-400">{fileError}</p>
            )}
          </div>

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

            {/* Flashcard Decks options */}
            {contentType === 'review_cards' && (
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-2">Number of Cards</label>
                  <div className="flex gap-2 flex-wrap">
                    <button type="button"
                      onClick={() => setFcOptions(o => ({ ...o, cardCount: 'ai' }))}
                      className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-all ${fcOptions.cardCount === 'ai' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-400 hover:border-gray-300'}`}
                    >✦ AI decides</button>
                    {[5, 10, 15, 20, 25].map(n => (
                      <button key={n} type="button"
                        onClick={() => setFcOptions(o => ({ ...o, cardCount: n }))}
                        className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-all ${fcOptions.cardCount === n ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-400 hover:border-gray-300'}`}
                      >{n}</button>
                    ))}
                  </div>
                  {fcOptions.cardCount === 'ai' && (
                    <p className="mt-2 text-xs text-blue-600 dark:text-blue-400">AI will analyse all topics and select the most important ones — up to 25 cards max.</p>
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

            {/* Audience Quizzes options */}
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
                      placeholder="1–50" />
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

            {/* Interactive Challenges options */}
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
                    <input type="number" min={1} max={15} className={`${inp} mt-2 max-w-[120px]`}
                      value={taskConfig.customTaskCount ?? ''}
                      onChange={e => setTaskConfig(c => ({ ...c, customTaskCount: Math.min(15, Math.max(1, parseInt(e.target.value) || 1)) }))}
                      placeholder="1–15" />
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

            {/* Content Guide / Illustrated Explainer image option */}
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
          disabled={generating || isProcessing}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors text-sm"
        >
          {generating ? (
            <>
              <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Generating your {sel?.label ?? 'asset'}…
            </>
          ) : isProcessing ? (
            <>
              <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Processing files…
            </>
          ) : (
            <><Zap size={15} /> Generate {sel?.label ?? 'Content Asset'}</>
          )}
        </button>

      </div>
    </Layout>
  );
}

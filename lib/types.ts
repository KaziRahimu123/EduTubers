// ── Creator-first output types ────────────────────────────────────────────────

export type LearnerLevel = 'beginner' | 'intermediate' | 'advanced';
export type QuizDifficulty = 'easy' | 'medium' | 'hard' | 'mixed';
export type QuestionType = 'multiple_choice' | 'true_false' | 'multiple_select';
export type ShowAnswerTiming = 'immediately' | 'after_submission';
export type Tone = 'friendly' | 'professional' | 'academic' | 'conversational';
export type CourseStatus = 'draft' | 'published';

/**
 * The 5 approved creator output types.
 * Internal IDs map to creator-first labels throughout the UI.
 *
 *  branded_guide   → Branded Content Guide
 *  quiz            → Interactive Quiz
 *  review_cards    → Quick Review Cards
 *  activities      → Audience Practice Activities
 *  resource_page   → Branded Resource Page
 */
export type ContentType =
  | 'review_cards'
  | 'quiz'
  | 'activities'
  | 'branded_guide'
  | 'resource_page';

export const CONTENT_TYPES = [
  {
    id: 'review_cards' as ContentType,
    emoji: '📚',
    label: 'Flashcard Decks',
    desc: 'Auto-generated flashcard decks from your video or transcript — ready for your audience to explore and engage with key ideas.',
    color: 'border-rose-500 bg-rose-50 text-rose-800',
    badge: 'bg-rose-100 text-rose-700',
  },
  {
    id: 'quiz' as ContentType,
    emoji: '✅',
    label: 'Audience Quizzes',
    desc: 'Multiple-choice, true/false, and multiple-select quizzes with scoring, explanations, and instant feedback tied to your content.',
    color: 'border-orange-500 bg-orange-50 text-orange-800',
    badge: 'bg-orange-100 text-orange-700',
  },
  {
    id: 'activities' as ContentType,
    emoji: '🧩',
    label: 'Interactive Challenges',
    desc: 'Applied challenges tailored to your content — coding exercises, scenario walkthroughs, decision tasks, and reflection prompts.',
    color: 'border-purple-500 bg-purple-50 text-purple-800',
    badge: 'bg-purple-100 text-purple-700',
  },
  {
    id: 'branded_guide' as ContentType,
    emoji: '📄',
    label: 'Content Guide',
    desc: 'A printable, exportable content guide combining notes, key takeaways, definitions, and discussion prompts from your content.',
    color: 'border-green-500 bg-green-50 text-green-800',
    badge: 'bg-green-100 text-green-700',
  },
  {
    id: 'resource_page' as ContentType,
    emoji: '🖼️',
    label: 'Illustrated Explainer',
    desc: 'AI-illustrated explainer — section-by-section visual summaries that bring your content to life for your audience.',
    color: 'border-indigo-500 bg-indigo-50 text-indigo-800',
    badge: 'bg-indigo-100 text-indigo-700',
  },
] as const;

// ── Theme styles (for generated content assets only — not app appearance) ─────

export type ThemeStyle =
  | 'minimal'
  | 'modern'
  | 'bold'
  | 'colorful'
  | 'professional'
  | 'fun'
  | 'visual-heavy'
  | 'energetic';

export const THEME_STYLES: { id: ThemeStyle; label: string }[] = [
  { id: 'minimal',       label: 'Minimal' },
  { id: 'modern',        label: 'Modern' },
  { id: 'bold',          label: 'Bold' },
  { id: 'colorful',      label: 'Colorful' },
  { id: 'professional',  label: 'Professional' },
  { id: 'fun',           label: 'Fun' },
  { id: 'visual-heavy',  label: 'Visual-heavy' },
  { id: 'energetic',     label: 'Energetic' },
];

// ── Review Cards (formerly Flashcards) ────────────────────────────────────────

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  /** Optional AI-generated or user-uploaded image (data URL or base64 PNG) */
  image?: string;
  /** Per-card accent colour for colorful mode, e.g. '#f0abfc' */
  color?: string;
}

export interface FlashcardDeckOptions {
  /** Number of cards: positive integer = fixed count, 0 = AI decides based on key topics */
  cardCount: number | 'ai';
  /** Whether to display cards with colour accents */
  colorful: boolean;
  /** Whether cards should include images */
  includeImages: boolean;
}

export interface FlashcardReview {
  id: string;
  deckId: string;
  /** Viewer's display name (anonymous if blank) */
  name: string;
  /** Short comment — max 50 characters */
  comment: string;
  createdAt: string;
}

// ── Interactive Quiz ──────────────────────────────────────────────────────────

export interface QuizQuestion {
  id: string;
  question: string;
  type: QuestionType;
  choices: string[];
  /** For multiple_choice / true_false: index of correct choice */
  correctAnswer: number;
  /** For multiple_select: indices of all correct choices */
  correctAnswers?: number[];
  explanation: string;
}

export interface QuizConfig {
  /** Creator-specified title (overrides AI title if set) */
  quizTitle: string;
  targetAudience: LearnerLevel;
  /** 'ai' = AI picks count based on key topics; 'custom' = use customQuestionCount */
  questionCount: number | 'custom' | 'ai';
  customQuestionCount?: number;
  questionTypes: QuestionType[];
  difficulty: QuizDifficulty;
  passingScore: number;
  attemptsAllowed: number | 'unlimited';
  shuffleQuestions: boolean;
  shuffleChoices: boolean;
  feedbackSettings: QuizFeedbackSettings;
}

export interface QuizFeedbackSettings {
  showAnswerTiming: ShowAnswerTiming;
  showExplanations: boolean;
  allowRetryIncorrect: boolean;
  showFinalScore: boolean;
  showAnswerReview: boolean;
  answersPublished: boolean;
}

export interface QuizAttemptAnswer {
  questionId: string;
  selected?: number;
  selectedMulti?: number[];
}

export interface QuizAttemptResult {
  id: string;
  quizId: string;
  answers: QuizAttemptAnswer[];
  score: number;
  total: number;
  percentageScore: number;
  passed: boolean;
  completedAt: string;
  attemptNumber: number;
}

// ── Interactive Challenge Attempts ────────────────────────────────────────────

export interface TaskAttemptTaskResult {
  taskId: string;
  correct: boolean;
}

export interface TaskAttemptResult {
  id: string;
  courseId: string;
  /** Display name of the person who took the challenge — null means anonymous */
  takerName: string | null;
  results: TaskAttemptTaskResult[];
  correctCount: number;
  totalCount: number;
  percentageScore: number;
  completedAt: string;
}

// ── Audience Practice Activities (formerly Practice Tasks) ───────────────────

export type TaskDifficulty = 'beginner' | 'intermediate' | 'challenge';
export type TaskAnswerTiming = 'immediately' | 'after_submission';

export interface PracticeTask {
  id: string;
  title: string;
  topic: string;
  difficulty: TaskDifficulty;
  description: string;
  activity: string;
  answerFormat: string;
  hint?: string;
  /** What to review if the learner is stuck — e.g. "Review: Python variables and assignment" */
  reviewNote?: string;
  answerKey: string;
  explanation: string;
  incorrectFeedback: string;
}

export interface PracticeTaskConfig {
  /** 'ai' = AI picks count based on key topics; 'custom' = use customTaskCount */
  taskCount: number | 'custom' | 'ai';
  customTaskCount?: number;
  learnerLevel: LearnerLevel;
  difficulty: TaskDifficulty | 'mixed';
  includeHints: boolean;
  showAnswerTiming: TaskAnswerTiming;
  showAnswers: boolean;
}

// ── Branded Content Guide (formerly PDF Pack) ─────────────────────────────────

export interface PdfKeyTerm {
  term: string;
  definition: string;
  example: string;
}

export interface PdfWorkedExample {
  title: string;
  steps: Array<{ step: string; reason: string }>;
  commonMistake: string;
}

export interface PdfComparisonRow {
  aspect: string;
  optionA: string;
  optionB: string;
}

export interface PdfComparisonTable {
  labelA: string;
  labelB: string;
  rows: PdfComparisonRow[];
}

export interface PdfReviewQuestion {
  question: string;
  answer: string;
  sectionRef: string;
}

export interface PdfSection {
  id: string;
  title: string;
  overview: string;
  prerequisites: string[];
  notes: string;
  keyPoints: string[];
  keyTerms: PdfKeyTerm[];
  workedExamples: PdfWorkedExample[];
  comparisonTable?: PdfComparisonTable;
  reviewQuestions: PdfReviewQuestion[];
  imageUrl?: string;
}

export interface PdfPack {
  title: string;
  description: string;
  topicOverview: string;
  learningObjectives: string[];
  requiredBackground: string[];
  sections: PdfSection[];
  summary: {
    mainTakeaways: string[];
    importantFormulas: string[];
    mustRemember: string[];
  };
}

// ── Module ─────────────────────────────────────────────────────────────────────

export interface Module {
  id: string;
  title: string;
  objective: string;
  lessonNotes: string;
  examples: string;
  flashcards: Flashcard[];
  quizQuestions: QuizQuestion[];
  practiceTasks: PracticeTask[];
  /** Only present when contentType === 'branded_guide' */
  pdfPack?: PdfPack;
  /** AI-generated or user-uploaded image (resource_page). Saved in Supabase. */
  imageUrl?: string;
  /** Editable caption shown below the image. Every generated image has a caption. */
  imageCaption?: string;
}

export interface FinalProject {
  title: string;
  description: string;
  deliverables: string[];
}

// ── Course (content asset) ────────────────────────────────────────────────────

export interface Course {
  id: string;
  title: string;
  description: string;
  contentType: ContentType;
  learnerLevel: LearnerLevel;
  learningGoals: string[];
  modules: Module[];
  finalProject: FinalProject;
  creatorImprovementNotes: string;
  shareText: string;
  status: CourseStatus;
  createdAt: string;
  updatedAt: string;
  views: number;
  completions: number;
  /** Review-card deck options (review_cards only) */
  flashcardOptions?: FlashcardDeckOptions;
  /** Quiz config (quiz only) */
  quizConfig?: QuizConfig;
  /** Practice activities config (activities only) */
  taskConfig?: PracticeTaskConfig;
  /**
   * URL-friendly slug for the public viewer.
   */
  slug?: string;
  /** Display name of the creator — used to scope reviews */
  creatorUsername?: string;
  /**
   * Whether the creator requested AI-generated images (resource_page / branded_guide only).
   */
  generateImages?: boolean;
}

/** Legacy — kept for backward compatibility */
export interface QuizAttempt {
  id: string;
  courseId: string;
  moduleId: string;
  answers: number[];
  score: number;
  total: number;
  completedAt: string;
}

export interface FeedbackComment {
  id: string;
  courseId: string;
  name: string;
  rating: number;
  comment: string;
  createdAt: string;
}

// ── Generator input/output ────────────────────────────────────────────────────

export interface GeneratorOptions {
  learnerLevel: LearnerLevel;
  quizDifficulty: QuizDifficulty;
  tone: Tone;
  contentType: ContentType;
  /** Review cards: how many cards to generate (0 = AI decides) */
  flashcardCount?: number;
  /** Review cards: whether creator wants images on cards */
  flashcardImages?: boolean;
  /** Quiz config — present when contentType === 'quiz' */
  quizConfig?: QuizConfig;
  /** Activities config — present when contentType === 'activities' */
  taskConfig?: PracticeTaskConfig;
}

export interface GeneratorInput {
  transcript: string;
  supplemental: string;
  options: GeneratorOptions;
}

// ── Generation tiers ──────────────────────────────────────────────────────────

export const GENERATION_TIERS = [
  {
    id:    'standard' as const,
    model: 'gpt-5.6-luna',
    label: 'Standard',
    desc:  'Fast, reliable generation for everyday content',
    badge: 'bg-blue-100 text-blue-700',
  },
] as const;

export type GenerationTierId = typeof GENERATION_TIERS[number]['id'];

export const GENERATION_LIMIT_PER_3_DAYS = 999999;
export const IMAGE_LIMIT_PER_3_DAYS = 999999;

/** @deprecated use GENERATION_LIMIT_PER_3_DAYS */
export const DAILY_GENERATION_LIMIT = GENERATION_LIMIT_PER_3_DAYS;

// ── Legacy model list ─────────────────────────────────────────────────────────
export const OPENAI_MODELS = GENERATION_TIERS.map(t => ({
  id:    t.id,
  label: t.label,
  desc:  t.desc,
})) as unknown as readonly { id: string; label: string; desc: string }[];

export type OpenAIModelId = string;

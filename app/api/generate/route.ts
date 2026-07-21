import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { request as nodeHttpsRequest } from 'node:https';
import { getAuth0User } from '@/lib/auth0-session';
import type { GeneratorInput, Module, Flashcard, QuizQuestion, PracticeTask, Course, QuizConfig, PracticeTaskConfig } from '@/lib/types';
import { GENERATION_TIERS, DAILY_GENERATION_LIMIT } from '@/lib/types';

// ── OpenAI via node:https (bypasses Next.js patched fetch) ────────────────────
// Next.js patches globalThis.fetch and propagates the incoming request's
// AbortSignal to every outgoing fetch(). Generation takes 10–30 s; if the
// browser connection stalls during that time the signal fires and the call
// throws "fetch failed / session destroyed". node:https has no awareness of
// the request lifecycle so it always runs to completion.
function openaiPost(apiKey: string, path: string, bodyObj: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(bodyObj);
    const req = nodeHttpsRequest(
      {
        hostname: 'api.openai.com',
        path,
        method: 'POST',
        headers: {
          'Content-Type':   'application/json',
          Authorization:    `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if ((res.statusCode ?? 200) >= 400) {
            // Surface the OpenAI error message when available
            try {
              const parsed = JSON.parse(text) as { error?: { message?: string } };
              reject(Object.assign(
                new Error(parsed.error?.message ?? `OpenAI error ${res.statusCode}`),
                { status: res.statusCode },
              ));
            } catch {
              reject(Object.assign(new Error(`OpenAI error ${res.statusCode}`), { status: res.statusCode }));
            }
            return;
          }
          try { resolve(JSON.parse(text)); }
          catch { reject(new Error('OpenAI returned invalid JSON')); }
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(bodyStr);
  });
}

// ── Supabase REST upsert via node:https (bypasses Next.js patched fetch) ──────
// The Supabase JS client uses globalThis.fetch internally. Next.js patches that
// fetch and binds the incoming request's AbortSignal — so after ~30 s the signal
// fires and the upsert throws "fetch failed". Using node:https directly avoids
// the signal entirely, same as the OpenAI calls above.
function supabaseUpsert(
  url: string,
  serviceKey: string,
  table: string,
  row: Record<string, unknown>,
): Promise<{ error: { message: string } | null }> {
  return new Promise((resolve) => {
    const bodyStr = JSON.stringify(row);
    const parsed = new URL(`${url}/rest/v1/${table}`);
    const req = nodeHttpsRequest(
      {
        hostname:   parsed.hostname,
        port:       443,
        servername: parsed.hostname,
        path:       `${parsed.pathname}?on_conflict=id`,
        method:     'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': String(Buffer.byteLength(bodyStr)),
          apikey:           serviceKey,
          Authorization:    `Bearer ${serviceKey}`,
          Prefer:           'resolution=merge-duplicates,return=minimal',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            resolve({ error: null });
          } else {
            let msg = `Supabase ${status}`;
            try { msg = (JSON.parse(text) as { message?: string }).message ?? msg; } catch { /* noop */ }
            resolve({ error: { message: msg } });
          }
        });
        res.on('error', (e) => resolve({ error: { message: e.message } }));
      },
    );
    req.on('error', (e) => resolve({ error: { message: e.message } }));
    req.end(bodyStr);
  });
}

// ── Supabase RPC via node:https ───────────────────────────────────────────────
function supabaseRpc(
  url: string,
  serviceKey: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; error: { message: string } | null }> {
  return new Promise((resolve) => {
    const bodyStr = JSON.stringify(args);
    const parsed = new URL(`${url}/rest/v1/rpc/${fn}`);
    const req = nodeHttpsRequest(
      {
        hostname:   parsed.hostname,
        port:       443,
        servername: parsed.hostname,
        path:       parsed.pathname,
        method:     'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': String(Buffer.byteLength(bodyStr)),
          apikey:           serviceKey,
          Authorization:    `Bearer ${serviceKey}`,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            try { resolve({ data: JSON.parse(text), error: null }); }
            catch { resolve({ data: null, error: null }); }
          } else {
            let msg = `Supabase RPC ${status}`;
            try { msg = (JSON.parse(text) as { message?: string }).message ?? msg; } catch { /* noop */ }
            resolve({ data: null, error: { message: msg } });
          }
        });
        res.on('error', (e) => resolve({ data: null, error: { message: e.message } }));
      },
    );
    req.on('error', (e) => resolve({ data: null, error: { message: e.message } }));
    req.end(bodyStr);
  });
}

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function blankCourse(partial: Partial<Course> = {}): Course {
  return {
    id: uid(), title: 'Untitled', description: '',
    contentType: 'review_cards', learnerLevel: 'beginner', learningGoals: [], modules: [],
    finalProject: { title: '', description: '', deliverables: [] },
    creatorImprovementNotes: '', shareText: '',
    status: 'draft', createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), views: 0, completions: 0,
    ...partial,
  };
}

// ── Content analysis pre-pass ─────────────────────────────────────────────────

export interface ContentAnalysis {
  domain: string;
  keyTopics: Array<{
    topic: string;
    description: string;
    subtopics: string[];
    keyFacts: string[];
    weight: number; // relative importance 1–3
  }>;
  conceptsToTest: string[];
  difficultySignals: string;
  suggestedTitle: string;
}

async function analyzeContent(
  transcript: string,
  supplemental: string,
  apiKey: string,
  model: string,
): Promise<ContentAnalysis | null> {
  try {
    // Use the full transcript — split into two halves so nothing is missed
    const half = Math.floor(transcript.length / 2);
    const firstHalf  = transcript.slice(0, Math.min(half + 2000, 9000));
    const secondHalf = transcript.slice(Math.max(0, half - 1000)).slice(0, 9000);
    const extra = supplemental ? `\n\nSUPPLEMENTAL MATERIAL:\n${supplemental.slice(0, 2000)}` : '';

    const src = `--- FIRST HALF ---\n${firstHalf}\n\n--- SECOND HALF (may overlap) ---\n${secondHalf}${extra}`;

    const data = await openaiPost(apiKey, '/v1/chat/completions', {
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a senior curriculum analyst. Return ONLY valid JSON — no markdown, no code fences.',
        },
        {
          role: 'user',
          content: `Read this educational content IN FULL — both halves — and extract a comprehensive topic outline. Your goal is to capture EVERY significant topic covered, not just the first few.

CONTENT:
${src}

Return JSON exactly as:
{
  "domain": "The precise subject domain (e.g. 'Python Programming', 'Personal Finance', 'Cell Biology')",
  "keyTopics": [
    {
      "topic": "Exact topic name as covered in the content",
      "description": "One sentence: what specifically this topic covers here",
      "subtopics": ["specific sub-concept 1", "specific sub-concept 2", "specific sub-concept 3", "specific sub-concept 4"],
      "keyFacts": ["A specific fact, rule, or formula from this topic", "Another distinct fact", "A third fact"],
      "weight": 2
    }
  ],
  "conceptsToTest": ["Specific testable concept 1", "Specific testable concept 2", "...up to 15 concepts"],
  "difficultySignals": "One sentence describing assumed prior knowledge and complexity level",
  "suggestedTitle": "A short, specific title for a learning asset on this content"
}

RULES — critical:
- Extract EVERY topic that gets meaningful coverage — aim for 5–10 topics. Do not stop at 3.
- Read the SECOND HALF carefully — content often covers different topics in its second half.
- subtopics: list 3–5 specific sub-concepts per topic (not generic terms like "overview" or "basics").
- keyFacts: list 2–4 specific, concrete facts, rules, or formulas stated in the content for this topic.
- weight: 1 = briefly mentioned, 2 = covered in moderate depth, 3 = core focus of the content.
- conceptsToTest: list up to 15 specific, actionable things — things a learner should be able to DO or EXPLAIN. Be granular.
- Never include generic topics like "Introduction" unless the content is genuinely only introductory.`,
        },
      ],
      max_completion_tokens: 2500,
    }) as { choices: Array<{ message: { content: string } }> };
    const raw = data.choices[0].message.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    return JSON.parse(raw) as ContentAnalysis;
  } catch {
    return null;
  }
}

// ── Format analysis as an enforced coverage blueprint ────────────────────────

function formatAnalysisBlock(analysis: ContentAnalysis, itemCount?: number): string {
  // Sort topics by weight descending so high-weight topics appear first
  const sorted = [...analysis.keyTopics].sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1));

  // Compute per-topic item allocation if itemCount provided
  const totalWeight = sorted.reduce((s, t) => s + (t.weight ?? 1), 0);
  const topicsText = sorted.map((t, i) => {
    const allocation = itemCount
      ? Math.max(1, Math.round(((t.weight ?? 1) / totalWeight) * itemCount))
      : null;
    const allocationStr = allocation ? ` → generate ${allocation} item${allocation > 1 ? 's' : ''} for this topic` : '';
    return [
      `  ${i + 1}. [${t.weight === 3 ? 'CORE' : t.weight === 2 ? 'IMPORTANT' : 'SUPPORTING'}] ${t.topic}${allocationStr}`,
      `     What it covers: ${t.description}`,
      `     Sub-concepts: ${t.subtopics.join(' | ')}`,
      `     Key facts: ${t.keyFacts.join(' | ')}`,
    ].join('\n');
  }).join('\n\n');

  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTENT ANALYSIS — MANDATORY COVERAGE BLUEPRINT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Domain: ${analysis.domain}
Difficulty: ${analysis.difficultySignals}

TOPICS TO COVER — ALL of these must appear in your output:
${topicsText}

SPECIFIC CONCEPTS TO TEST (use these as the basis for individual items):
${analysis.conceptsToTest.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}

COVERAGE RULES — non-negotiable:
1. Every topic marked [CORE] or [IMPORTANT] MUST have at least one item generated for it.
2. [SUPPORTING] topics should each have at least one item unless the total count is very small.
3. Do NOT generate multiple items about the same narrow sub-concept.
4. Spread items across the full content — do not cluster on the first topic.
5. Use the keyFacts listed above as the basis for specific, accurate items.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`.trim();
}

// ── Universal "what to review" rule — injected into every prompt type ─────────

const UNIVERSAL_REVIEW_NOTE_RULES = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REVIEW NOTE RULES — apply to every subject domain
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The "reviewNote" answers ONE question: "If the learner is completely stuck, what SPECIFIC concept, rule, or skill do they need to look up to be able to answer this?"

It must point to the SKILL, RULE, or MECHANISM needed — NOT what the item is about as a topic.

DOMAIN EXAMPLES:
  Coding:    ✓ "Review: print() syntax — print('your text here')"
             ✓ "Review: Python for-loop — for item in list:"
             ✗ "Review: Python's uses in data science" ← topic, not skill

  Finance:   ✓ "Review: how compound interest is calculated — A = P(1 + r/n)^nt"
             ✓ "Review: the difference between a stock and a bond"
             ✗ "Review: investing concepts" ← too vague

  History:   ✓ "Review: the causes of World War I — the alliance system and assassination of Archduke Franz Ferdinand"
             ✓ "Review: the difference between the Allied and Axis powers"
             ✗ "Review: World War I" ← the whole topic, not the specific concept

  Biology:   ✓ "Review: how DNA replication works — the role of DNA polymerase"
             ✓ "Review: the difference between mitosis and meiosis"
             ✗ "Review: cell biology" ← too vague

  Grammar:   ✓ "Review: when to use a comma before a conjunction in compound sentences"
             ✗ "Review: grammar rules" ← useless

  Maths:     ✓ "Review: how to apply the quadratic formula — x = (−b ± √(b²−4ac)) / 2a"
             ✓ "Review: the difference between mean, median, and mode"
             ✗ "Review: statistics" ← too vague

RULES:
- One line only.
- Name the SPECIFIC concept or rule, not the general subject area.
- For technical topics (coding, maths, science): include a micro-example, formula, or syntax snippet.
- Never say "the video", "the source", "the notes", or "the transcript".
- Never repeat the task title or topic field as the reviewNote.`.trim();

// ── Per-type prompts ──────────────────────────────────────────────────────────

function buildPrompt(input: GeneratorInput, analysis: ContentAnalysis | null): { system: string; user: string } {
  const { transcript, supplemental, options } = input;
  const { tone, quizDifficulty, learnerLevel, contentType } = options;

  const ctx = `Use a ${tone} tone and target ${learnerLevel} audience members.`;
  const src = `\n\nSOURCE CONTENT:\n${transcript.slice(0, 14000)}${supplemental ? `\n\nSUPPLEMENTAL:\n${supplemental.slice(0, 2000)}` : ''}`;
  const base = 'Base ALL content directly on the source material. Never use generic placeholders. Never reference "the video", "the transcript", "the source", or "the content" directly.';

  // Determine AI-decided count instruction from analysis
  const topicCount = analysis?.keyTopics?.length ?? 0;
  const aiCountInstruction = topicCount > 0
    ? `You have ${topicCount} key topics identified above. Generate exactly ONE high-quality item per distinct key topic or major sub-concept — no more than 2 items per topic, no topic left without coverage. Total should be between ${topicCount} and ${Math.min(topicCount * 2, 20)}.`
    : `Analyse the content yourself and generate one item per distinct key concept. Stop when every important concept is covered — do not pad.`;

  const system = 'You are an expert content strategist and creator assistant. Return ONLY valid JSON — no markdown, no code fences, no explanation.';

  // ── Quick Review Cards ────────────────────────────────────────────────────
  if (contentType === 'review_cards') {
    const { flashcardCount } = options;
    const isAi = flashcardCount === undefined || flashcardCount === 0 || (flashcardCount as unknown) === 'ai';
    const analysisBlock = analysis ? `\n\n${formatAnalysisBlock(analysis, isAi ? undefined : (flashcardCount as number))}` : '';
    const countInstruction = isAi
      ? (analysis
          ? `Based on the Content Analysis above: ${aiCountInstruction} Each card covers one key concept or sub-concept from the blueprint.`
          : `Identify only the concepts a reader absolutely must know. Generate as few cards as needed — most content warrants 5–10 cards. Only go higher if the content genuinely contains more distinct key ideas.`)
      : `Generate exactly ${flashcardCount} review cards. No more, no fewer.`;
    return {
      system,
      user: `You are creating tightly curated Quick Review Cards for a creator's audience. Extract only the most critical key ideas — the handful of concepts that define this topic. Think of it as the 20% of knowledge that gives 80% of understanding.

${ctx} ${base}${analysisBlock}${src}

STRICT RULES FOR EVERY CARD:
- front: one term, concept, or short question — MAX 8 words.
- back: the answer or definition — MAX 10 words. One crisp phrase. No filler.
- Never reference "the video", "the transcript", "the source", or "the content".
- Never write meta-questions like "What is the main purpose of...".
- Each card must teach a single self-contained idea.
- When in doubt about whether to include a card, cut it.

Good: { "front": "What is a stock?", "back": "A share of ownership in a company." }
Bad:  { "front": "What are all the different types of investments mentioned?", "back": "There are stocks, bonds, index funds, ETFs, and target retirement funds discussed." }

${countInstruction}

${UNIVERSAL_REVIEW_NOTE_RULES}

Return JSON:
{
  "title": "Concise deck title — the actual subject, e.g. 'Investing Basics'",
  "description": "One sentence: what key ideas this deck covers for the creator's audience",
  "modules": [{
    "title": "Topic name",
    "objective": "",
    "lessonNotes": "",
    "examples": "",
    "flashcards": [{"front": "Short term or question — max 8 words", "back": "Short answer — max 10 words", "reviewNote": "The specific concept, rule, or formula to look up if this card is confusing — follow REVIEW NOTE RULES above."}],
    "quizQuestions": [],
    "practiceTasks": []
  }],
  "learningGoals": ["Key ideas audience members will remember"],
  "finalProject": {"title": "", "description": "", "deliverables": []},
  "creatorImprovementNotes": "",
  "shareText": "Ready-to-post caption for the creator's platform"
}`,
    };
  }

  // ── Interactive Quiz ───────────────────────────────────────────────────────
  if (contentType === 'quiz') {
    const cfg: QuizConfig | undefined = options.quizConfig;
    const audience  = cfg?.targetAudience ?? learnerLevel;
    const diff      = cfg?.difficulty     ?? quizDifficulty;
    const isAiCount = cfg?.questionCount === 'ai';
    const count     = typeof cfg?.questionCount === 'number' ? cfg.questionCount : (isAiCount ? null : 10);
    const types     = cfg?.questionTypes ?? ['multiple_choice', 'true_false', 'multiple_select'];
    const title     = cfg?.quizTitle ? `The quiz title must be exactly: "${cfg.quizTitle}".` : 'Choose an appropriate quiz title from the content.';
    const analysisBlock = analysis ? `\n\n${formatAnalysisBlock(analysis, isAiCount ? undefined : (count ?? undefined))}` : '';
    const countInstruction = isAiCount
      ? (analysis
          ? `Based on the Content Analysis above: ${aiCountInstruction} Distribute questions evenly across all key topics.`
          : `Determine the right number of questions yourself — one question per distinct key concept. Do not pad with repetitive questions.`)
      : `Write exactly ${count} questions.`;

    const typeInstructions = types.map(t => {
      if (t === 'multiple_choice') return `- multiple_choice: 4 answer choices, exactly one correct (correctAnswer: index 0–3, correctAnswers: null/omit).`;
      if (t === 'true_false')      return `- true_false: choices must be exactly ["True", "False"], correctAnswer: 0 or 1, correctAnswers: null/omit.`;
      if (t === 'multiple_select') return `- multiple_select: 4–5 choices, 2 or more correct (correctAnswer: 0 as placeholder, correctAnswers: array of correct indices). CRITICAL DISTINCTNESS RULES: (1) Every choice must look noticeably different at a glance — a student scanning options must be able to tell them apart immediately. (2) NEVER produce two choices that share the same formula structure and differ only by swapping one variable name (e.g. do NOT have both "x^m × x^n = x^(m+n)" and "x^m × y^n = x^(m+n)" as separate options). (3) Each wrong choice must represent a completely different misconception or rule, not a superficial variant. (4) Before finalising, read all choices aloud — if any two sound nearly the same or look nearly identical, replace one with a fundamentally different option.`;
      return '';
    }).join('\n');

    const diffInstruction = diff === 'mixed'
      ? 'Vary question difficulty — roughly 1/3 easy, 1/3 medium, 1/3 hard.'
      : `All questions should be ${diff} difficulty.`;

    return {
      system,
      user: `You are an expert quiz writer creating an interactive quiz for a creator's audience. ${countInstruction}

Target audience: ${audience}. ${diffInstruction}
${title}
${analysisBlock}

QUESTION TYPES ALLOWED (distribute evenly across types if multiple selected):
${typeInstructions}

SOURCE MATERIAL:
${src.replace('\n\nSOURCE CONTENT:\n', '').replace('\n\nSUPPLEMENTAL:\n', '\n\nEXTRA CONTEXT:\n')}

LANGUAGE RULES — absolute, no exceptions:
- NEVER start a question with "According to the source", "According to the text", "According to the passage", "Based on the source", "As mentioned in", or any similar phrase.
- NEVER start an explanation with "The source explains", "The text says", "The passage mentions", or any similar phrase.
- Write questions as a knowledgeable expert testing the audience on the subject — state facts directly.

NOTATION RULES — for technical subjects:
- ALWAYS use standard symbolic notation, NEVER spell out expressions in words.
- Maths: use Unicode superscripts for simple powers (e.g. 5³ × 5⁴). For complex expressions use LaTeX wrapped in $...$.
- Chemistry: use proper formulae (e.g. H₂O, CO₂). Physics: use symbolic notation with units (e.g. F = ma).

CONTENT RULES:
- Every question MUST have a "type" field set to one of: ${types.map(t => `"${t}"`).join(', ')}.
- Every explanation must be 2–3 confident sentences that directly state the reason the answer is correct.
- For multiple_select: always include at least 2 correct answers in correctAnswers.
- For multiple_select: VISUAL DISTINCTNESS CHECK — before writing each option, ask "does this look nearly identical to any other option?". If yes, replace it. BAD example (banned): options "x^m × x^n = x^(m+n)" and "x^m × y^n = x^(m+n)" — these look almost the same. GOOD example: cover completely different rules like "add exponents when multiplying same base", "zero exponent equals 1", "negative exponent means reciprocal". Each choice must test a distinct concept.
- Spread questions across the key concepts covered. Do not cluster on one subtopic.

${UNIVERSAL_REVIEW_NOTE_RULES}

CORRECT ANSWER PLACEMENT — critical:
- The correct answer MUST be placed at a RANDOM position (index 0, 1, 2, or 3) across questions.
- Do NOT put the correct answer in position 0 for every question.
- Across all ${count} questions, distribute correctAnswer values roughly evenly: some 0s, some 1s, some 2s, some 3s.

Return JSON:
{
  "title": "Quiz title",
  "description": "One sentence: what this quiz assesses for the creator's audience",
  "modules": [{
    "title": "Quiz",
    "objective": "",
    "lessonNotes": "",
    "examples": "",
    "flashcards": [],
    "quizQuestions": [
      {
        "type": "multiple_choice",
        "question": "Direct question without source references",
        "choices": ["Choice A", "Choice B", "Choice C", "Choice D"],
        "correctAnswer": 2,
        "correctAnswers": null,
        "explanation": "2–3 confident sentences explaining why this is correct. End with: 'If unsure, review: [the specific concept, rule, or formula the learner needs — see REVIEW NOTE RULES above]'."
      }
    ],
    "practiceTasks": []
  }],
  "learningGoals": ["What this quiz assesses"],
  "finalProject": {"title": "", "description": "", "deliverables": []},
  "creatorImprovementNotes": "Suggestions for improving the quiz content",
  "shareText": "Ready-to-post caption for the creator's platform"
}`,
    };
  }

  // ── Audience Practice Activities ───────────────────────────────────────────
  if (contentType === 'activities') {
    const taskCfg: PracticeTaskConfig | undefined = options.taskConfig;
    const audience    = taskCfg?.learnerLevel ?? learnerLevel;
    const difficulty  = taskCfg?.difficulty   ?? 'mixed';
    const isAiCount   = taskCfg?.taskCount === 'ai';
    const count       = taskCfg
      ? (taskCfg.taskCount === 'custom' ? (taskCfg.customTaskCount ?? 8) : (isAiCount ? null : (typeof taskCfg.taskCount === 'number' ? taskCfg.taskCount : 8)))
      : 8;
    const includeHints = taskCfg?.includeHints ?? true;
    const analysisBlock = analysis ? `\n\n${formatAnalysisBlock(analysis, isAiCount ? undefined : (typeof count === 'number' ? count : undefined))}` : '';
    const taskCountInstruction = isAiCount
      ? (analysis
          ? `Based on the Content Analysis above: ${aiCountInstruction} Each task covers a distinct key topic or sub-concept. Spread tasks evenly across ALL topics listed in the blueprint — do not generate multiple tasks for the same topic before covering every other topic at least once.`
          : `Determine the right number of tasks yourself — one task per distinct key concept. Do not pad.`)
      : `Generate exactly ${count} activities. Spread them evenly across ALL key topics — do not cluster multiple tasks on the same topic while leaving others uncovered.`;

    const diffInstruction = difficulty === 'mixed'
      ? `Generate a MIXTURE of difficulty levels: roughly 1/3 beginner (foundational recall and identification), 1/3 intermediate (application and analysis), and 1/3 challenge (synthesis, evaluation, and creation). Label each task's "difficulty" field accordingly.`
      : `All tasks should be "${difficulty}" difficulty level. Label each task's "difficulty" field as "${difficulty}".`;

    const hintInstruction = includeHints
      ? `For every task, provide a "hint" field: a subtle nudge that guides thinking without giving the answer away. Keep hints to 1–2 sentences.`
      : `The "hint" field for every task must be an empty string "" — do NOT provide hints.`;

    return {
      system,
      user: `You are an expert hands-on practice designer. ${taskCountInstruction} Your job is to make learners DO things — not describe things.
${analysisBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — DETECT THE SUBJECT DOMAIN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Identify the domain using the Content Analysis above. For CODING / PROGRAMMING content, at least 70% of tasks MUST be hands-on code exercises (find-the-bug, complete-the-code, write-the-code, trace-the-output, fix-and-explain). The remaining 30% may use other formats to vary pace.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2 — TASK FORMATS BY DOMAIN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You MUST rotate through formats — never use the same format twice in a row.

CODING / PROGRAMMING (use code-based formats for ≥70% of tasks):
  • "find-the-bug" — show a short broken code snippet (4–10 lines), ask the learner to identify the bug AND write the corrected line(s).
    ⚠️ The bug must be a real, specific mistake from the concept being taught — not a generic typo. Show the full broken function, not just one line.
  • "complete-the-code" — show a function/script with 1–3 strategic blanks marked [___], ask the learner to fill them in so the code runs correctly.
    ⚠️ The surrounding code must be complete and runnable except for the blank(s). State exactly what the output should be.
  • "write-the-code" — describe a small, specific task in plain English (e.g. "Write a Python function that takes a list of numbers and returns their sum"), ask the learner to write the complete solution from scratch.
    ⚠️ Scope must be tight — solvable in 3–8 lines. State the expected output or behaviour precisely.
  • "trace-the-output" — show a complete runnable code snippet (5–12 lines), ask what will be printed/returned. Must include variables changing, loops, or conditionals to make it non-trivial.
  • "fix-and-explain" — show code with a logical error (wrong result, not a crash), ask the learner to fix it AND explain in one sentence why the original was wrong.
  • "match-the-term" — for terminology/concepts only (use sparingly, max 1 per set): match coding terms to their definitions.

BIOLOGY / HEALTH / SCIENCE:
  • "interpret-data" — show a table or measurement result, ask what it means
  • "cause-and-effect" — show a scenario, ask to identify cause and effect
  • "true-or-false-with-correction" — give 4–6 statements, ask which are true/false and correct the false ones
  • "match-the-term" — give a list of terms and definitions in shuffled order, ask to match them
  • "fill-in-the-blank" — give a sentence or short paragraph with 3–5 key words removed

MATHEMATICS:
  • "calculate" — give numbers and context, ask for a numeric answer showing working
  • "word-problem" — realistic scenario, single numeric answer
  • "spot-the-error" — show a worked calculation with a mistake, ask where the error is
  • "fill-in-the-formula" — show a formula with blanks, ask to fill in the missing values

HISTORY / SOCIAL STUDIES:
  • "sequence-the-events" — list 4–6 events in shuffled order, ask to number them chronologically
  • "match-the-person-or-term" — list people/terms on the left, descriptions on the right (shuffled), ask to match
  • "cause-and-effect-chain" — give a starting event, ask to list 3 effects in order
  • "true-or-false-with-correction" — give 4–6 statements, mark T/F and correct the false ones
  • "fill-in-the-blank" — give a paragraph with 3–5 key words removed

BUSINESS / ECONOMICS / FINANCE:
  • "calculate" — financial calculation using numbers from the content
  • "decision-scenario" — present a realistic situation, ask what decision should be made and why (2–3 bullet points only)
  • "match-the-term" — business terms matched to definitions
  • "true-or-false-with-correction" — statements about the content
  • "spot-the-error" — show a plan or statement with one mistake

WRITING / LANGUAGE / GRAMMAR:
  • "correct-the-errors" — show a short passage with mistakes, ask to identify and fix them
  • "fill-in-the-blank" — sentence completion using vocabulary from the content
  • "match-the-definition" — vocabulary matching
  • "rewrite-the-sentence" — show a poorly written sentence, ask to rewrite it clearly
  • "identify-the-technique" — show a short extract, ask what writing technique is used

GENERAL / MIXED CONTENT:
  • "reflection-prompt" — a thoughtful question about how to apply a key idea from the content
  • "application-task" — a scenario where the audience applies a concept from the content
  • "challenge-question" — a harder synthesis question drawing multiple ideas together
  • "fill-in-the-blank" — key terms removed from a sentence about the content
  • "true-or-false-with-correction" — statements about the content

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3 — FORMAT RULES FOR THE "activity" FIELD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The "activity" field is WHAT THE LEARNER SEES AND WORKS WITH directly. Format it correctly:

- For all CODE tasks (find-the-bug, complete-the-code, write-the-code, trace-the-output, fix-and-explain):
  • Wrap every code block in <pre><code>…</code></pre> — do NOT use triple backticks.
  • After the code block, add a plain-English instruction line stating exactly what to do and what the expected output is.
  • For complete-the-code: mark blanks inside the code as [___] and state the expected output after the block.
  • For write-the-code: do NOT show any code — just write a clear requirement spec (2–4 lines), e.g.:
    "Write a Python function called add_numbers(a, b) that returns the sum of two numbers.\nExample: add_numbers(3, 5) should return 8."
  • For find-the-bug / fix-and-explain: show the full broken function — never just one isolated line.
  • For trace-the-output: show the full runnable snippet and ask "What does this print?"

- For MATCH tasks: ALWAYS include BOTH lists. Format exactly as:
  "Match these terms to their definitions:\n\nTerms:\n1. [term]\n2. [term]\n\nDefinitions:\nA. [definition — shuffled]\nB. [definition]"
  ⚠️ Definitions MUST be shuffled — correct answer must NOT be 1→A, 2→B in order.
- For SEQUENCE tasks: shuffled lettered list, e.g. "Put these in order:\n\nA. [step]\nB. [step]"
- For FILL-IN-THE-BLANK: show the sentence with blanks as [___]
- For TRUE-OR-FALSE: numbered statements, e.g. "Mark True or False:\n\n1. [statement]". Mix true and false.
- For CALCULATE / WORD-PROBLEM: present numbers and context as a clear scenario.
- For DECISION-SCENARIO: 3–5 bullet points, not prose.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ABSOLUTE RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- HANDS-ON FIRST. For coding content, every task must make the learner write, fix, or trace actual code — not describe what code does in prose.

- TEST THE SKILL, NOT THE CONTENT. ⚠️ This is the most important rule for coding tasks.
  The task must test the CODING MECHANIC being taught (e.g. how to write a print() statement, how to use a variable, how to write a for-loop) — NOT the subject matter facts that appear inside the code.
  BAD: "Write a script that prints three uses of Python: ML, data science, and automation." — This tests whether the learner memorised Python use cases, not whether they can write print().
  GOOD: "Write a Python statement that prints the text: Hello, World!" — This tests the print() mechanic directly.
  GOOD: "The following code should print a greeting but has a bug. Fix it:" — Tests debugging a print statement.
  GOOD: "What will this print() statement output?" — Tests understanding of the mechanic.
  Use content facts only for realistic variable names or context — never as the exam question itself.

- NO CONCEPTUAL-ONLY TASKS FOR CODING. Do not ask "What happens if you forget to add Python to PATH?" — instead show a concrete broken scenario and ask them to fix it in code or terminal commands.
- NO SOURCE REFERENCES. Never write "the source says", "the video mentions", "the transcript", "the installation notes", "review the notes", or any similar phrase. Every task is 100% self-contained.
- SELF-CONTAINED. Include ALL information the learner needs inside the activity field. Never assume they have a video or notes open.
- NO ESSAY TASKS. Never use "answerFormat": "A short paragraph" or "A short essay".
- NO REPETITION. Never use the same task format twice in a row.
- MATCH TASKS MUST BE COMPLETE. Equal number of terms and definitions.
- CODE QUALITY. Every code snippet must be syntactically correct except for the intentional bug/blank. Use realistic variable names from the topic.

${UNIVERSAL_REVIEW_NOTE_RULES}

Target audience: ${audience}. ${diffInstruction}

${hintInstruction}

Generate exactly ${count ?? 8} activities total. ${analysis && analysis.keyTopics.length > 1
  ? `Create one section per key topic from the Coverage Blueprint above — every topic that appears in the blueprint MUST become its own section with at least one task. Do NOT merge topics into a single section. Section titles must match the topic names from the blueprint.`
  : (count ?? 8) > 4 ? 'Group related activities into 2–3 thematic sections.' : 'Put all activities in a single section.'} ${base}${src}

Return JSON shaped EXACTLY as follows:
{
  "title": "Audience Practice Activities: [specific topic from the content]",
  "description": "One sentence: what skills audience members will practise",
  "modules": [
    {
      "title": "Section name — specific subtopic",
      "objective": "One sentence: what audience members will be able to do after this section",
      "lessonNotes": "",
      "examples": "",
      "flashcards": [],
      "quizQuestions": [],
      "practiceTasks": [
        {
          "title": "Active task name (e.g. 'Fix the Broken Loop', 'Complete the add() Function', 'Trace the Output')",
          "topic": "The specific coding concept or skill being practised",
          "difficulty": "beginner | intermediate | challenge",
          "description": "1–2 sentences telling the learner exactly what to do. Be direct.",
          "activity": "The structured content — code in <pre><code>, spec for write-the-code, or structured text for other formats. NEVER a wall of prose.",
          "answerFormat": "The precise format: e.g. 'The corrected line of code' / 'A complete Python function' / 'The printed output value'",
          "hint": "${includeHints ? 'A 1–2 sentence nudge pointing to the right concept without revealing the answer' : ''}",
          "reviewNote": "Follow REVIEW NOTE RULES above. The specific concept, rule, formula, or syntax the learner needs if stuck — not the task topic. Include a micro-example or formula where applicable.",
          "answerKey": "The complete correct answer — full corrected code, output value, or solution. For code: wrap in <pre><code>.",
          "explanation": "2–3 sentences explaining WHY this is the correct answer and what concept it reinforces.",
          "incorrectFeedback": "Encouraging 1–2 sentences pointing to the specific mistake and what to focus on."
        }
      ]
    }
  ],
  "learningGoals": ["3–5 specific skills audience members practised by completing these activities"],
  "finalProject": {"title": "", "description": "", "deliverables": []},
  "creatorImprovementNotes": "Brief note on how these activities could be extended or made harder",
  "shareText": "Short social caption for the creator's platform"
}`,
    };
  }

  // ── Branded Content Guide ──────────────────────────────────────────────────
  if (contentType === 'branded_guide') {
    const analysisBlock = analysis ? `\n\n${formatAnalysisBlock(analysis)}` : '';
    return {
      system,
      user: `Create a comprehensive Branded Content Guide for a creator's audience from the source content. ${ctx} ${base}${analysisBlock}${src}

This is a polished, branded guide that belongs to the creator — not a generic template. Write it as an expert explaining the topic directly and confidently.

The output must be a single JSON object shaped EXACTLY as follows. Every field is required. Base all content directly on the source — never use placeholders.

{
  "title": "Specific guide title based on the content",
  "description": "One sentence: what this guide covers and who it is for",
  "learningGoals": ["3–5 specific outcomes the audience will achieve"],
  "shareText": "Short social caption for the creator's platform",
  "creatorImprovementNotes": "",
  "finalProject": {"title": "", "description": "", "deliverables": []},
  "modules": [
    {
      "title": "Root module — same as guide title",
      "objective": "",
      "lessonNotes": "",
      "examples": "",
      "flashcards": [],
      "quizQuestions": [],
      "practiceTasks": [],
      "pdfPack": {
        "title": "Same as guide title",
        "description": "Same as guide description",
        "topicOverview": "2–3 sentences explaining what this topic is, why it matters, and what the guide covers",
        "learningObjectives": ["3–5 measurable things the audience will be able to do"],
        "requiredBackground": ["2–4 things the audience should already know before starting"],
        "sections": [
          {
            "id": "s1",
            "title": "Section title — specific concept or subtopic",
            "overview": "One sentence: what this section covers",
            "prerequisites": ["Any prior knowledge needed for this section"],
            "notes": "400–600 words of well-structured prose. Use ### subheadings, bullet points, numbered lists, and bold for key terms. Cover: definitions, important facts, rules/formulas/processes/frameworks. Write directly and confidently — no 'the source says'.",
            "keyPoints": ["5–8 key facts, rules, or formulas from this section — each a single crisp sentence"],
            "keyTerms": [
              {
                "term": "Term name",
                "definition": "Clear, simple definition in 1–2 sentences",
                "example": "A concrete real-world example or application"
              }
            ],
            "workedExamples": [
              {
                "title": "Example title describing the problem",
                "steps": [
                  {"step": "What to do in this step", "reason": "Why this step is necessary"}
                ],
                "commonMistake": "The most common error and how to avoid it"
              }
            ],
            "comparisonTable": {
              "labelA": "Concept A name",
              "labelB": "Concept B name",
              "rows": [
                {"aspect": "Definition", "optionA": "...", "optionB": "..."},
                {"aspect": "When to use", "optionA": "...", "optionB": "..."},
                {"aspect": "Advantage", "optionA": "...", "optionB": "..."},
                {"aspect": "Disadvantage", "optionA": "...", "optionB": "..."}
              ]
            },
            "reviewQuestions": [
              {"question": "Short-answer question testing recall", "answer": "Model answer", "sectionRef": "s1"},
              {"question": "Concept-check question", "answer": "Model answer", "sectionRef": "s1"},
              {"question": "Application question", "answer": "Model answer", "sectionRef": "s1"}
            ],
            "reviewNote": "Follow REVIEW NOTE RULES. The single most important concept, rule, or formula a reader must understand to grasp this section — with a micro-example or formula snippet where relevant."
          }
        ],
        "summary": {
          "mainTakeaways": ["5–7 main takeaways from the entire guide"],
          "importantFormulas": ["Any key formulas, rules, or frameworks to remember — write 'None' if not applicable"],
          "mustRemember": ["5–8 items for the 'What you must remember' checklist"]
        }
      }
    }
  ]
}

${UNIVERSAL_REVIEW_NOTE_RULES}

RULES:
- Create 3–5 sections inside pdfPack.sections. Each section covers one distinct subtopic.
- comparisonTable is REQUIRED for at least one section where two related concepts can be meaningfully compared. Set to null for sections where no comparison applies.
- Every section must have at least 2 keyTerms, 1 workedExample with at least 3 steps, and 3 reviewQuestions.
- notes must be substantive — 400–600 words minimum per section.
- Never write "the source says", "the video mentions", or any similar phrase anywhere.
- Never use the word "student", "pupil", or "course". Use "audience", "reader", or "creator's audience" instead.`,
    };
  }

  // ── Branded Resource Page ──────────────────────────────────────────────────
  if (contentType === 'resource_page') {
    const analysisBlock = analysis ? `\n\n${formatAnalysisBlock(analysis)}` : '';
    return {
      system,
      user: `Create a Branded Resource Page content structure from the source content. ${ctx} ${base}${analysisBlock}${src}

Each section must cover ONE distinct concept or topic from the source. Write the content as an expert explaining the concept directly to the creator's audience — never say "the source says", "the video mentions", or any similar phrase. Just explain the concept clearly and confidently in your own words.

Return JSON:
{
  "title": "Branded Resource: [specific topic name]",
  "description": "A one-sentence summary of what this resource covers for the creator's audience",
  "modules": [
    {
      "title": "Specific concept name — 3–6 words, e.g. 'How Stocks Generate Returns'",
      "objective": "One clear sentence explaining what this concept is",
      "lessonNotes": "MAXIMUM 120 words — no more. Explain this concept as a knowledgeable expert. Write directly and confidently. No 'the source says', no 'the video mentions'. Plain prose only, no bullet points. Stop at 120 words.",
      "reviewNote": "Follow REVIEW NOTE RULES. The specific concept, rule, or formula someone needs to understand before this section makes sense — with a micro-example where relevant.",
      "examples": "IMAGEQUERY:[A single precise Wikipedia-style search term that would find a relevant diagram, photo, or illustration for this exact concept. Examples: 'stock market graph', 'photosynthesis diagram', 'solar panel installation', 'DNA double helix', 'supply demand curve']",
      "flashcards": [],
      "quizQuestions": [],
      "practiceTasks": []
    }
  ],
  "learningGoals": ["3–5 things the audience will understand after reading this resource"],
  "finalProject": {"title": "", "description": "", "deliverables": []},
  "creatorImprovementNotes": "",
  "shareText": "Short social caption for the creator's platform"
}

${UNIVERSAL_REVIEW_NOTE_RULES}

STRICT RULES:
- 4–8 sections total, one concept per section only.
- lessonNotes must NEVER contain "the source", "the video", "the transcript", "the content", "highlights", "mentions", "describes", or "presents".
- examples field must contain exactly "IMAGEQUERY:" followed by one precise search term.
- No flashcards, no quizQuestions, no practiceTasks.
- Never use the word "student", "course", or "class". Use "audience", "reader", or "section" instead.`,
    };
  }

  // Fallback (should not be reached)
  return { system, user: '' };
}

// ── Answer-position shuffler ──────────────────────────────────────────────────

function shuffleQuestionChoices(q: QuizQuestion): QuizQuestion {
  if (q.type === 'true_false') return q;
  if (!q.choices?.length) return q;

  const indices = q.choices.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  const newChoices = indices.map(i => q.choices[i]);

  if (q.type === 'multiple_select') {
    const oldCorrect = new Set(q.correctAnswers ?? []);
    const newCorrectAnswers = indices
      .map((oldIdx, newIdx) => (oldCorrect.has(oldIdx) ? newIdx : -1))
      .filter(i => i !== -1);
    return { ...q, choices: newChoices, correctAnswers: newCorrectAnswers };
  }

  const newCorrectAnswer = indices.indexOf(q.correctAnswer);
  return { ...q, choices: newChoices, correctAnswer: newCorrectAnswer };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      input: GeneratorInput;
      userId?: string;
      // client-side extras applied to the saved row
      brandKit?: Record<string, unknown>;
      flashcardOptions?: Record<string, unknown>;
      quizConfig?: Record<string, unknown>;
      taskConfig?: Record<string, unknown>;
      generateImages?: boolean;
      creatorUsername?: string;
      slug?: string;
    };
    const { input } = body;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey?.startsWith('sk-')) {
      return NextResponse.json({ error: 'Service is not configured. Contact the administrator.' }, { status: 503 });
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Database service key is not configured.' }, { status: 503 });
    }
    const sbUrl        = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // ── Resolve user server-side from the Auth0 session cookie ───────────────
    let userId: string | null = null;
    try {
      const auth0User = await getAuth0User();
      userId = auth0User?.id ?? null;
    } catch {
      // session read failed
    }
    // Fallback: accept userId from body (for backward compat)
    if (!userId && body.userId) userId = body.userId;

    // Must be authenticated — we need userId to save the course.
    // Without it the row is never written and the redirect lands on "Not found".
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated. Please sign in and try again.' }, { status: 401 });
    }

    // ── Enforce 3-day Standard generation limit ───────────────────────────────
    {
      const { data: genCount } = await supabaseRpc(sbUrl, sbServiceKey, 'count_gen_quota_3days', { p_user_id: userId });
      const used = (genCount as number | null) ?? 0;
      if (used >= DAILY_GENERATION_LIMIT) {
        return NextResponse.json(
          { error: `You've used all ${DAILY_GENERATION_LIMIT} generations for this 3-day window. Come back in a few days!` },
          { status: 429 },
        );
      }
    }

    // ── Pick model tier (always standard) ────────────────────────────────────
    const tier = GENERATION_TIERS.find(t => t.id === 'standard')!;

    // ── Step 1: analyse content to extract key topics ────────────────────────
    const analysis = await analyzeContent(input.transcript, input.supplemental, apiKey, tier.model);

    // ── Step 2: build the main generation prompt using the analysis ───────────
    const { system, user } = buildPrompt(input, analysis);

    const data = await openaiPost(apiKey, '/v1/chat/completions', {
      model: tier.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_completion_tokens: input.options.contentType === 'branded_guide' ? 16000
        : input.options.contentType === 'activities' ? 10000
        : input.options.contentType === 'quiz'       ? 10000
        : 8000,
    }) as { choices: Array<{ message: { content: string } }> };
    const raw = data.choices[0].message.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(raw);

    const modules: Module[] = (parsed.modules ?? []).map((m: Omit<Module, 'id'> & {
      flashcards?: Omit<Flashcard, 'id'>[];
      quizQuestions?: Omit<QuizQuestion, 'id'>[];
      practiceTasks?: Omit<PracticeTask, 'id'>[];
    }) => ({
      ...m, id: uid(),
      flashcards: (m.flashcards ?? []).map((f: Omit<Flashcard, 'id'>) => ({ ...f, id: uid() })),
      quizQuestions: (m.quizQuestions ?? []).map((q: Omit<QuizQuestion, 'id'>) => shuffleQuestionChoices({ ...q, id: uid() })),
      practiceTasks: (m.practiceTasks ?? []).map((t: Omit<PracticeTask, 'id'>) => ({ ...t, id: uid() })),
    }));

    const course = blankCourse({
      title: parsed.title ?? 'Untitled',
      description: parsed.description ?? '',
      contentType: input.options.contentType,
      learnerLevel: input.options.learnerLevel,
      learningGoals: parsed.learningGoals ?? [],
      modules,
      finalProject: parsed.finalProject ?? { title: '', description: '', deliverables: [] },
      creatorImprovementNotes: parsed.creatorImprovementNotes ?? '',
      shareText: parsed.shareText ?? '',
      ...(input.options.contentType === 'activities' && input.options.taskConfig
        ? { taskConfig: input.options.taskConfig }
        : {}),
      // Apply client-supplied extras (brand kit, config, flags)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(body.brandKit         ? { brandKit:         body.brandKit as any } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(body.flashcardOptions ? { flashcardOptions: body.flashcardOptions as any } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(body.quizConfig       ? { quizConfig:       body.quizConfig as any } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(body.taskConfig       ? { taskConfig:       body.taskConfig as any } : {}),
      ...(body.generateImages   != null ? { generateImages: body.generateImages } : {}),
      ...(body.creatorUsername  ? { creatorUsername:  body.creatorUsername } : {}),
    });

    // Resolve slug after course is built so we can fall back to course.title
    if (body.slug !== undefined) {
      course.slug = body.slug
        || course.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60)
        || course.id;
      course.status = 'published';
    }

    // ── Save to Supabase before responding so the browser never needs to ──────
    // call dbSaveCourse after navigation (which gets aborted by the page change).
    // userId is guaranteed non-null here (checked above).
    {
      const row = {
        id:                        course.id,
        owner_id:                  userId,
        title:                     course.title,
        description:               course.description,
        content_type:              course.contentType,
        learner_level:             course.learnerLevel,
        status:                    course.status,
        slug:                      course.slug ?? null,
        share_text:                course.shareText,
        creator_improvement_notes: course.creatorImprovementNotes,
        views:                     course.views,
        completions:               course.completions,
        learning_goals:            course.learningGoals,
        modules:                   course.modules,
        final_project:             course.finalProject,
        flashcard_options:         course.flashcardOptions ?? null,
        quiz_config:               course.quizConfig ?? null,
        task_config:               course.taskConfig ?? null,
        creator_username:          course.creatorUsername ?? null,
        generate_images:           course.generateImages ?? null,
        brand_kit:                 course.brandKit ?? null,
        updated_at:                new Date().toISOString(),
      };
      // Use node:https directly — Supabase JS client uses globalThis.fetch which
      // Next.js patches to abort after the incoming request signal fires ("fetch failed").
      let { error: saveError } = await supabaseUpsert(sbUrl, sbServiceKey, 'courses', row);
      if (saveError?.message?.includes('brand_kit')) {
        const { brand_kit: _d, ...rowWithout } = row;
        void _d;
        ({ error: saveError } = await supabaseUpsert(sbUrl, sbServiceKey, 'courses', rowWithout));
      }
      if (saveError) {
        console.error('[generate] save course', saveError.message);
        return NextResponse.json({ error: `Save failed: ${saveError.message}` }, { status: 500 });
      }
    }

    // ── Increment generation quota on success ─────────────────────────────────
    await supabaseRpc(sbUrl, sbServiceKey, 'increment_gen_quota', { p_user_id: userId });

    return NextResponse.json({ course, tier: tier.id });

  } catch (err: unknown) {
    const message = err instanceof SyntaxError
      ? 'AI returned invalid JSON. Try again.'
      : err instanceof Error ? err.message : 'Generation failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

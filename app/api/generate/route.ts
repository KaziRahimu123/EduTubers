import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { request as nodeHttpsRequest } from 'node:https';
import { getAuth0User } from '@/lib/auth0-session';
import type { GeneratorInput, Module, Flashcard, QuizQuestion, PracticeTask, Course, QuizConfig, PracticeTaskConfig } from '@/lib/types';
import { GENERATION_TIERS, DAILY_GENERATION_LIMIT } from '@/lib/types';
import { cleanTitle } from '@/lib/cleanTitle';

// ── IBM watsonx.ai IAM token fetch (node:https, signal-free) ─────────────────
function fetchIamToken(apiKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = `grant_type=urn%3Aibm%3Aparams%3Aoauth%3Agrant-type%3Aapikey&apikey=${encodeURIComponent(apiKey)}`;
    const req = nodeHttpsRequest(
      {
        hostname: 'iam.cloud.ibm.com',
        path:     '/identity/token',
        method:   'POST',
        headers: {
          'Content-Type':   'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if ((res.statusCode ?? 200) >= 400) {
            reject(new Error(`IAM token error ${res.statusCode}: ${text}`));
            return;
          }
          try {
            const parsed = JSON.parse(text) as { access_token: string };
            resolve(parsed.access_token);
          } catch {
            reject(new Error('IAM returned invalid JSON'));
          }
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

// ── IBM Granite text generation via watsonx.ai (node:https) ──────────────────
function granitePost(
  watsonxUrl: string,
  projectId: string,
  accessToken: string,
  modelId: string,
  prompt: string,
  maxNewTokens: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const bodyObj = {
      model_id: modelId,
      project_id: projectId,
      input: prompt,
      parameters: {
        decoding_method: 'greedy',
        max_new_tokens: maxNewTokens,
        repetition_penalty: 1.05,
      },
    };
    const bodyStr = JSON.stringify(bodyObj);
    const parsed  = new URL(`${watsonxUrl}/ml/v1/text/generation?version=2023-05-29`);
    const req = nodeHttpsRequest(
      {
        hostname: parsed.hostname,
        port:     443,
        path:     `${parsed.pathname}${parsed.search}`,
        method:   'POST',
        headers: {
          'Content-Type':   'application/json',
          Authorization:    `Bearer ${accessToken}`,
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if ((res.statusCode ?? 200) >= 400) {
            // Surface a distinct error for the "project not linked to WML" 403
            // so callers can skip the Granite path without retrying.
            if (res.statusCode === 403 && text.includes('no_associated_service_instance')) {
              reject(new Error('GRANITE_NO_WML_INSTANCE'));
            } else {
              reject(new Error(`Granite error ${res.statusCode}: ${text}`));
            }
            return;
          }
          try {
            const data = JSON.parse(text) as { results?: Array<{ generated_text: string }> };
            resolve(data.results?.[0]?.generated_text ?? '');
          } catch {
            reject(new Error('Granite returned invalid JSON'));
          }
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(bodyStr);
  });
}

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

// ── Server-side slug generation with collision check ─────────────────────────
// Called just before INSERT so the uniqueness check and the write are as close
// together as possible, eliminating the client-side race where two parallel
// generate requests receive the same slug from make_slug and then race to save.
function makeUniqueSlug(
  url: string,
  serviceKey: string,
  title: string,
  excludeId?: string,
): Promise<string> {
  const base = title.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60) || 'deck';

  return new Promise((resolve) => {
    // Fetch all existing slugs to find a free one.
    const qs = excludeId
      ? `select=slug&slug=not.is.null&id=neq.${encodeURIComponent(excludeId)}`
      : `select=slug&slug=not.is.null`;
    const parsed = new URL(`${url}/rest/v1/courses?${qs}`);
    const req = nodeHttpsRequest(
      {
        hostname:   parsed.hostname,
        port:       443,
        servername: parsed.hostname,
        path:       `${parsed.pathname}${parsed.search}`,
        method:     'GET',
        headers: {
          apikey:        serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Accept:        'application/json',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const rows = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Array<{ slug: string }>;
            const taken = new Set(rows.map(r => r.slug).filter(Boolean));
            let slug = base;
            let n = 2;
            while (taken.has(slug)) { slug = `${base}-${n}`; n++; }
            resolve(slug);
          } catch {
            // Fallback: append a short random suffix so the INSERT never conflicts
            resolve(`${base}-${Date.now().toString(36)}`);
          }
        });
        res.on('error', () => resolve(`${base}-${Date.now().toString(36)}`));
      },
    );
    req.on('error', () => resolve(`${base}-${Date.now().toString(36)}`));
    req.end();
  });
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

// Set to true the first time we get a GRANITE_NO_WML_INSTANCE error so that
// subsequent requests in the same process lifetime skip the IAM + Granite round-trip.
let _graniteNoWml = false;

// ── Stage 1: full-source analysis with IBM Granite 3.0 ───────────────────────
// Reads 100% of the transcript across Granite's 128K context window.
// Returns a comprehensive JSON blueprint that Stage 2 (GPT) uses for generation.
async function analyzeContent(
  transcript: string,
  supplemental: string,
  _openaiKey: string,   // kept for signature compat, not used in Stage 1
  _model: string,       // kept for signature compat, not used in Stage 1
): Promise<ContentAnalysis | null> {
  // Short-circuit: project is not linked to a WML instance — skip every call
  // for the rest of this process lifetime to avoid burning IAM + network time.
  if (_graniteNoWml) return null;

  const watsonxApiKey = process.env.WATSONX_API_KEY;
  const watsonxProjectId = process.env.WATSONX_PROJECT_ID;
  const watsonxUrl = process.env.WATSONX_URL;

  // If watsonx credentials are missing, fall back to null (GPT skips analysis)
  if (!watsonxApiKey || !watsonxProjectId || !watsonxUrl) {
    console.warn('[analyzeContent] WATSONX credentials not set — skipping Granite analysis.');
    return null;
  }

  try {
    const accessToken = await fetchIamToken(watsonxApiKey);

    // Pass the FULL transcript — no truncation — Granite 3.0 has 128K context.
    const extra = supplemental ? `\n\nSUPPLEMENTAL MATERIAL:\n${supplemental}` : '';
    const src   = `${transcript}${extra}`;

    const prompt = `<|system|>
You are a senior curriculum analyst. Return ONLY valid JSON — no markdown, no code fences.
<|user|>
Read the ENTIRE educational content below from start to finish. Extract every distinct, substantive topic that receives real coverage. This blueprint will drive exact section/question/card counts in the final output — precision is critical.

CONTENT:
${src}

Return JSON exactly as:
{
  "domain": "The precise subject domain (e.g. 'Python Programming', 'Personal Finance', 'Cell Biology')",
  "keyTopics": [
    {
      "topic": "Exact topic name as taught in the content — not a generic label",
      "description": "One sentence: what specifically this topic explains, demonstrates, or argues",
      "subtopics": ["specific sub-concept 1", "specific sub-concept 2", "specific sub-concept 3"],
      "keyFacts": ["A concrete fact, rule, formula, or skill from this topic", "Another distinct fact", "A third distinct fact"],
      "weight": 2
    }
  ],
  "conceptsToTest": ["Specific testable concept 1", "Specific testable concept 2"],
  "difficultySignals": "One sentence describing assumed prior knowledge and complexity level",
  "suggestedTitle": "A short, specific title for a learning asset on this content"
}

EXTRACTION RULES — non-negotiable:
1. Scan the FULL source — beginning, middle, AND end. Do not bias toward opening paragraphs.
2. List EVERY topic that receives substantive, non-trivial coverage — typically 5–12 topics for a 10–30 min source.
3. NEVER include generic filler entries: no "Introduction", "Overview", "Conclusion", "Summary", "Recap", "What We Covered", or "Next Steps" unless that segment teaches entirely new, standalone facts.
4. Each topic in keyTopics must be DISTINCT — no two topics should substantially overlap.
5. subtopics: 2–4 specific sub-concepts per topic (concrete terms, not "basics" or "examples").
6. keyFacts: 2–4 specific, concrete facts, rules, formulas, or skills per topic — things a learner can be directly tested on.
7. weight: 1 = briefly covered (1–2 min), 2 = moderate depth (3–5 min), 3 = core focus (5+ min or repeated emphasis).
8. conceptsToTest: list up to 20 granular, actionable items — what a learner should be able to DO or EXPLAIN after this source.
9. The total number of keyTopics is your authoritative count N. The generation stage will create exactly N sections — so make every entry count and omit nothing real.
<|assistant|>
`;

    const rawText = await granitePost(
      watsonxUrl,
      watsonxProjectId,
      accessToken,
      process.env.WATSONX_MODEL_ID || 'ibm/granite-3-8b-instruct',
      prompt,
      3000,
    );

    const raw = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    return JSON.parse(raw) as ContentAnalysis;
  } catch (err) {
    if (err instanceof Error && err.message === 'GRANITE_NO_WML_INSTANCE') {
      _graniteNoWml = true;
      console.warn('[analyzeContent] Granite project has no WML instance — disabling Granite for this session. Fix: associate a WML service instance with project', watsonxProjectId);
    } else {
      console.error('[analyzeContent] Granite stage failed:', err instanceof Error ? err.message : err);
    }
    return null;
  }
}

// ── Format analysis as an enforced coverage blueprint ────────────────────────

// itemCount is kept for quiz/activity fixed-count modes; ignored when null (AI mode).
function formatAnalysisBlock(analysis: ContentAnalysis, itemCount?: number): string {
  // Sort topics by weight descending so high-weight topics appear first
  const sorted = [...analysis.keyTopics].sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1));
  const N = sorted.length;

  // When a fixed itemCount is given, compute a weight-proportional per-topic allocation.
  // In AI (dynamic) mode, itemCount is undefined — each topic gets exactly 1 section/item.
  const totalWeight = sorted.reduce((s, t) => s + (t.weight ?? 1), 0);
  const topicsText = sorted.map((t, i) => {
    const allocation = itemCount
      ? Math.max(1, Math.round(((t.weight ?? 1) / totalWeight) * itemCount))
      : 1; // dynamic mode: exactly 1 section per topic
    const allocationStr = itemCount
      ? ` → generate ${allocation} item${allocation > 1 ? 's' : ''} for this topic`
      : ' → generate EXACTLY 1 section for this topic';
    return [
      `  ${i + 1}. [${t.weight === 3 ? 'CORE' : t.weight === 2 ? 'IMPORTANT' : 'SUPPORTING'}] ${t.topic}${allocationStr}`,
      `     What it covers: ${t.description}`,
      `     Sub-concepts: ${t.subtopics.join(' | ')}`,
      `     Key facts: ${t.keyFacts.join(' | ')}`,
    ].join('\n');
  }).join('\n\n');

  const dynamicCountLine = itemCount
    ? `Fixed count mode: generate ${itemCount} items total, distributed across topics as indicated above.`
    : `Dynamic count mode: generate EXACTLY ${N} sections/modules/groups — one per topic listed above. No more, no fewer.`;

  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTENT BLUEPRINT — MANDATORY COVERAGE (${N} TOPICS → ${itemCount ?? N} OUTPUT SECTIONS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Domain: ${analysis.domain}
Difficulty: ${analysis.difficultySignals}
${dynamicCountLine}

TOPICS — generate output for EVERY one of these, in order:
${topicsText}

SPECIFIC CONCEPTS TO TEST (use these as the basis for individual items):
${analysis.conceptsToTest.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}

ANTI-FLUFF RULES — absolute, no exceptions:
1. Generate EXACTLY 1 section per topic listed. Do NOT merge topics. Do NOT split one topic into multiple sections.
2. Every item must teach or test a SPECIFIC fact, rule, formula, or skill from the keyFacts/subtopics above — no generic padding.
3. Do NOT generate content for topics NOT in this blueprint (no invented topics, no generic intros/outros).
4. Do NOT omit any topic — every entry above must appear in the output.
5. If two topics seem similar, keep them as separate sections — each covers different keyFacts.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`.trim();
}

// ── Anti-meta-trivia rule — injected into every prompt type ──────────────────
// Prevents gpt-5.4 from generating questions/cards about document structure,
// slide timing, presenter notes, future plans, or content metadata.

const ANTI_META_TRIVIA_RULES = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DOMAIN FOCUS RULES — absolute, no exceptions
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Focus 100% on domain principles, definitions, rules, and formulas.

FORBIDDEN — never generate any item that:
  🚫 Questions WHY something is shown, timed, or structured in the source material
     e.g. "Why does the guide show a guidance time?", "Why is this step highlighted?"
  🚫 Asks about future plans, upcoming features, or roadmap items mentioned in passing
     e.g. "What future device is planned?", "What will be added next?"
  🚫 References document/slide structure, metadata, or presentation choices
     e.g. "What is the purpose of the overview section?", "How many slides cover X?"
  🚫 Tests knowledge of the source FORMAT rather than the subject matter
     e.g. "What does the introduction say about...?", "According to the summary..."
  🚫 Repeats the same domain concept already covered by another item in the set

Every item front/question MUST test a real, substantive domain concept:
  a concrete definition, rule, formula, mechanism, process, or skill
  that a practitioner of this field would need to know.`.trim();

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
  // Pass the full transcript — Granite's blueprint already covers everything;
  // GPT uses it as grounding context with no artificial truncation.
  const src = `\n\nSOURCE CONTENT:\n${transcript}${supplemental ? `\n\nSUPPLEMENTAL:\n${supplemental}` : ''}`;
  const base = 'Base ALL content directly on the source material. Never use generic placeholders. Never reference "the video", "the transcript", "the source", or "the content" directly.';

  // Derive the exact section/item count from Granite's blueprint (N topics = N sections).
  // When Granite is unavailable, gpt-5.4 has full autonomy — no hardcoded fallback count.
  const topicCount = analysis?.keyTopics?.length ?? 0;
  const aiCountInstruction = topicCount > 0
    ? `The Content Blueprint above lists exactly ${topicCount} distinct topics. Generate EXACTLY ${topicCount} sections/modules — one per topic, no merging, no splitting, no additions. Every section must be grounded in that topic's keyFacts and sub-concepts. Zero filler.`
    : `Analyse the full source content yourself. Identify every distinct, substantive topic that receives real coverage. Generate exactly one section per topic — as many as the content warrants. Do not add generic intro/outro/summary sections. Do not pad. Do not artificially limit the count.`;

  // Injected into every prompt: forbid any prefix in the title field.
  const NO_PREFIX_TITLE_RULE = 'TITLE RULE — absolute: The "title" field must contain ONLY the clean subject name (e.g. \'Python Programming Foundations\', \'Personal Finance Basics\'). NEVER prefix it with "Branded Resource:", "Branded Guide:", "Branded Content Guide:", "Illustrated Explainer:", "Resource Page:", or any other label. If you include a prefix the output will be rejected.';

  const system = 'You are an expert content strategist and creator assistant. Return ONLY valid JSON — no markdown, no code fences, no explanation.';

  // ── Quick Review Cards ────────────────────────────────────────────────────
  if (contentType === 'review_cards') {
    const { flashcardCount } = options;
    const isAi = flashcardCount === undefined || flashcardCount === 0 || (flashcardCount as unknown) === 'ai';
    const analysisBlock = analysis ? `\n\n${formatAnalysisBlock(analysis)}` : '';

    // Fixed count: spread evenly across however many modules GPT decides to use.
    // AI count: analyse ALL topics, pick the most important ones, hard cap at 25 cards.
    const countInstruction = isAi
      ? `CARD COUNT: Analyse every topic in the source. Identify the most important concepts a learner must know. Generate between 12 and 25 cards in total — NEVER exceed 25. Prioritise the highest-impact concepts; if there are more than 25 candidates, select the 25 most essential and discard the rest. Every card must cover a distinct concept; never repeat the same idea twice.`
      : `CARD COUNT: Generate exactly ${Math.min(flashcardCount as number, 25)} cards in total, distributed evenly across modules.`;

    return {
      system,
      user: `You are creating a high-quality Quick Review flashcard deck for a creator's audience. Your job is to distil the source into a clean, high-density deck of self-contained cards that learners can actually study from.

${ctx} ${base}${analysisBlock}${src}

${ANTI_META_TRIVIA_RULES}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MODULE STRUCTURE — mandatory
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Group all cards into 1 to 3 high-level thematic modules. Choose module titles that reflect natural phases of the subject — for example:
  • "Foundations" / "Core Concepts" / "Advanced Applications"
  • "Part 1: Basics" / "Part 2: Techniques" / "Part 3: Mastery"
  • A single module named after the subject itself when content is focused

Rules:
- NEVER create more than 3 modules. If the source is narrow/focused, use 1 module.
- NEVER create a separate module per card or per minor subtopic.
- Distribute cards roughly evenly across modules — no module should have fewer than 3 cards unless it is the only module.
- Module titles must be broad, meaningful groupings — NOT verbatim topic names from the blueprint.

${countInstruction}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CARD QUALITY RULES — mandatory for every card
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- front: a clear term, concept name, or direct question — MAX 10 words. No filler words.
- back: a clear, accurate 1–2 sentence definition or explanation — MAX 25 words. State the answer directly and confidently.
- Every card must test exactly ONE self-contained domain concept, definition, rule, formula, or mechanism.
- Cards must be self-contained — a learner studying this card alone should be able to understand it without context.
- NEVER create cards about document/presentation structure, slide timing, or source metadata.
- NEVER write vague or generic cards (e.g. "What is the topic?", "Name an example.").
- NEVER repeat the same concept across two cards.

Good examples:
  { "front": "What is a stock?", "back": "A share of ownership in a company, entitling the holder to a portion of profits and assets." }
  { "front": "Compound interest formula", "back": "A = P(1 + r/n)^nt — interest calculated on principal plus previously earned interest." }
  { "front": "What does DNS stand for?", "back": "Domain Name System — translates human-readable domain names into IP addresses." }

Bad examples (banned):
  { "front": "What are all the types of investments mentioned?", "back": "There are stocks, bonds, ETFs discussed." }
  { "front": "Why does the guide show guidance time?", "back": "To help learners plan their study." }

${UNIVERSAL_REVIEW_NOTE_RULES}

${NO_PREFIX_TITLE_RULE}

Return valid JSON in EXACTLY this shape — nothing else:
{
  "title": "Clean subject name only — e.g. 'Python Programming Foundations', 'Personal Finance Basics'. No prefix.",
  "description": "One sentence: what domain concepts this deck covers and who it is for.",
  "modules": [
    {
      "title": "Module name — a broad thematic grouping (e.g. 'Foundations', 'Core Principles')",
      "objective": "",
      "lessonNotes": "",
      "examples": "",
      "flashcards": [
        {
          "front": "Term or question — max 10 words",
          "back": "Definition or answer — max 25 words, 1–2 sentences",
          "reviewNote": "Follow REVIEW NOTE RULES. The specific concept, rule, or formula to look up if this card is confusing."
        }
      ],
      "quizQuestions": [],
      "practiceTasks": []
    }
  ],
  "learningGoals": ["3–5 specific domain concepts the audience will understand after studying this deck"],
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
    // In AI mode, count = blueprint topics capped at 25; human custom capped at 50.
    const rawCount  = typeof cfg?.questionCount === 'number' ? cfg.questionCount : (isAiCount ? null : (topicCount > 0 ? topicCount : null));
    const count     = rawCount !== null ? Math.min(rawCount, isAiCount ? 25 : 50) : null;
    const types     = cfg?.questionTypes ?? ['multiple_choice', 'true_false', 'multiple_select'];
    const title     = cfg?.quizTitle ? `The quiz title must be exactly: "${cfg.quizTitle}".` : 'Choose an appropriate quiz title from the content.';
    const analysisBlock = analysis ? `\n\n${formatAnalysisBlock(analysis, isAiCount ? undefined : (count ?? undefined))}` : '';
    const countInstruction = isAiCount
      ? (analysis
          ? `DYNAMIC COUNT: ${aiCountInstruction} Write one question per topic — distribute question types evenly. HARD CAP: never exceed 25 questions total.`
          : `Analyse the full source content. Identify every distinct, substantive topic. Write exactly one question per topic — up to 25 questions maximum. Never exceed 25.`)
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

${ANTI_META_TRIVIA_RULES}

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
- Distribute correctAnswer values roughly evenly across all questions: some 0s, some 1s, some 2s, some 3s.

${NO_PREFIX_TITLE_RULE}

Return JSON:
{
  "title": "The actual subject name only — e.g. 'Python Fundamentals Quiz'. No prefix.",
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
    // AI mode: no cap (AI judges from content). Custom/preset: hard cap at 15.
    const count       = taskCfg
      ? (taskCfg.taskCount === 'custom'
          ? Math.min(taskCfg.customTaskCount ?? topicCount ?? 15, 15)
          : (isAiCount ? null : Math.min(typeof taskCfg.taskCount === 'number' ? taskCfg.taskCount : (topicCount > 0 ? topicCount : 15), 15)))
      : (topicCount > 0 ? topicCount : null);
    const includeHints = taskCfg?.includeHints ?? true;
    const analysisBlock = analysis ? `\n\n${formatAnalysisBlock(analysis, isAiCount ? undefined : (typeof count === 'number' ? count : undefined))}` : '';
    const taskCountInstruction = isAiCount
      ? (analysis
          ? `DYNAMIC COUNT: ${aiCountInstruction} Create exactly one section per topic and place one task per section. Do NOT generate multiple tasks for one topic while skipping another.`
          : `Analyse the full source content. Identify every distinct, substantive topic. Create one section per topic with exactly one task — as many sections as the content warrants. No artificial cap. Do not pad with filler tasks.`)
      : `Generate exactly ${count} activities — one section per key topic, tasks spread evenly. Do not cluster multiple tasks on the same topic while leaving others uncovered.`;

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

${ANTI_META_TRIVIA_RULES}

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

${analysis && analysis.keyTopics.length > 0
  ? `SECTION STRUCTURE — mandatory: Create EXACTLY ${analysis.keyTopics.length} sections — one per topic from the blueprint above. Section titles must match the blueprint topic names exactly. Do NOT merge topics. Do NOT split one topic across multiple sections. Do NOT add extra sections beyond the blueprint.`
  : 'Create one section per distinct topic you identify in the source. Do not add generic intro or summary sections.'} ${base}${src}

${NO_PREFIX_TITLE_RULE}

Return JSON shaped EXACTLY as follows:
{
  "title": "[specific topic from the content] — Practice Activities",
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

${ANTI_META_TRIVIA_RULES}

This is a polished, branded guide that belongs to the creator — not a generic template. Write it as an expert explaining the topic directly and confidently.

The output must be a single JSON object shaped EXACTLY as follows. Every field is required. Base all content directly on the source — never use placeholders.

${NO_PREFIX_TITLE_RULE}

{
  "title": "The actual subject name only — e.g. 'Personal Finance Fundamentals'. No prefix.",
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

SECTION COUNT RULES — mandatory:
- Create EXACTLY ${topicCount > 0 ? topicCount : 'as many'} sections inside pdfPack.sections — one per topic listed in the Content Blueprint above.${topicCount > 0 ? ` That is ${topicCount} section${topicCount > 1 ? 's' : ''} total.` : ' Generate as many sections as the content warrants — no hardcoded cap.'}
- Do NOT create fewer sections by merging topics. Do NOT create extra sections beyond the blueprint.
- Each section must cover ONE topic's keyFacts and subtopics — no generic "Introduction" or "Summary" sections.
- Keep section notes concise and high-density: 150–250 words per section so all topics fit within the output window without truncation.
- comparisonTable is REQUIRED for at least one section where two related concepts can be meaningfully compared. Set to null for sections where no comparison applies.
- Every section must have at least 2 keyTerms, 1 workedExample with at least 3 steps, and 3 reviewQuestions.
- Never write "the source says", "the video mentions", or any similar phrase anywhere.
- Never use the word "student", "pupil", or "course". Use "audience", "reader", or "creator's audience" instead.`,
    };
  }

  // ── Illustrated Explainer (resource_page) ─────────────────────────────────
  if (contentType === 'resource_page') {
    const analysisBlock = analysis ? `\n\n${formatAnalysisBlock(analysis)}` : '';
    return {
      system,
      user: `Create an Illustrated Explainer content structure from the source content. ${ctx} ${base}${analysisBlock}${src}

${ANTI_META_TRIVIA_RULES}

Each section must cover ONE distinct concept or topic from the source. Write the content as an expert explaining the concept directly to the creator's audience — never say "the source says", "the video mentions", or any similar phrase. Just explain the concept clearly and confidently in your own words.

Return JSON:
${NO_PREFIX_TITLE_RULE}

{
  "title": "[specific topic name — e.g. 'Python Programming Foundations', 'Personal Finance Basics'. NO prefix.]",
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
- Create EXACTLY ${topicCount > 0 ? topicCount : 'as many'} sections — one per topic from the Content Blueprint above.${topicCount > 0 ? ` That is ${topicCount} section${topicCount > 1 ? 's' : ''} total — no more, no fewer.` : ' Generate as many sections as the content warrants — no hardcoded cap. Match every distinct topic you identify.'}
- Do NOT merge topics. Do NOT add extra sections. Do NOT create generic "Introduction" or "Summary" sections.
- Each section's lessonNotes must be 150–250 words — dense and specific, grounded in that topic's keyFacts from the blueprint.
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
      // client-side extras applied to the saved row
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

    // ── Require a verified server-side Auth0 session ─────────────────────────
    // getAuth0User() reads the session cookie set by auth0.middleware — it is
    // not spoofable from the client. We do NOT fall back to body.userId because
    // that would let any caller impersonate an arbitrary user.
    const auth0User = await getAuth0User();
    const userId = auth0User?.id ?? null;

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

    // ── Stage 1: IBM Granite 3.0 full-source analysis (128K context, no truncation) ──
    // Granite reads 100% of the transcript/PDF and returns a comprehensive
    // topic blueprint covering the beginning, middle, AND end of the source.
    const analysis = await analyzeContent(input.transcript, input.supplemental, apiKey, tier.model);

    // ── Stage 2: GPT generation driven by Granite's full-coverage blueprint ──
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
      // Strip any title prefix from pdfPack.title saved in branded_guide modules
      ...(m.pdfPack ? { pdfPack: { ...m.pdfPack, title: cleanTitle(m.pdfPack.title ?? '') } } : {}),
    }));

    const course = blankCourse({
      title: cleanTitle(parsed.title ?? 'Untitled'),
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
      // Apply client-supplied extras (config, flags)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(body.flashcardOptions ? { flashcardOptions: body.flashcardOptions as any } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(body.quizConfig       ? { quizConfig:       body.quizConfig as any } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(body.taskConfig       ? { taskConfig:       body.taskConfig as any } : {}),
      ...(body.generateImages   != null ? { generateImages: body.generateImages } : {}),
      ...(body.creatorUsername  ? { creatorUsername:  body.creatorUsername } : {}),
    });

    // Resolve slug server-side, just before INSERT.
    // Generating the slug here (rather than trusting the client-supplied value)
    // eliminates the race condition where two parallel generate requests both
    // receive the same slug from /api/db make_slug and then collide on INSERT
    // with "duplicate key value violates unique constraint courses_slug_key".
    if (body.slug !== undefined) {
      course.slug = await makeUniqueSlug(sbUrl, sbServiceKey, course.title, course.id);
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
        updated_at:                new Date().toISOString(),
      };
      // Use node:https directly — Supabase JS client uses globalThis.fetch which
      // Next.js patches to abort after the incoming request signal fires ("fetch failed").
      const { error: saveError } = await supabaseUpsert(sbUrl, sbServiceKey, 'courses', row);
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

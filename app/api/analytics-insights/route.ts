/**
 * app/api/analytics-insights/route.ts
 *
 * POST /api/analytics-insights
 *
 * Accepts per-concept accuracy data from the analytics page and returns a
 * structured JSON action plan for the creator.
 *
 * Primary model : IBM Granite 3.0 (ibm/granite-3-8b-instruct) via watsonx.ai.
 * Fallback model: OpenAI gpt-4o — used automatically if Granite fails for any reason
 *                 (403 WML not associated, 500, network error, etc.).
 *
 * Response shape:
 * {
 *   insights:       string[] // 5–7 unique bullet points: data finding + creator action
 *   followUpScript: string   // ready-to-use 60-second spoken script
 * }
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { request as nodeHttpsRequest } from 'node:https';
import { getAuth0User } from '@/lib/auth0-session';

export const dynamic = 'force-dynamic';
// Granite calls can take 10–20 s
export const maxDuration = 60;

// ── Types ─────────────────────────────────────────────────────────────────────

/** A specific question that was frequently missed, with the choices audiences picked instead */
export interface MissedQuestion {
  questionText: string;
  /** Accuracy for this individual question: 0–100 */
  accuracy: number;
  /** Number of times this question was answered incorrectly */
  wrongCount: number;
  /** The correct answer text */
  correctAnswerText: string;
  /** Top incorrect choice texts that audiences selected, ordered by frequency (most common first) */
  topWrongChoices: string[];
}

export interface ConceptStat {
  topic: string;
  accuracy: number;        // 0–100
  totalAnswers: number;
  wrongAnswers: number;
  questionCount: number;
  /** Granular per-question breakdown — most-missed questions first */
  missedQuestions: MissedQuestion[];
}

export interface AnalyticsInsightsRequest {
  courseTitle: string;
  totalAttempts: number;
  conceptStats: ConceptStat[];
}

export interface AnalyticsInsightsResponse {
  /** 5–7 unique, non-overlapping bullet points — each combines a data finding with a creator action */
  insights: string[];
  followUpScript: string;
}

// ── IBM watsonx.ai IAM token (node:https) ─────────────────────────────────────

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
            resolve((JSON.parse(text) as { access_token: string }).access_token);
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

// ── Granite generation (node:https) ──────────────────────────────────────────

function granitePost(
  watsonxUrl: string,
  projectId: string,
  accessToken: string,
  prompt: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const modelId = process.env.WATSONX_MODEL_ID || 'ibm/granite-3-8b-instruct';
    const bodyObj = {
      model_id:   modelId,
      project_id: projectId,
      input:      prompt,
      parameters: {
        decoding_method:    'greedy',
        max_new_tokens:     1500,
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
            // Reject with a structured error so the catch block can log the
            // exact IBM response without ever surfacing it to the frontend.
            reject(new Error(`Granite error ${res.statusCode}: ${text}`));
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

// ── OpenAI fallback (node:https) ──────────────────────────────────────────────
// Mirrors the same helper in app/api/generate/route.ts — node:https bypasses
// Next.js's patched globalThis.fetch and its request-lifecycle AbortSignal.

function openaiPost(apiKey: string, bodyObj: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(bodyObj);
    const req = nodeHttpsRequest(
      {
        hostname: 'api.openai.com',
        path:     '/v1/chat/completions',
        method:   'POST',
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
            try {
              const e = JSON.parse(text) as { error?: { message?: string } };
              reject(new Error(e.error?.message ?? `OpenAI error ${res.statusCode}`));
            } catch {
              reject(new Error(`OpenAI error ${res.statusCode}`));
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

// ── Shared JSON validator ─────────────────────────────────────────────────────

function validateShape(parsed: unknown): parsed is AnalyticsInsightsResponse {
  const p = parsed as AnalyticsInsightsResponse;
  return (
    Array.isArray(p?.insights) &&
    p.insights.length >= 5 &&
    p.insights.length <= 7 &&
    typeof p?.followUpScript === 'string'
  );
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Auth — creator-only endpoint
  const user = await getAuth0User();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const body = await req.json() as AnalyticsInsightsRequest;
  const { courseTitle, totalAttempts, conceptStats } = body;

  if (!conceptStats?.length) {
    return NextResponse.json({ error: 'conceptStats is required.' }, { status: 400 });
  }

  // ── Build the shared prompt ────────────────────────────────────────────────
  const sorted = [...conceptStats].sort((a, b) => a.accuracy - b.accuracy);

  // Build detailed concept + question breakdown
  const struggleList = sorted.map(c => {
    let entry = `  - Topic "${c.topic}": ${c.accuracy}% accuracy (${c.wrongAnswers} wrong out of ${c.totalAnswers} answers, ${c.questionCount} question${c.questionCount !== 1 ? 's' : ''})`;
    if (c.missedQuestions.length > 0) {
      const qLines = c.missedQuestions.map(mq => {
        const wrongChoices = mq.topWrongChoices.length > 0
          ? `; audience most often selected: ${mq.topWrongChoices.map(w => `"${w}"`).join(', ')}`
          : '';
        return `      • Q: "${mq.questionText}" — ${mq.accuracy}% correct (${mq.wrongCount} wrong). Correct answer: "${mq.correctAnswerText}"${wrongChoices}`;
      });
      entry += '\n' + qLines.join('\n');
    }
    return entry;
  }).join('\n');

  const top2 = sorted.slice(0, 2).map(c => c.topic);

  const jsonInstruction = `Return ONLY a JSON object with exactly these two keys — no markdown, no commentary:
{
  "insights": [
    "<Bullet 1: combine one data finding (cite the exact question stem or topic, exact % accuracy, exact wrong-answer count, and the incorrect choice text selected) with one concrete action the creator should take to address it.>",
    "<Bullet 2: a second, completely distinct finding + action — different question or misconception from bullet 1.>",
    "<Bullet 3: a third distinct finding + action.>",
    "<Bullet 4: a fourth distinct finding + action.>",
    "<Bullet 5: a fifth distinct finding + action.>",
    "<Bullet 6: optional — include only if a genuinely distinct sixth finding exists in the data.>",
    "<Bullet 7: optional — include only if a genuinely distinct seventh finding exists in the data.>"
  ],
  "followUpScript": "<A ready-to-use 60-second spoken script. Open with a hook that names the exact problem (e.g. 'Most of you chose X on the question about Y — here is why that is wrong'). Then re-explain concept 1 in 2–3 sentences correcting the exact misconception. Then re-explain concept 2 in 2–3 sentences. Close with a direct call-to-action. Write as warm, fluent spoken prose — no bullet points, no placeholders.>"
}

Do NOT output separate diagnosis paragraphs or duplicate recommendations. Provide EXACTLY 5 to 7 unique, non-overlapping bullet points in the "insights" array. Each bullet must combine a data finding with a concrete action for the creator.`;

  const userContent = `You are analysing quiz performance data for a creator. The quiz is titled "${courseTitle}" and has received ${totalAttempts} attempt${totalAttempts !== 1 ? 's' : ''}.

Per-concept and per-question accuracy breakdown (sorted worst → best):
${struggleList}

Top 2 weakest concept areas: "${top2[0] ?? 'N/A'}" and "${top2[1] ?? 'N/A'}".

RULES:
- Every sentence that makes a claim MUST cite an exact number or percentage from the data above.
- Name specific question stems, not vague topic labels.
- Name the exact wrong answer choices audiences selected.
- Never output generic educational advice that could apply to any quiz.
- Return ONLY the JSON object — no preamble, no code fences.

${jsonInstruction}`;

  // ── Attempt 1: IBM Granite via watsonx.ai ─────────────────────────────────
  const watsonxApiKey    = process.env.WATSONX_API_KEY;
  const watsonxProjectId = process.env.WATSONX_PROJECT_ID;
  const watsonxUrl       = process.env.WATSONX_URL;

  if (watsonxApiKey && watsonxProjectId && watsonxUrl) {
    try {
      const granitePrompt = `<|system|>\nYou are an expert educational analyst and content strategist with deep knowledge of cognitive science and learning design. Deliver sharp, data-cited, expert-level analysis using exact question stems, exact wrong-answer texts, and exact percentages from the data provided. Return ONLY valid JSON — no markdown, no code fences, no explanation outside the JSON.\n<|user|>\n${userContent}\n<|assistant|>\n`;
      const accessToken = await fetchIamToken(watsonxApiKey);
      const rawText     = await granitePost(watsonxUrl, watsonxProjectId, accessToken, granitePrompt);
      const cleaned     = rawText.trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
      const parsed = JSON.parse(cleaned) as unknown;
      if (!validateShape(parsed)) throw new Error('Granite returned an unexpected JSON shape.');
      console.log('[analytics-insights] served by Granite');
      return NextResponse.json(parsed);
    } catch (graniteErr) {
      // Log the raw IBM error server-side but never expose it to the client.
      console.warn(
        '[analytics-insights] Granite failed, falling back to OpenAI:',
        graniteErr instanceof Error ? graniteErr.message : graniteErr,
      );
    }
  } else {
    console.warn('[analytics-insights] watsonx credentials not set — skipping Granite, using OpenAI fallback.');
  }

  // ── Attempt 2: OpenAI fallback ────────────────────────────────────────────
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return NextResponse.json(
      { error: 'AI insights are unavailable — no AI service is configured.' },
      { status: 503 },
    );
  }

  try {
    const data = await openaiPost(openaiKey, {
      model: 'gpt-4o',
      messages: [
        {
          role:    'system',
          content: 'You are an expert educational analyst and content strategist with deep knowledge of cognitive science and learning design. Deliver sharp, data-cited, expert-level analysis using exact question stems, exact wrong-answer texts, and exact percentages from the data provided. Return ONLY valid JSON — no markdown, no code fences, no explanation outside the JSON.',
        },
        { role: 'user', content: userContent },
      ],
      max_completion_tokens: 1500,
    }) as { choices: Array<{ message: { content: string } }> };

    const raw     = data.choices[0].message.content.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    const parsed = JSON.parse(raw) as unknown;
    if (!validateShape(parsed)) throw new Error('OpenAI returned an unexpected JSON shape.');
    console.log('[analytics-insights] served by OpenAI gpt-4o fallback');
    return NextResponse.json(parsed);
  } catch (openaiErr) {
    const message = openaiErr instanceof Error ? openaiErr.message : 'Insights generation failed.';
    console.error('[analytics-insights] OpenAI fallback also failed:', message);
    return NextResponse.json(
      { error: 'Could not generate insights at this time. Please try again shortly.' },
      { status: 500 },
    );
  }
}

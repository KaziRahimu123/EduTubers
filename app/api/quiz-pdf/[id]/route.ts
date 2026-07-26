import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminClient } from '@/lib/supabase';

// ── Quiz PDF route ────────────────────────────────────────────────────────────
// Fetches the course from Supabase (by id OR slug) and returns a self-contained
// HTML page that the browser prints/saves as a PDF.  The old approach read from
// localStorage in the new tab, which never worked because (a) localStorage is
// not shared between tabs in the same way across origins and (b) the URL param
// is a slug, not the internal course UUID.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = adminClient();

  // Look up by UUID first, then fall back to slug — the PDF button passes
  // `course.id` (UUID) but slug-based URLs also need to work.
  let { data: course } = await sb
    .from('courses')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (!course) {
    ({ data: course } = await sb
      .from('courses')
      .select('*')
      .eq('slug', id)
      .maybeSingle());
  }

  if (!course) {
    return new NextResponse(
      '<p style="color:#ef4444;font-family:sans-serif;padding:40px">Quiz not found.</p>',
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg = (course.quiz_config as Record<string, any>) || {};
  const fb  = cfg.feedbackSettings || {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qs: any[]  = (course.modules || []).flatMap((m: any) => m.quizQuestions || []);

  const typeLabel: Record<string, string> = { multiple_choice: 'MC', true_false: 'T/F', multiple_select: 'Multi' };
  const typeClass: Record<string, string> = { multiple_choice: 'mc', true_false: 'tf', multiple_select: 'ms' };
  const letters = 'ABCDE';

  function esc(s: unknown): string {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  let body = `<h1>${esc(course.title)}</h1>`;
  body += `<p class="meta">`;
  if (cfg.targetAudience) body += esc(cfg.targetAudience.charAt(0).toUpperCase() + cfg.targetAudience.slice(1)) + ' · ';
  if (cfg.difficulty)     body += `Difficulty: ${esc(cfg.difficulty)} · `;
  body += `${qs.length} question${qs.length !== 1 ? 's' : ''}`;
  if (cfg.passingScore)   body += ` · Passing: ${cfg.passingScore}%`;
  body += `</p>`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  qs.forEach((q: any, i: number) => {
    const type = q.type || 'multiple_choice';
    body += `<div class="question">`;
    body += `<div class="q-header">`;
    body += `<div class="q-num">${i + 1}</div>`;
    body += `<span class="q-badge ${typeClass[type] || 'mc'}">${typeLabel[type] || 'MC'}</span>`;
    if (type === 'multiple_select') body += `<span style="font-size:11px;color:#9ca3af">Select all that apply</span>`;
    body += `</div>`;
    body += `<p class="q-text">${esc(q.question)}</p>`;

    (q.choices || []).forEach((choice: string, ci: number) => {
      const isCorrect = type === 'multiple_select'
        ? (q.correctAnswers || []).includes(ci)
        : q.correctAnswer === ci;
      body += `<div class="choice${isCorrect ? ' correct' : ''}">`;
      body += `<span class="choice-label">${letters[ci]}.</span>`;
      body += esc(choice);
      if (isCorrect) body += ` <span style="font-size:10px;margin-left:4px">✓</span>`;
      body += `</div>`;
    });

    if (q.explanation && fb.showExplanations !== false) {
      body += `<div class="explanation"><p class="exp-label">Explanation</p>${esc(q.explanation)}</div>`;
    }
    body += `</div>`;
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(course.title)} — Quiz PDF</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; font-size: 13px; line-height: 1.55; color: #1f2328; background: #fff; padding: 32px 40px; max-width: 760px; margin: 0 auto; }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  .meta { color: #57606a; font-size: 12px; margin-bottom: 24px; }
  .question { margin-bottom: 24px; page-break-inside: avoid; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px 16px; }
  .q-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .q-num { background: #fff3e0; color: #c2410c; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; }
  .q-badge { font-size: 10px; padding: 1px 6px; border-radius: 4px; font-weight: 600; }
  .mc { background: #dbeafe; color: #1d4ed8; }
  .tf { background: #ede9fe; color: #6d28d9; }
  .ms { background: #ccfbf1; color: #0f766e; }
  .q-text { font-weight: 600; font-size: 13.5px; margin-bottom: 10px; }
  .choice { padding: 5px 10px; border-radius: 6px; border: 1px solid #e5e7eb; margin-bottom: 4px; font-size: 12.5px; display: flex; align-items: baseline; gap: 6px; }
  .choice.correct { border-color: #86efac; background: #f0fdf4; font-weight: 600; color: #166534; }
  .choice-label { flex-shrink: 0; color: #9ca3af; font-size: 11px; }
  .explanation { margin-top: 8px; padding: 8px 10px; background: #f8fafc; border-left: 3px solid #f97316; border-radius: 0 6px 6px 0; font-size: 12px; color: #4b5563; }
  .exp-label { font-weight: 700; color: #f97316; font-size: 11px; margin-bottom: 2px; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; text-align: center; }
  .print-btn { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 24px; padding: 8px 16px; background: #f97316; color: #fff; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .print-btn:hover { background: #ea6c0a; }
  @media print {
    body { padding: 20px; }
    .no-print { display: none !important; }
    .question { border-color: #d1d5db; }
  }
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">⬇ Save as PDF</button>
${body}
<div class="footer">Generated by EduTubers · ${new Date().toLocaleDateString()}</div>
<script>
// Auto-trigger print dialog after a short delay so the page renders first
setTimeout(function() { window.print(); }, 500);
</script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `inline; filename="quiz-${id}.html"`,
    },
  });
}

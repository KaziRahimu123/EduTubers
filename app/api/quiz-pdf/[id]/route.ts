import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ── HTML → PDF (server-side, no headless browser dependency) ─────────────────
// We render a self-contained HTML page that the browser can print/save to PDF.
// The route returns HTML with `Content-Disposition: attachment` so the browser
// prompts the user to save it.  For a proper server-rendered PDF we would use
// puppeteer or @react-pdf/renderer — those can be added later without changing
// the public route contract.

// Because this is an App Router API route the course data is stored client-side
// (localStorage) so we cannot read it on the server. Instead we return a tiny
// HTML page that reads from localStorage and generates a printable layout,
// then auto-triggers window.print().

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Quiz PDF</title>
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
  @media print {
    body { padding: 20px; }
    .no-print { display: none; }
    .question { border-color: #d1d5db; }
  }
</style>
</head>
<body>
<div id="root"><p style="color:#9ca3af;text-align:center;padding:60px 0">Loading quiz…</p></div>
<div class="footer no-print" id="footer" style="display:none"></div>

<script>
(function() {
  const id = ${JSON.stringify(id)};
  try {
    const raw = localStorage.getItem('be_courses');
    if (!raw) { document.getElementById('root').innerHTML = '<p style="color:#ef4444">Quiz not found in local storage. Open the quiz editor first, then try downloading the PDF.</p>'; return; }
    const courses = JSON.parse(raw);
    const course = courses.find(c => c.id === id);
    if (!course) { document.getElementById('root').innerHTML = '<p style="color:#ef4444">Quiz ID not found.</p>'; return; }

    const cfg = course.quizConfig || {};
    const fb  = cfg.feedbackSettings || {};
    const qs  = (course.modules || []).flatMap(m => m.quizQuestions || []);

    const typeLabel = { multiple_choice: 'MC', true_false: 'T/F', multiple_select: 'Multi' };
    const typeClass = { multiple_choice: 'mc', true_false: 'tf', multiple_select: 'ms' };
    const letters = 'ABCDE';

    let html = '<h1>' + esc(course.title) + '</h1>';
    html += '<p class="meta">';
    if (cfg.targetAudience) html += esc(cfg.targetAudience.charAt(0).toUpperCase() + cfg.targetAudience.slice(1)) + ' · ';
    if (cfg.difficulty) html += 'Difficulty: ' + esc(cfg.difficulty) + ' · ';
    html += qs.length + ' questions';
    if (cfg.passingScore) html += ' · Passing: ' + cfg.passingScore + '%';
    html += '</p>';

    qs.forEach(function(q, i) {
      const type = q.type || 'multiple_choice';
      html += '<div class="question">';
      html += '<div class="q-header">';
      html += '<div class="q-num">' + (i+1) + '</div>';
      html += '<span class="q-badge ' + (typeClass[type] || 'mc') + '">' + (typeLabel[type] || 'MC') + '</span>';
      if (type === 'multiple_select') html += '<span style="font-size:11px;color:#9ca3af">Select all that apply</span>';
      html += '</div>';
      html += '<p class="q-text">' + esc(q.question) + '</p>';

      (q.choices || []).forEach(function(choice, ci) {
        var isCorrect = type === 'multiple_select'
          ? (q.correctAnswers || []).includes(ci)
          : q.correctAnswer === ci;
        html += '<div class="choice' + (isCorrect ? ' correct' : '') + '">';
        html += '<span class="choice-label">' + letters[ci] + '.</span>';
        html += esc(choice);
        if (isCorrect) html += ' <span style="font-size:10px;margin-left:4px">✓</span>';
        html += '</div>';
      });

      if (q.explanation && fb.showExplanations !== false) {
        html += '<div class="explanation"><p class="exp-label">Explanation</p>' + esc(q.explanation) + '</div>';
      }
      html += '</div>';
    });

    document.getElementById('root').innerHTML = html;

    const footer = document.getElementById('footer');
    footer.innerHTML = 'Generated by EduTubers · ' + new Date().toLocaleDateString();
    footer.style.display = 'block';

    setTimeout(function() { window.print(); }, 600);

  } catch(e) {
    document.getElementById('root').innerHTML = '<p style="color:#ef4444">Error: ' + esc(String(e)) + '</p>';
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
})();
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

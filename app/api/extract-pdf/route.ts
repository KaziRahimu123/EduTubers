import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import path from 'path';

const MAX_SINGLE_PDF_BYTES = 100 * 1024 * 1024; // 100 MB per file
const MAX_COMBINED_BYTES   = 100 * 1024 * 1024; // 100 MB combined

async function parsePdf(arrayBuffer: ArrayBuffer): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfPkg = require('pdf-parse');
    if (pdfPkg.PDFParse) {
      try {
        const workerPath = path.join(path.dirname(require.resolve('pdf-parse')), 'pdf.worker.mjs');
        pdfPkg.PDFParse.setWorker('file://' + workerPath);
      } catch { /* ignore worker path error on Vercel serverless */ }
      const parser = new pdfPkg.PDFParse({ data: arrayBuffer });
      const result = await parser.getText();
      return result.text?.trim() ?? '';
    } else if (typeof pdfPkg === 'function') {
      const data = await pdfPkg(Buffer.from(arrayBuffer));
      return data.text?.trim() ?? '';
    }
  } catch (e) {
    console.error('PDF parsing error:', e);
  }
  return '';
}

// ── Single-file handler (POST with FormData `file`) ───────────────────────────

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    // ── Multi-file path: `files[]` field ────────────────────────────────────
    const multiEntries = formData.getAll('files[]') as (File | null)[];
    const multiFiles   = multiEntries.filter((f): f is File => f instanceof File);

    if (multiFiles.length > 0) {
      // Validate combined size
      const combinedSize = multiFiles.reduce((s, f) => s + f.size, 0);
      if (combinedSize > MAX_COMBINED_BYTES) {
        return NextResponse.json(
          { error: `Combined PDF size exceeds the 100 MB limit.` },
          { status: 413 },
        );
      }

      const results: { filename: string; text: string }[] = [];

      for (const file of multiFiles) {
        if (file.type !== 'application/pdf') {
          return NextResponse.json(
            { error: `"${file.name}" is not a PDF file.` },
            { status: 400 },
          );
        }
        if (file.size > MAX_SINGLE_PDF_BYTES) {
          return NextResponse.json(
            { error: `"${file.name}" exceeds the 100 MB limit.` },
            { status: 413 },
          );
        }

        const arrayBuffer = await file.arrayBuffer();
        const text        = await parsePdf(arrayBuffer);

        if (!text) {
          return NextResponse.json(
            {
              error: `No readable text found in "${file.name}". It may be image-only — please paste the text manually.`,
            },
            { status: 422 },
          );
        }

        results.push({ filename: file.name, text });
      }

      return NextResponse.json({ results });
    }

    // ── Single-file path: legacy `file` field (backwards-compatible) ────────
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }
    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Only PDF files are accepted.' }, { status: 400 });
    }
    if (file.size > MAX_SINGLE_PDF_BYTES) {
      return NextResponse.json({ error: 'File exceeds the 100 MB limit.' }, { status: 413 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const text        = await parsePdf(arrayBuffer);

    if (!text) {
      return NextResponse.json(
        { error: 'No readable text found in this PDF. It may be image-only — please paste the text manually.' },
        { status: 422 },
      );
    }

    return NextResponse.json({ text });
  } catch (err) {
    console.error('[extract-pdf]', err);
    return NextResponse.json({ error: 'Failed to extract text from PDF.' }, { status: 500 });
  }
}

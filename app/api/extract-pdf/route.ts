import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import path from 'path';

const MAX_PDF_BYTES = 100 * 1024 * 1024; // 100 MB

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }
    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Only PDF files are accepted.' }, { status: 400 });
    }
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json({ error: 'File exceeds the 100 MB limit.' }, { status: 413 });
    }

    const arrayBuffer = await file.arrayBuffer();

    // pdf-parse v2 exports a class; pass buffer via `data` then call getText().
    // The worker defaults to a relative "./pdf.worker.mjs" which breaks in Next.js —
    // resolve it to an absolute file:// URL before constructing the parser.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFParse } = require('pdf-parse') as {
      PDFParse: { new (opts: { data: ArrayBuffer }): { getText(): Promise<{ text: string }> }; setWorker(s: string): void };
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const workerPath = path.join(path.dirname(require.resolve('pdf-parse')), 'pdf.worker.mjs');
    PDFParse.setWorker('file://' + workerPath);
    const parser = new PDFParse({ data: arrayBuffer });
    const result = await parser.getText();

    const text = result.text?.trim() ?? '';
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

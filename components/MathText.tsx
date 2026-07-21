'use client';

/**
 * MathText — renders a string that may contain LaTeX delimiters.
 *
 * Supported syntax:
 *   $$...$$ — display (block) math
 *   $...$   — inline math
 *
 * Plain Unicode (e.g. 5³ × 5⁴, H₂O) requires no special treatment and
 * is rendered as-is.  KaTeX is only invoked for $ … $ segments.
 */

import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

type Segment =
  | { kind: 'text';    value: string }
  | { kind: 'inline';  value: string }
  | { kind: 'display'; value: string };

function parse(text: string): Segment[] {
  const segments: Segment[] = [];
  // Match $$...$$ first (display), then $...$ (inline)
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      segments.push({ kind: 'text', value: text.slice(last, m.index) });
    }
    if (m[1] !== undefined) {
      segments.push({ kind: 'display', value: m[1] });
    } else {
      segments.push({ kind: 'inline', value: m[2] });
    }
    last = re.lastIndex;
  }
  if (last < text.length) {
    segments.push({ kind: 'text', value: text.slice(last) });
  }
  return segments;
}

function renderKatex(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, { displayMode, throwOnError: false, strict: false });
  } catch {
    return latex;
  }
}

export default function MathText({ children, className }: { children: string; className?: string }) {
  const segments = useMemo(() => parse(children ?? ''), [children]);

  // No LaTeX — skip all overhead
  if (segments.length === 1 && segments[0].kind === 'text') {
    return <span className={className}>{children}</span>;
  }

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (seg.kind === 'text') {
          return <span key={i}>{seg.value}</span>;
        }
        if (seg.kind === 'display') {
          return (
            <span
              key={i}
              className="block my-1"
              dangerouslySetInnerHTML={{ __html: renderKatex(seg.value, true) }}
            />
          );
        }
        // inline
        return (
          <span
            key={i}
            dangerouslySetInnerHTML={{ __html: renderKatex(seg.value, false) }}
          />
        );
      })}
    </span>
  );
}

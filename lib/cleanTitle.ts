/**
 * Strip AI-generated title prefixes so they never appear anywhere in the UI,
 * database writes, or exported PDFs. All patterns are case-insensitive and
 * tolerate any amount of whitespace around the colon.
 */
const TITLE_PREFIXES =
  /^(branded resource page|branded resource|branded content guide|branded guide|illustrated explainer|visual story|visual explainer|resource page)\s*:\s*/i;

export function cleanTitle(title: string): string {
  return title.replace(TITLE_PREFIXES, '');
}

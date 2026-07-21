'use client';

export interface FontOption {
  id: string;
  label: string;
  /** CSS font-family value */
  family: string;
  /** Google Fonts URL — null for system fonts */
  url: string | null;
}

export const FONTS: FontOption[] = [
  { id: 'system',    label: 'Default',       family: '-apple-system, "Segoe UI", system-ui, sans-serif', url: null },
  { id: 'inter',     label: 'Inter',          family: '"Inter", sans-serif',             url: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap' },
  { id: 'georgia',   label: 'Georgia',        family: 'Georgia, "Times New Roman", serif', url: null },
  { id: 'merriweather', label: 'Merriweather', family: '"Merriweather", serif',           url: 'https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&display=swap' },
  { id: 'lato',      label: 'Lato',           family: '"Lato", sans-serif',              url: 'https://fonts.googleapis.com/css2?family=Lato:wght@400;700&display=swap' },
  { id: 'playfair',  label: 'Playfair Display', family: '"Playfair Display", serif',     url: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&display=swap' },
  { id: 'roboto',    label: 'Roboto',         family: '"Roboto", sans-serif',            url: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap' },
  { id: 'mono',      label: 'Monospace',      family: '"Courier New", Courier, monospace', url: null },
];

export interface FontSettings {
  fontId: string;
  bold: boolean;
}

const DEFAULT: FontSettings = { fontId: 'system', bold: false };

export function loadFontSettings(docId: string): FontSettings {
  try {
    const raw = localStorage.getItem(`be_font_${docId}`);
    return raw ? (JSON.parse(raw) as FontSettings) : DEFAULT;
  } catch { return DEFAULT; }
}

export function saveFontSettings(docId: string, settings: FontSettings): void {
  try { localStorage.setItem(`be_font_${docId}`, JSON.stringify(settings)); } catch { /* ignore */ }
}

/**
 * Load font settings preferring the value stored on the course row (Supabase),
 * falling back to localStorage for backward compat.
 */
export function loadFontSettingsFromCourse(
  docId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  courseExtra?: Record<string, any>,
): FontSettings {
  if (courseExtra?.fontSettings) return courseExtra.fontSettings as FontSettings;
  return loadFontSettings(docId);
}

export function getFontOption(fontId: string): FontOption {
  return FONTS.find(f => f.id === fontId) ?? FONTS[0];
}

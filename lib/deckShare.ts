'use client';

/**
 * Encodes a flashcard deck into a URL-safe base64 string so anyone with the
 * link can view it — no server, no shared localStorage required.
 *
 * Payload shape (JSON → base64url):
 * {
 *   title: string
 *   description: string
 *   colorful: boolean
 *   cards: Array<{ front: string; back: string; image?: string }>
 * }
 *
 * Images are base64 data URLs and can make the string large, but modern
 * browsers and clipboard handles URLs up to ~2 MB fine for sharing.
 */

export interface SharePayload {
  title: string;
  description: string;
  colorful: boolean;
  cards: Array<{ front: string; back: string; image?: string }>;
}

export function encodePayload(payload: SharePayload): string {
  const json = JSON.stringify(payload);
  // btoa works on ASCII; use encodeURIComponent to handle Unicode safely
  const b64 = btoa(unescape(encodeURIComponent(json)));
  // Make URL-safe
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodePayload(encoded: string): SharePayload | null {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(b64)));
    return JSON.parse(json) as SharePayload;
  } catch {
    return null;
  }
}

'use server';

/**
 * lib/auth0-session.ts
 *
 * Server-side helper: reads the Auth0 session and returns a stable user ID
 * that can be used as owner_id when writing to Supabase.
 *
 * Auth0's `sub` claim looks like "google-oauth2|1234567890" or "auth0|abc123".
 * We hash it to a deterministic UUID v5 so it fits the existing uuid columns.
 */

import { auth0 } from '@/lib/auth0';
import { createHash } from 'crypto';

export interface Auth0User {
  /** Stable UUID derived from Auth0 sub — used as owner_id in Supabase */
  id: string;
  /** Raw Auth0 sub, e.g. "google-oauth2|123" */
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

/** Convert any string to a deterministic UUID v4-shaped string. */
function subToUuid(sub: string): string {
  const hash = createHash('sha256').update(sub).digest('hex');
  // Format as xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),
    ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join('-');
}

/**
 * Server action: returns the current Auth0 user mapped to a Supabase-compatible id.
 * Returns null if not signed in.
 */
export async function getAuth0User(): Promise<Auth0User | null> {
  const session = await auth0.getSession();
  if (!session?.user) return null;
  const { sub, email, name, picture } = session.user;
  return {
    id: subToUuid(sub as string),
    sub: sub as string,
    email: email as string ?? '',
    name: name as string ?? (email as string ?? '').split('@')[0],
    picture: picture as string | undefined,
  };
}

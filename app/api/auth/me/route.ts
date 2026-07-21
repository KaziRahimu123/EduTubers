import { NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { createHash } from 'crypto';

function subToUuid(sub: string): string {
  const hash = createHash('sha256').update(sub).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),
    ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join('-');
}

/**
 * GET /api/auth/me
 * Returns the current Auth0 user enriched with a stable Supabase-compatible UUID.
 * Uses auth0.getSession() without a request arg so it reads via next/headers,
 * which works correctly in Route Handlers after the middleware sets the session cookie.
 */
export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user) return NextResponse.json(null, { status: 401 });
  const { sub, email, name, picture } = session.user;
  return NextResponse.json({
    sub,
    edutubers_id: subToUuid(sub as string),
    email:        (email as string) ?? '',
    name:         (name as string) ?? ((email as string) ?? '').split('@')[0],
    picture:      picture as string | undefined,
  });
}

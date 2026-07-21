import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { auth0 } from './lib/auth0';

// Routes that are always public — no session required
const PUBLIC_PATHS = ['/', '/auth'];

// Multipart upload routes — auth0.middleware must NOT run on these because it
// reads the request body internally (to inspect tokens/cookies), which drains
// the stream. After that req.formData() in the route handler throws
// "Failed to parse body as FormData".  These routes use API-key auth server-side
// and do not need a session cookie check.
const MULTIPART_API_ROUTES = ['/api/transcribe', '/api/upload-image'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip auth0 middleware entirely for multipart upload routes — it consumes
  // the request body which breaks FormData parsing in the route handler.
  if (MULTIPART_API_ROUTES.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Always let auth0.middleware run — it handles /auth/* routes and session rolling
  const res = await auth0.middleware(request);

  // Auth routes and public paths always pass through
  if (pathname.startsWith('/auth')) return res;
  if (PUBLIC_PATHS.includes(pathname)) return res;

  // API routes handle their own auth (but still got the session cookie forwarded above)
  if (pathname.startsWith('/api')) return res;

  // For all app pages, require a session — redirect to /auth if missing
  const session = await auth0.getSession(request);
  if (!session) {
    const loginUrl = new URL('/auth', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return res;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
};

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { auth0 } from './lib/auth0';

// Routes that are always public — no session required.
const PUBLIC_PATHS = ['/', '/auth'];
const PUBLIC_PREFIXES = [
  '/tasks/',
  '/quiz/',
  '/flashcards/',
  '/course/',
  '/visual-guide/',
  '/pdf-pack/',
];

// Routes where auth0.middleware must NOT run because it reads the request body
// internally (to inspect tokens/cookies), which drains the stream.
const SKIP_AUTH0_MIDDLEWARE = [
  '/api/transcribe',
  '/api/upload-image',
  '/api/db',
  '/api/generate',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip auth0 middleware for routes that parse the request body themselves
  if (SKIP_AUTH0_MIDDLEWARE.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  try {
    const res = await auth0.middleware(request);

    // Auth routes and public paths always pass through
    if (pathname.startsWith('/auth')) return res;
    if (PUBLIC_PATHS.includes(pathname)) return res;
    if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) return res;

    // API routes handle their own auth
    if (pathname.startsWith('/api')) return res;

    // For all app pages, require a session — redirect to /auth if missing
    const session = await auth0.getSession(request);
    if (!session) {
      const loginUrl = new URL('/auth', request.url);
      return NextResponse.redirect(loginUrl);
    }
    return res;
  } catch (err) {
    console.error('Middleware execution fallback:', err);
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
};

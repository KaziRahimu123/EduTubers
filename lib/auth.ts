'use client';

/**
 * lib/auth.ts — Auth0 edition
 *
 * Keeps the same public interface as the old Supabase-Auth version so all
 * existing pages continue to compile without changes.
 * The real sign-in/sign-out is handled by Auth0 via:
 *   /api/auth/login        → redirect to Auth0
 *   /api/auth/logout       → clear session + redirect home
 *   /api/auth/callback     → Auth0 posts back here after login
 *   /api/auth/me           → returns current user JSON
 */

export type Theme = 'light' | 'dark' | 'system';

export interface Session {
  email:    string;
  id:       string;   // stable UUID derived from Auth0 sub
  username: string;   // display name (name or email prefix)
}

// ── Security questions (kept for backward compat) ─────────────────────────────
export const SECURITY_QUESTIONS = [
  "What was the name of your first pet?",
  "What city were you born in?",
  "What is your mother's maiden name?",
  "What was the name of your primary school?",
  "What was the make of your first car?",
  "What is the name of the street you grew up on?",
] as const;
export type SecurityQuestion = typeof SECURITY_QUESTIONS[number];

// ── Session helpers ───────────────────────────────────────────────────────────

let _cached: Session | null | undefined = undefined;

/** Async session — reads from /api/auth/me. Use inside useEffect. */
export async function getSessionAsync(): Promise<Session | null> {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) { _cached = null; return null; }
    const u = await res.json() as { edutubers_id: string; email: string; name: string } | null;
    if (!u) { _cached = null; return null; }
    _cached = {
      id:       u.edutubers_id,
      email:    u.email,
      username: u.name || u.email.split('@')[0],
    };
    return _cached;
  } catch {
    _cached = null;
    return null;
  }
}

/** Synchronous session from in-memory cache (may be stale on first load). */
export function getSession(): Session | null {
  return _cached ?? null;
}

// ── Sign out ──────────────────────────────────────────────────────────────────

/** Redirects to Auth0 logout, which clears the session cookie and redirects home. */
export function signOut(): void {
  window.location.href = '/auth/logout';
}

// ── Theme (localStorage + Supabase profiles) ──────────────────────────────────

export function getTheme(_u?: string): Theme {
  if (typeof window === 'undefined') return 'system';
  return (localStorage.getItem('be_theme') as Theme | null) ?? 'system';
}

export function saveTheme(_u: string | undefined, theme: Theme): void {
  if (typeof window !== 'undefined') localStorage.setItem('be_theme', theme);
}

// ── Stubs kept for backward compat ────────────────────────────────────────────

/** @deprecated sign-up is handled by Auth0 */
export async function createAccount(_e: string, _p: string): Promise<string | null> { return null; }
/** @deprecated sign-in is handled by Auth0 */
export async function signIn(_e: string, _p: string): Promise<string | null> { return null; }
/** @deprecated no-op */
export function startSession(_u: string) {}
export function usernameExists(_u: string): boolean { return false; }
export async function usernameExistsAsync(_u: string): Promise<boolean> { return false; }
export function getApiKey(_u?: string): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('be_openai_key') ?? '';
}
export function saveApiKey(_u: string | undefined, key: string): void {
  if (typeof window !== 'undefined') localStorage.setItem('be_openai_key', key);
}
export async function saveSecurityQA(_q: string, _a: string): Promise<string | null> { return null; }
export async function getSecurityQuestion(_e: string): Promise<string | null> { return null; }
export async function verifySecurityAnswer(_a: string): Promise<boolean> { return false; }
export async function hashPassword(p: string): Promise<string> { return p; }
export interface UserAccount {
  username: string; passwordHash: string; createdAt: string; apiKey: string; theme: Theme;
}

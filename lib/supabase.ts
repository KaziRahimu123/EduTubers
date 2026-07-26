import { createClient } from '@supabase/supabase-js';

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy_anon_key_for_static_build';

// Browser-safe singleton (anon key, RLS-enforced)
export const supabase = createClient(url, anon);

// Server-only admin client (service role — never import in 'use client' files)
export function adminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || anon;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: add brand_kit column + fix quota tables for Auth0
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. brand_kit column on courses ───────────────────────────────────────────
--    Stores the creator's brand kit JSONB alongside the course so it is
--    persisted and can be re-applied when editing or re-generating.

alter table public.courses
  add column if not exists brand_kit jsonb;

-- ── 2. generate_images (idempotent — migration already exists but may not
--    have been run on all environments) ────────────────────────────────────────

alter table public.courses
  add column if not exists generate_images boolean default null;

-- ── 3. Fix generation_quota.user_id FK ───────────────────────────────────────
--    The quota tables were created with references auth.users(id) but the app
--    uses Auth0 — users are NOT in auth.users. Drop the FK so inserts work.

alter table public.generation_quota
  drop constraint if exists generation_quota_user_id_fkey;

alter table public.generation_quota
  alter column user_id type text using user_id::text;

-- ── 4. Fix pro_quota.user_id FK (same reason) ────────────────────────────────

alter table public.pro_quota
  drop constraint if exists pro_quota_user_id_fkey;

alter table public.pro_quota
  alter column user_id type text using user_id::text;

-- ── 5. Update RPC functions to accept text user_id ───────────────────────────

create or replace function public.increment_gen_quota(p_user_id text)
returns void language plpgsql security definer as $$
begin
  insert into public.generation_quota (user_id) values (p_user_id);
end;
$$;

create or replace function public.count_gen_quota_3days(p_user_id text)
returns integer language plpgsql security definer as $$
declare
  v_count integer;
begin
  select count(*) into v_count
    from public.generation_quota
    where user_id = p_user_id
      and used_at >= now() - interval '3 days';
  return v_count;
end;
$$;

create or replace function public.record_pro_usage(p_user_id text)
returns void language plpgsql security definer as $$
begin
  insert into public.pro_quota (user_id) values (p_user_id);
end;
$$;

create or replace function public.count_pro_usage_3days(p_user_id text)
returns integer language plpgsql security definer as $$
declare
  v_count integer;
begin
  select count(*) into v_count
    from public.pro_quota
    where user_id = p_user_id
      and used_at >= now() - interval '3 days';
  return v_count;
end;
$$;

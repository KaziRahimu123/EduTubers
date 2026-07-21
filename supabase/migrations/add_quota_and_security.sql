-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: generation quota + security Q&A + terra usage
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Add new columns to profiles ───────────────────────────────────────────
--    security_question   : the question the user chose at sign-up
--    security_answer_hash: SHA-256 hex of the lowercased trimmed answer
--    (terra_used dropped — Pro usage is now tracked via pro_quota table)

alter table public.profiles
  add column if not exists security_question    text    not null default '',
  add column if not exists security_answer_hash text    not null default '';

-- ── 2. generation_quota ───────────────────────────────────────────────────────
--    One row per Standard generation. Count rows in last 3 days to enforce the cap.
--    10 Standard generations per 3-day rolling window across all 5 content types.

create table if not exists public.generation_quota (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  used_at    timestamptz not null default now()
);

alter table public.generation_quota enable row level security;

create policy "generation_quota: owner read"
  on public.generation_quota for select
  using (auth.uid() = user_id);

create policy "generation_quota: owner insert"
  on public.generation_quota for insert
  with check (auth.uid() = user_id);


-- ── 3. RPC helpers ────────────────────────────────────────────────────────────

-- Record one Standard generation.
create or replace function public.increment_gen_quota(p_user_id uuid)
returns void language plpgsql security definer as $$
begin
  insert into public.generation_quota (user_id) values (p_user_id);
end;
$$;

-- Count Standard generations in the last 3 days.
create or replace function public.count_gen_quota_3days(p_user_id uuid)
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

-- ── 4. pro_quota — rolling 3-day Pro generation tracker ──────────────────────
--    One row per Pro generation. We count rows in the last 3 days to enforce the cap.

create table if not exists public.pro_quota (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  used_at    timestamptz not null default now()
);

alter table public.pro_quota enable row level security;

create policy "pro_quota: owner read"
  on public.pro_quota for select
  using (auth.uid() = user_id);

create policy "pro_quota: owner insert"
  on public.pro_quota for insert
  with check (auth.uid() = user_id);

-- Record a Pro generation (called server-side via service role).
create or replace function public.record_pro_usage(p_user_id uuid)
returns void language plpgsql security definer as $$
begin
  insert into public.pro_quota (user_id) values (p_user_id);
end;
$$;

-- Count Pro generations in the last 3 days for a user.
create or replace function public.count_pro_usage_3days(p_user_id uuid)
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

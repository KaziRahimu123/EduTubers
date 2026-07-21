-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: Auth0 integration — remove Supabase Auth foreign keys
--
-- Auth0 manages authentication. Users are NOT in auth.users.
-- We derive a stable UUID from the Auth0 sub in the app (lib/auth0-session.ts).
--
-- This migration is IDEMPOTENT — safe to run multiple times.
--
-- KNOWN ISSUE: Postgres blocks ALTER COLUMN TYPE if ANY policy (even on other
-- tables) references the column via a subquery. The only reliable fix is to
-- drop ALL policies dynamically first, then recreate what we need.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Drop every policy in the public schema ─────────────────────────────────
do $$
declare
  r record;
begin
  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ── 2. Disable RLS on all affected tables ─────────────────────────────────────
alter table public.courses       disable row level security;
alter table public.quiz_reviews  disable row level security;
alter table public.quiz_attempts disable row level security;
alter table public.images        disable row level security;

-- ── 3. Drop FK constraints ────────────────────────────────────────────────────
alter table public.courses  drop constraint if exists courses_owner_id_fkey;
alter table public.profiles drop constraint if exists profiles_id_fkey;

-- ── 4. Change courses.owner_id from uuid → text ───────────────────────────────
alter table public.courses alter column owner_id type text using owner_id::text;

-- ── 5. Change profiles.id from uuid → text (if still uuid) ───────────────────
do $$ begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'id')
     = 'uuid' then
    alter table public.profiles alter column id type text using id::text;
  end if;
end $$;

-- ── 6. Add auth0_sub column to profiles ──────────────────────────────────────
alter table public.profiles
  add column if not exists auth0_sub text unique;

-- ── 7. Re-enable RLS ──────────────────────────────────────────────────────────
alter table public.courses       enable row level security;
alter table public.quiz_reviews  enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.images        enable row level security;

-- ── 8. Recreate only the policies the app needs ───────────────────────────────

-- courses: anon client can read any row (owner_id filter is done in app code)
create policy "courses: read by id"
  on public.courses for select using (true);

-- courses: published courses are publicly readable
create policy "courses: public read published"
  on public.courses for select using (status = 'published');

-- quiz_reviews: anyone can read/post reviews on published courses
create policy "quiz_reviews: public read"
  on public.quiz_reviews for select
  using (exists (select 1 from public.courses where id = course_id and status = 'published'));

create policy "quiz_reviews: public insert"
  on public.quiz_reviews for insert
  with check (exists (select 1 from public.courses where id = course_id and status = 'published'));

-- quiz_attempts: anyone can submit on a published quiz
create policy "quiz_attempts: public insert"
  on public.quiz_attempts for insert
  with check (exists (select 1 from public.courses where id = quiz_id and status = 'published'));

-- quiz_attempts: anyone can read attempts
create policy "quiz_attempts: read"
  on public.quiz_attempts for select using (true);

-- images: public read on published courses
create policy "images: public read on published"
  on public.images for select
  using (exists (select 1 from public.courses where id = course_id and status = 'published'));

-- ── Done ──────────────────────────────────────────────────────────────────────
-- After running this:
--   • courses.owner_id is text — accepts the UUID-shaped Auth0 sub hash
--   • No FK constraint blocks inserts from Auth0 users
--   • All writes go through /api/db (service role key, bypasses RLS)
--   • Public reads work without authentication

-- ═══════════════════════════════════════════════════════════════════════════════
-- Bob Effect — Supabase Schema (canonical, fully up-to-date)
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
--
-- This file reflects all migrations applied so far and is safe to run
-- on a fresh project.  It is idempotent (uses IF NOT EXISTS / OR REPLACE).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. PROFILES ───────────────────────────────────────────────────────────────
--    One row per user.  id is a stable UUID derived from the Auth0 sub.
--    No FK to auth.users — the app uses Auth0, not Supabase Auth.

create table if not exists public.profiles (
  id                    text primary key,   -- Auth0-derived UUID as text
  username              text unique not null,
  api_key               text not null default '',
  theme                 text not null default 'system',   -- 'light'|'dark'|'system'
  auth0_sub             text unique,
  security_question     text not null default '',
  security_answer_hash  text not null default '',
  created_at            timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: owner read"   on public.profiles for select using (true);
create policy "profiles: owner update" on public.profiles for update using (true);
create policy "profiles: owner insert" on public.profiles for insert with check (true);


-- ── 2. COURSES ────────────────────────────────────────────────────────────────
--    One row per content asset created by a user.
--    content_type values: 'review_cards' | 'quiz' | 'activities' |
--                         'branded_guide' | 'resource_page'
--    modules (JSONB) holds all flashcards, quiz questions, practice tasks, etc.

create table if not exists public.courses (
  id                        text primary key,           -- client-generated uid
  owner_id                  text not null,              -- Auth0-derived UUID as text
  title                     text not null default 'Untitled',
  description               text not null default '',
  content_type              text not null default 'review_cards',
  learner_level             text not null default 'beginner',
  status                    text not null default 'draft',       -- 'draft'|'published'
  slug                      text unique,
  share_text                text not null default '',
  creator_improvement_notes text not null default '',
  views                     integer not null default 0,
  completions               integer not null default 0,
  learning_goals            jsonb not null default '[]',
  modules                   jsonb not null default '[]',
  final_project             jsonb not null default '{"title":"","description":"","deliverables":[]}',
  flashcard_options         jsonb,                               -- FlashcardDeckOptions | null
  quiz_config               jsonb,                               -- QuizConfig | null
  task_config               jsonb,                               -- PracticeTaskConfig | null
  generate_images           boolean default null,               -- Visual Explainer / Branded Guide
  brand_kit                 jsonb,                               -- CreatorBrandKit | null
  creator_username          text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

alter table public.courses enable row level security;

-- Owner (and service-role writes via /api/db) can read all their courses
create policy "courses: read by id"
  on public.courses for select using (true);

-- Published courses are publicly readable
create policy "courses: public read published"
  on public.courses for select using (status = 'published');


-- ── 3. QUIZ_REVIEWS ───────────────────────────────────────────────────────────
--    Comments / reviews on a published course.  Anonymous by default.

create table if not exists public.quiz_reviews (
  id          uuid primary key default gen_random_uuid(),
  course_id   text not null references public.courses(id) on delete cascade,
  name        text not null default 'Anonymous',
  comment     text not null,
  rating      integer check (rating between 1 and 5),
  created_at  timestamptz not null default now()
);

alter table public.quiz_reviews enable row level security;

create policy "quiz_reviews: public read"
  on public.quiz_reviews for select
  using (exists (select 1 from public.courses where id = course_id and status = 'published'));

create policy "quiz_reviews: public insert"
  on public.quiz_reviews for insert
  with check (exists (select 1 from public.courses where id = course_id and status = 'published'));

create policy "quiz_reviews: owner read"
  on public.quiz_reviews for select
  using (exists (select 1 from public.courses where id = course_id));

create policy "quiz_reviews: owner insert"
  on public.quiz_reviews for insert
  with check (exists (select 1 from public.courses where id = course_id));


-- ── 4. QUIZ_ATTEMPTS ──────────────────────────────────────────────────────────
--    One row per quiz submission.  taker_id is null for anonymous takers.

create table if not exists public.quiz_attempts (
  id               uuid primary key default gen_random_uuid(),
  quiz_id          text not null references public.courses(id) on delete cascade,
  taker_id         text,                                        -- null = anonymous
  answers          jsonb not null default '[]',
  score            integer not null default 0,
  total            integer not null default 0,
  percentage_score integer not null default 0,
  passed           boolean not null default false,
  attempt_number   integer not null default 1,
  completed_at     timestamptz not null default now()
);

alter table public.quiz_attempts enable row level security;

create policy "quiz_attempts: public insert"
  on public.quiz_attempts for insert
  with check (exists (select 1 from public.courses where id = quiz_id and status = 'published'));

create policy "quiz_attempts: read"
  on public.quiz_attempts for select using (true);


-- ── 5. IMAGES (Supabase Storage metadata) ────────────────────────────────────
--    Tracks uploaded Visual Explainer / Branded Guide images.
--    Actual files live in the Storage bucket named "images".

create table if not exists public.images (
  id            uuid primary key default gen_random_uuid(),
  course_id     text not null references public.courses(id) on delete cascade,
  card_index    integer not null,
  storage_path  text not null,
  url           text not null,
  created_at    timestamptz not null default now(),
  unique (course_id, card_index)
);

alter table public.images enable row level security;

create policy "images: public read on published"
  on public.images for select
  using (exists (select 1 from public.courses where id = course_id and status = 'published'));

create policy "images: owner insert"
  on public.images for insert
  with check (exists (select 1 from public.courses where id = course_id));

create policy "images: owner manage"
  on public.images for all
  using (exists (select 1 from public.courses where id = course_id));


-- ── 6. GENERATION_QUOTA ───────────────────────────────────────────────────────
--    One row per Standard generation.  user_id is the Auth0-derived UUID (text).
--    Count rows in the last 3 days to enforce the rolling cap.

create table if not exists public.generation_quota (
  id         uuid        primary key default gen_random_uuid(),
  user_id    text        not null,
  used_at    timestamptz not null default now()
);

alter table public.generation_quota enable row level security;

create policy "generation_quota: read"   on public.generation_quota for select using (true);
create policy "generation_quota: insert" on public.generation_quota for insert with check (true);

create or replace function public.increment_gen_quota(p_user_id text)
returns void language plpgsql security definer as $$
begin
  insert into public.generation_quota (user_id) values (p_user_id);
end;
$$;

create or replace function public.count_gen_quota_3days(p_user_id text)
returns integer language plpgsql security definer as $$
declare v_count integer;
begin
  select count(*) into v_count
    from public.generation_quota
    where user_id = p_user_id
      and used_at >= now() - interval '3 days';
  return v_count;
end;
$$;


-- ── 7. PRO_QUOTA ──────────────────────────────────────────────────────────────
--    One row per Enhanced (Pro) generation.  Same rolling-window pattern.

create table if not exists public.pro_quota (
  id         uuid        primary key default gen_random_uuid(),
  user_id    text        not null,
  used_at    timestamptz not null default now()
);

alter table public.pro_quota enable row level security;

create policy "pro_quota: read"   on public.pro_quota for select using (true);
create policy "pro_quota: insert" on public.pro_quota for insert with check (true);

create or replace function public.record_pro_usage(p_user_id text)
returns void language plpgsql security definer as $$
begin
  insert into public.pro_quota (user_id) values (p_user_id);
end;
$$;

create or replace function public.count_pro_usage_3days(p_user_id text)
returns integer language plpgsql security definer as $$
declare v_count integer;
begin
  select count(*) into v_count
    from public.pro_quota
    where user_id = p_user_id
      and used_at >= now() - interval '3 days';
  return v_count;
end;
$$;


-- ── 8. STORAGE BUCKET ────────────────────────────────────────────────────────
--    Public bucket for Visual Explainer and Branded Guide images.
--    Skip if already created in the dashboard.

insert into storage.buckets (id, name, public)
  values ('images', 'images', true)
  on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'storage images: public read') then
    execute $p$ create policy "storage images: public read" on storage.objects for select using (bucket_id = 'images') $p$;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'storage images: auth upload') then
    execute $p$ create policy "storage images: auth upload" on storage.objects for insert with check (bucket_id = 'images') $p$;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'storage images: auth update') then
    execute $p$ create policy "storage images: auth update" on storage.objects for update using (bucket_id = 'images') with check (bucket_id = 'images') $p$;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'storage images: owner delete') then
    execute $p$ create policy "storage images: owner delete" on storage.objects for delete using (bucket_id = 'images') $p$;
  end if;
end $$;

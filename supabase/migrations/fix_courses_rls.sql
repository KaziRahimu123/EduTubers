-- ── Fix courses RLS: public anon reads must be restricted to published rows ────
--
-- Problem: two SELECT policies existed on courses:
--   1. "courses: read by id"          → using (true)  [everyone can read everything]
--   2. "courses: public read published" → using (status = 'published')
--
-- With Supabase RLS, multiple policies for the same role+operation are OR-combined,
-- so policy #1 made policy #2 entirely redundant — every row was readable by anyone.
-- This meant draft courses were publicly accessible via the anon key.
--
-- Fix: drop the overly-permissive policy.  The service-role client used by /api/db
-- bypasses RLS entirely, so creator reads (dashboard, editors) are unaffected.
-- Public audience routes that use the anon key will now only see published rows,
-- which is the intended behaviour — the status check in the viewer components then
-- correctly gates draft content.

drop policy if exists "courses: read by id" on public.courses;

-- Keep (or recreate) the published-only public policy as the sole SELECT policy.
-- This is a no-op if it already exists correctly, but stated explicitly for clarity.
drop policy if exists "courses: public read published" on public.courses;

create policy "courses: public read published"
  on public.courses
  for select
  using (status = 'published');

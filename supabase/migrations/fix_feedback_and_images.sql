-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: fix feedback RLS + Supabase Storage policies
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. FEEDBACK (quiz_reviews) ────────────────────────────────────────────────
--
-- Problem: the existing INSERT policy only allows inserts on *published* courses.
-- Visual Study Guides and PDF Packs are never "published", so feedback from the
-- course owner (while editing) was blocked by RLS.
--
-- Fix: add a second INSERT policy that allows the course OWNER to always insert
-- feedback/reviews on their own content, regardless of status.

create policy "quiz_reviews: owner insert"
  on public.quiz_reviews for insert
  with check (exists (
    select 1 from public.courses
    where id = course_id and owner_id = auth.uid()
  ));

-- Also allow the owner to read all reviews on their own content
-- (the existing public-read policy only covers published courses)
create policy "quiz_reviews: owner read"
  on public.quiz_reviews for select
  using (exists (
    select 1 from public.courses
    where id = course_id and owner_id = auth.uid()
  ));


-- ── 2. IMAGES TABLE — owner insert + public read ──────────────────────────────
--
-- The existing "images: owner manage" policy covers SELECT/UPDATE/DELETE but
-- the INSERT path needs to be explicit when RLS is strict.
-- This is a no-op if the policy already exists (idempotent).

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'images'
      and policyname = 'images: owner insert'
  ) then
    execute $pol$
      create policy "images: owner insert"
        on public.images for insert
        with check (exists (
          select 1 from public.courses
          where id = course_id and owner_id = auth.uid()
        ))
    $pol$;
  end if;
end $$;


-- ── 3. STORAGE — allow authenticated users to UPDATE (upsert) their images ────
--
-- The existing storage policy only covers INSERT. Upsert from the JS client
-- issues an UPDATE when the path already exists, which was blocked.

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename  = 'objects'
      and policyname = 'storage images: auth update'
  ) then
    execute $pol$
      create policy "storage images: auth update"
        on storage.objects for update
        using (bucket_id = 'images' and auth.role() = 'authenticated')
        with check (bucket_id = 'images' and auth.role() = 'authenticated')
    $pol$;
  end if;
end $$;

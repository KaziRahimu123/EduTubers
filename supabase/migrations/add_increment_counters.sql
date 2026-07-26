-- ── increment_course_views / increment_course_completions ─────────────────────
-- Atomic counter increments called from the public /api/db proxy.
-- SECURITY DEFINER lets the anon role increment counters without needing a
-- service-role key in the browser (the browser has no Supabase JWT).

create or replace function public.increment_course_views(course_id_arg text)
returns void
language sql
security definer
as $$
  update public.courses
  set    views = views + 1
  where  id = course_id_arg
    and  status = 'published';
$$;

create or replace function public.increment_course_completions(course_id_arg text)
returns void
language sql
security definer
as $$
  update public.courses
  set    completions = completions + 1
  where  id = course_id_arg
    and  status = 'published';
$$;

-- Grant execute to the anon role so unauthenticated visitors can call them.
grant execute on function public.increment_course_views(text)       to anon;
grant execute on function public.increment_course_completions(text) to anon;

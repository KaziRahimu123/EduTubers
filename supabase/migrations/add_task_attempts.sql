-- ── task_attempts ─────────────────────────────────────────────────────────────
-- Records every Interactive Challenge session. Each row stores the full
-- per-task breakdown so the creator can see which tasks most people get wrong.
-- taker_name is optional — null means the person didn't sign in (anonymous).

create table if not exists public.task_attempts (
  id               uuid primary key default gen_random_uuid(),
  course_id        text not null references public.courses(id) on delete cascade,
  taker_name       text,                        -- null = anonymous
  -- per-task results: [{taskId, correct}]
  results          jsonb not null default '[]',
  correct_count    integer not null default 0,
  total_count      integer not null default 0,
  percentage_score integer not null default 0,
  completed_at     timestamptz not null default now()
);

alter table public.task_attempts enable row level security;

create policy "task_attempts: public insert"
  on public.task_attempts for insert
  with check (exists (select 1 from public.courses where id = course_id and status = 'published'));

create policy "task_attempts: read"
  on public.task_attempts for select using (true);

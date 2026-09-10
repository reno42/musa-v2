-- v38 — Personalized onboarding. Safe to execute more than once.
alter table user_profiles add column if not exists personalized_onboarding_completed boolean not null default false;
create table if not exists onboarding_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id text not null check (char_length(goal_id) between 1 and 80),
  selected_at timestamptz not null default now(),
  completed_at timestamptz,
  completion_source text check (completion_source in ('self', 'system')),
  dismissed_at timestamptz,
  primary key (user_id, goal_id)
);
-- A previous partial run may have created this named constraint already.
-- PostgreSQL does not support ADD CONSTRAINT IF NOT EXISTS, so guard it
-- explicitly without dropping the existing rule or any progress history.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'onboarding_progress_completion_source_check'
      and conrelid = 'public.onboarding_progress'::regclass
  ) then
    alter table public.onboarding_progress
      add constraint onboarding_progress_completion_source_check
      check ((completed_at is null and completion_source is null) or (completed_at is not null and completion_source is not null));
  end if;
end $$;
create index if not exists onboarding_progress_user_selected_idx on onboarding_progress (user_id, selected_at);
create index if not exists onboarding_progress_goal_completed_idx on onboarding_progress (goal_id, completed_at);
alter table onboarding_progress enable row level security;
drop policy if exists "onboarding_progress_own" on onboarding_progress;
create policy "onboarding_progress_own" on onboarding_progress for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

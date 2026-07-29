-- 005: Interview lifecycle steps
--
-- Problem: applications.status only has one flat 'interviewing' bucket. Real
-- interview loops have multiple rounds, and rounds can contain more than one
-- step (e.g. a round with both a live case interview and a take-home
-- presentation). That detail often comes from a recruiter call or a
-- scheduling link rather than an email reconcile_inbox can read, so it needs
-- a manual capture path as well as a Gmail-driven one.
--
-- interview_steps is one row per step. round_number groups steps that belong
-- to the same round; sequence_in_round orders steps within a round that has
-- more than one (default 1 for single-step rounds).

create table if not exists interview_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  application_id uuid not null references applications(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  sequence_in_round integer not null default 1 check (sequence_in_round > 0),
  title text not null,
  format text check (format in ('phone', 'video_live', 'take_home', 'onsite', 'other')),
  duration_minutes integer check (duration_minutes > 0),
  interviewer text,
  scheduled_at timestamptz,
  status text not null default 'pending_schedule'
    check (status in ('pending_schedule', 'scheduled', 'completed', 'cancelled')),
  source text not null default 'manual' check (source in ('manual', 'gmail_reconcile')),
  notes text,
  last_actor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists interview_steps_app_round_seq_idx
  on interview_steps (application_id, round_number, sequence_in_round);

create index if not exists interview_steps_application_idx
  on interview_steps (application_id);

alter table interview_steps enable row level security;
create policy "Users can only access their own interview steps"
  on interview_steps for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger interview_steps_updated_at before update on interview_steps
  for each row execute function update_updated_at();

-- Log step changes into the same activity_log feed as application changes
-- (same append-only, no-FK pattern as 003/004 — rows must survive deletes).
create or replace function log_interview_step_activity()
returns trigger as $$
declare
  v_action text;
  v_details jsonb;
  v_row interview_steps;
  v_job_id uuid;
  v_title text;
  v_company text;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;

  select a.job_id, j.title, j.company into v_job_id, v_title, v_company
  from applications a join jobs j on j.id = a.job_id
  where a.id = v_row.application_id;

  if tg_op = 'INSERT' then
    v_action := 'interview_step_added';
    v_details := jsonb_build_object('round', new.round_number, 'title', new.title, 'status', new.status);
  elsif tg_op = 'DELETE' then
    v_action := 'interview_step_deleted';
    v_details := jsonb_build_object('round', old.round_number, 'title', old.title);
  else
    if new.status is distinct from old.status then
      v_action := 'interview_step_status_changed';
      v_details := jsonb_build_object('round', new.round_number, 'title', new.title, 'from', old.status, 'to', new.status);
    elsif new.scheduled_at is distinct from old.scheduled_at then
      v_action := 'interview_step_scheduled';
      v_details := jsonb_build_object('round', new.round_number, 'title', new.title, 'scheduled_at', new.scheduled_at);
    else
      return null; -- nothing user-visible changed
    end if;
  end if;

  insert into activity_log (user_id, application_id, job_id, actor, action, job_title, company, details)
  values (v_row.user_id, v_row.application_id, v_job_id,
          case when tg_op = 'DELETE' then old.last_actor else new.last_actor end,
          v_action, v_title, v_company, v_details);
  return null;
end;
$$ language plpgsql;

drop trigger if exists interview_steps_activity on interview_steps;
create trigger interview_steps_activity
  after insert or update or delete on interview_steps
  for each row execute function log_interview_step_activity();

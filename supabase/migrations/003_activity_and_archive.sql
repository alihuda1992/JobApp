-- 003: Activity feed + auto-archive
--
-- 1. applications.archived_at  — terminal cards (rejected/closed) untouched for
--    30+ days are archived by the app on Pipeline load; archived cards leave the
--    board but stay queryable in the Archived view.
-- 2. applications.last_actor   — every writer stamps who made the change
--    ('user' = in-app, 'claude' = MCP server, 'system' = auto-archive sweep).
--    The activity trigger copies it into the log so the app can badge changes
--    the user didn't make themselves.
-- 3. activity_log              — append-only feed populated by a trigger on
--    applications, shown on the Activity page with an unread badge driven by
--    profiles.last_seen_activity_at.

alter table applications add column if not exists archived_at timestamptz;
alter table applications add column if not exists last_actor text;

alter table profiles add column if not exists last_seen_activity_at timestamptz default now();

create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  -- intentionally no FKs: log rows must survive application/job deletion
  application_id uuid,
  job_id uuid,
  actor text,                -- 'user' | 'claude' | 'system' | null (unknown)
  action text not null,      -- created | status_changed | archived | unarchived |
                             -- notes_updated | next_step_updated | deleted |
                             -- cover_letter_saved | job_scored
  job_title text,
  company text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists activity_log_user_created_idx
  on activity_log (user_id, created_at desc);

alter table activity_log enable row level security;
create policy "Users can only access their own activity"
  on activity_log for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Trigger: log one row per meaningful change to an application.
-- Priority order on UPDATE (one row per statement): status > archive > notes > next_step.
create or replace function log_application_activity()
returns trigger as $$
declare
  v_action text;
  v_details jsonb := '{}';
  v_title text;
  v_company text;
  v_row applications;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;

  select j.title, j.company into v_title, v_company
  from jobs j where j.id = v_row.job_id;

  if tg_op = 'INSERT' then
    v_action := 'created';
    v_details := jsonb_build_object('status', new.status);
  elsif tg_op = 'DELETE' then
    v_action := 'deleted';
    v_details := jsonb_build_object('status', old.status);
  else
    if new.status is distinct from old.status then
      v_action := 'status_changed';
      v_details := jsonb_build_object('from', old.status, 'to', new.status);
    elsif new.archived_at is distinct from old.archived_at then
      v_action := case when new.archived_at is null then 'unarchived' else 'archived' end;
      v_details := jsonb_build_object('status', new.status);
    elsif new.notes is distinct from old.notes then
      v_action := 'notes_updated';
      -- last line of the new notes is the freshest audit entry
      v_details := jsonb_build_object(
        'note', right(coalesce(new.notes, ''), 300)
      );
    elsif new.next_step is distinct from old.next_step then
      v_action := 'next_step_updated';
      v_details := jsonb_build_object('next_step', new.next_step);
    else
      return null; -- nothing user-visible changed (e.g. actor-only stamp before delete)
    end if;
  end if;

  insert into activity_log (user_id, application_id, job_id, actor, action, job_title, company, details)
  values (v_row.user_id, v_row.id, v_row.job_id,
          case when tg_op = 'DELETE' then old.last_actor else new.last_actor end,
          v_action, v_title, v_company, v_details);
  return null;
end;
$$ language plpgsql;

drop trigger if exists applications_activity on applications;
create trigger applications_activity
  after insert or update or delete on applications
  for each row execute function log_application_activity();

-- Realtime for the unread badge (ignore if already in the publication)
do $$
begin
  alter publication supabase_realtime add table activity_log;
exception when duplicate_object or undefined_object then
  null;
end $$;

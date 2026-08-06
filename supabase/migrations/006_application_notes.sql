-- 006: First-class application notes (replaces free-text applications.notes
-- and applications.next_step)
--
-- applications.notes was a single text column that every writer (in-app edits,
-- reconcile_inbox audit lines, tailored-resume stamps) read-modified-wrote by
-- appending "\n<line>" to — a growing wall of text with no per-entry actor or
-- timestamp, cramped into a 4-row textarea. application_notes replaces it with
-- one row per update: distinct blocks, each with its own actor/source/created_at,
-- rendered as a real timeline in its own panel instead of a textarea.
--
-- applications.next_step had a different bug (it was always a single
-- overwritten value, never appended-to) but the same underlying problem: it
-- lived in a sidebar field disconnected from the notes timeline, and setting
-- a new one silently discarded the old one with no record in the panel you're
-- looking at. It folds into the same table: a note with source = 'next_step'
-- is a next-step update, and the most recent one is the "current" next step
-- — the app derives and pins it from application_notes instead of reading a
-- separate column, so its history is just part of the same timeline.
--
-- Both applications.notes and applications.next_step are left in place (not
-- dropped) so no historical data is lost and nothing breaks if something
-- still reads them, but no code path writes to either after this migration
-- ships. Existing content is backfilled below.

create table if not exists application_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  application_id uuid not null references applications(id) on delete cascade,
  body text not null,
  actor text,                -- 'user' | 'claude' | 'system' | null (unknown, e.g. backfilled)
  source text,                -- optional short label, e.g. 'gmail_reconcile', 'tailored_resume', 'manual'
  created_at timestamptz not null default now()
);

create index if not exists application_notes_app_created_idx
  on application_notes (application_id, created_at);

alter table application_notes enable row level security;
create policy "Users can only access their own application notes"
  on application_notes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Backfill notes: one row per existing newline-delimited line, oldest first.
-- The per-line timestamp was never recorded, so we synthesize one working
-- backward from applications.updated_at, 1s per line, purely so the new
-- panel sorts old→new the same way the text read top→bottom.
do $$
declare
  r record;
  lines text[];
  n integer;
  i integer;
begin
  for r in select id, user_id, notes, updated_at from applications
           where notes is not null and length(trim(notes)) > 0
  loop
    lines := regexp_split_to_array(r.notes, E'\n');
    n := array_length(lines, 1);
    for i in 1 .. n loop
      if length(trim(lines[i])) > 0 then
        insert into application_notes (user_id, application_id, body, actor, source, created_at)
        values (
          r.user_id,
          r.id,
          trim(lines[i]),
          case when lines[i] ~* '^(Gmail reconcile|Tailored resume)' then 'claude' else null end,
          case
            when lines[i] ~* '^Gmail reconcile' then 'gmail_reconcile'
            when lines[i] ~* '^Tailored resume' then 'tailored_resume'
            else null
          end,
          r.updated_at - ((n - i) * interval '1 second')
        );
      end if;
    end loop;
  end loop;
end $$;

-- Backfill next_step: one row per application that has a current value,
-- tagged source = 'next_step' so the app can pick it out as the pinned
-- "current next step" (most recent source = 'next_step' row wins). Dated
-- 1s after the last note line (or updated_at if there were none) so it
-- sorts as the newest entry, matching how it reads today (the freshest
-- thing you'd see).
do $$
declare
  r record;
begin
  for r in select id, user_id, next_step, updated_at from applications
           where next_step is not null and length(trim(next_step)) > 0
  loop
    insert into application_notes (user_id, application_id, body, actor, source, created_at)
    values (
      r.user_id,
      r.id,
      trim(r.next_step),
      null,
      'next_step',
      r.updated_at + interval '1 second'
    );
  end loop;
end $$;

-- Log every new note to the existing activity feed (same pattern as 003's
-- applications trigger), so the Activity page keeps working without changes
-- beyond a new 'note_added' case in its describe() switch.
create or replace function log_note_activity()
returns trigger as $$
declare
  v_title text;
  v_company text;
  v_job_id uuid;
begin
  select a.job_id into v_job_id from applications a where a.id = new.application_id;
  select j.title, j.company into v_title, v_company from jobs j where j.id = v_job_id;
  insert into activity_log (user_id, application_id, job_id, actor, action, job_title, company, details)
  values (new.user_id, new.application_id, v_job_id, new.actor, 'note_added', v_title, v_company,
          jsonb_build_object('note', left(new.body, 300), 'source', new.source));
  return null;
end;
$$ language plpgsql;

drop trigger if exists application_notes_activity on application_notes;
create trigger application_notes_activity
  after insert on application_notes
  for each row execute function log_note_activity();

-- Realtime for the JobDetail notes panel
do $$
begin
  alter publication supabase_realtime add table application_notes;
exception when duplicate_object or undefined_object then
  null;
end $$;

comment on column applications.notes is
  'Deprecated: superseded by application_notes (one row per update). Kept for historical data only — no code path writes to this column anymore.';
comment on column applications.next_step is
  'Deprecated: superseded by application_notes rows with source = ''next_step'' (most recent one wins). Kept for historical data only — no code path writes to this column anymore.';

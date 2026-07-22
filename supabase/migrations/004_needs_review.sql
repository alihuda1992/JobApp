-- 004: Needs-review queue for low-confidence automated adds
--
-- Problem: the Gmail-reconcile flow (mcp-server add_job, called for "unmatched"
-- evidence) could create pipeline cards from inferred data with no human
-- confirmation in the loop — it ran unattended and just added them. Two such
-- cards ("Role TBD (LinkedIn application)" / Sud Recruiting, "Role not stated
-- in confirmation email" / Deloitte) landed on the live board this way.
--
-- Fix: applications.needs_review. Cards created with needs_review = true are
-- hidden from the kanban board and surfaced in a separate "Needs Review" panel
-- in the app instead, where the user approves (needs_review -> false) or
-- dismisses (deletes) them. The mcp-server add_job/create_application tools
-- now require the caller to set needs_review = true for anything built from
-- inference rather than explicit user confirmation.

alter table applications add column if not exists needs_review boolean not null default false;

create index if not exists applications_needs_review_idx
  on applications (user_id, needs_review) where needs_review;

-- Extend the activity trigger: log the create-time needs_review flag, and log
-- the approve transition (needs_review true -> false) as its own action so the
-- feed shows when a queued card was promoted to the board.
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
    v_details := jsonb_build_object('status', new.status, 'needs_review', new.needs_review);
  elsif tg_op = 'DELETE' then
    v_action := case when old.needs_review then 'review_dismissed' else 'deleted' end;
    v_details := jsonb_build_object('status', old.status);
  else
    if new.status is distinct from old.status then
      v_action := 'status_changed';
      v_details := jsonb_build_object('from', old.status, 'to', new.status);
    elsif new.needs_review is distinct from old.needs_review then
      v_action := case when new.needs_review then 'flagged_for_review' else 'review_approved' end;
      v_details := jsonb_build_object('status', new.status);
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

-- Retroactively flag the two cards that slipped through before this migration
-- existed, so they show up in the Needs Review queue instead of staying on
-- the live board with placeholder titles.
update applications
set needs_review = true, last_actor = 'system'
where id in ('7f0a27df-0746-4655-be57-4b5c4313c33d', '1c5baf76-9590-4d66-ba3b-79c28fb4ba0a');

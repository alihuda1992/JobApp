-- Keep-alive heartbeat for the Supabase free-tier inactivity pauser.
--
-- The original keep-alive workflow did an anon GET on `profiles?limit=1`. Under RLS
-- that returns an empty array — a 200 that never touches a row — and Supabase stopped
-- counting it as "sufficient activity": the project was flagged 2026-09-17 and paused
-- 2026-09-18 despite green pings every 3 days. This gives the workflow a real write.

create table if not exists public.keep_alive (
  id int primary key default 1 check (id = 1),  -- single-row table
  pinged_at timestamptz not null default now(),
  ping_count bigint not null default 0
);

alter table public.keep_alive enable row level security;
-- No policies: the table is only reachable through the function below.

create or replace function public.keep_alive()
returns timestamptz
language sql
security definer
set search_path = public
as $$
  insert into public.keep_alive (id, pinged_at, ping_count)
  values (1, now(), 1)
  on conflict (id) do update
    set pinged_at = now(), ping_count = keep_alive.ping_count + 1
  returning pinged_at;
$$;

revoke all on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated;

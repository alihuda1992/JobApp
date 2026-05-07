-- profiles: extends auth.users
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  current_title text,
  target_titles text[] default '{}',
  preferred_locations text[] default '{}',
  min_salary_usd integer,
  seniority text check (seniority in ('junior', 'mid', 'senior', 'lead', 'director')),
  company_size_prefs text[] default '{}',
  onboarding_complete boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table profiles enable row level security;
create policy "Users can only access their own profile"
  on profiles for all
  using (auth.uid() = id);

-- resumes
create table resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  file_path text,
  file_name text,
  file_type text check (file_type in ('pdf', 'docx')),
  raw_text text,
  parsed jsonb,
  is_active boolean default true,
  created_at timestamptz default now()
);

alter table resumes enable row level security;
create policy "Users can only access their own resumes"
  on resumes for all
  using (auth.uid() = user_id);

-- jobs
create table jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  source text check (source in ('adzuna', 'jsearch', 'manual')),
  external_id text,
  title text not null,
  company text,
  location text,
  salary_min integer,
  salary_max integer,
  salary_currency text default 'USD',
  description text,
  tags text[] default '{}',
  url text,
  posted_at timestamptz,
  match_score integer check (match_score >= 0 and match_score <= 100),
  match_breakdown jsonb,
  created_at timestamptz default now()
);

alter table jobs enable row level security;
create policy "Users can only access their own jobs"
  on jobs for all
  using (auth.uid() = user_id);

-- applications
create table applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,
  status text not null default 'saved'
    check (status in ('saved', 'applied', 'interviewing', 'offer', 'closed', 'rejected')),
  applied_at timestamptz,
  notes text,
  next_step text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table applications enable row level security;
create policy "Users can only access their own applications"
  on applications for all
  using (auth.uid() = user_id);

-- generated_docs
create table generated_docs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,
  type text not null check (type in ('cover_letter', 'resume_section_rewrite')),
  section_key text,
  content text not null,
  tone text,
  length text,
  version integer default 1,
  created_at timestamptz default now()
);

alter table generated_docs enable row level security;
create policy "Users can only access their own generated docs"
  on generated_docs for all
  using (auth.uid() = user_id);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at before update on profiles
  for each row execute function update_updated_at();

create trigger applications_updated_at before update on applications
  for each row execute function update_updated_at();

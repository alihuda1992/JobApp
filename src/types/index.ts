export interface Profile {
  id: string
  full_name: string | null
  current_title: string | null
  target_titles: string[]
  preferred_locations: string[]
  min_salary_usd: number | null
  seniority: 'junior' | 'mid' | 'senior' | 'lead' | 'director' | null
  company_size_prefs: string[]
  onboarding_complete: boolean
  notion_token: string | null
  notion_db_id: string | null
  last_seen_activity_at: string | null
  created_at: string
  updated_at: string
}

export interface ResumeJSON {
  summary: string
  experience: {
    title: string
    company: string
    location: string
    start_date: string
    end_date: string | null
    bullets: string[]
  }[]
  education: {
    degree: string
    institution: string
    field: string
    graduation_year: string
  }[]
  skills: string[]
  certifications: string[]
}

export interface Resume {
  id: string
  user_id: string
  file_path: string | null
  file_name: string | null
  file_type: 'pdf' | 'docx' | null
  raw_text: string | null
  parsed: ResumeJSON | null
  is_active: boolean
  created_at: string
}

export interface Job {
  id: string
  user_id: string
  source: 'adzuna' | 'jsearch' | 'remotive' | 'arbeitnow' | 'manual'
  external_id: string | null
  title: string
  company: string | null
  location: string | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string
  description: string | null
  tags: string[]
  url: string | null
  posted_at: string | null
  match_score: number | null
  match_breakdown: {
    skills: number
    experience: number
    keywords: number
    seniority: number
    industry: number
  } | null
  created_at: string
}

export interface Application {
  id: string
  user_id: string
  job_id: string
  status: 'saved' | 'applied' | 'interviewing' | 'offer' | 'closed' | 'rejected'
  applied_at: string | null
  notes: string | null
  next_step: string | null
  archived_at: string | null
  needs_review: boolean
  last_actor: string | null
  created_at: string
  updated_at: string
  job?: Job
}

export type ActivityAction =
  | 'created'
  | 'status_changed'
  | 'archived'
  | 'unarchived'
  | 'flagged_for_review'
  | 'review_approved'
  | 'review_dismissed'
  | 'notes_updated'
  | 'next_step_updated'
  | 'deleted'
  | 'cover_letter_saved'
  | 'job_scored'

export interface ActivityEntry {
  id: string
  user_id: string
  application_id: string | null
  job_id: string | null
  actor: 'user' | 'claude' | 'system' | null
  action: ActivityAction
  job_title: string | null
  company: string | null
  details: Record<string, unknown>
  created_at: string
}

export interface GeneratedDoc {
  id: string
  user_id: string
  job_id: string
  type: 'cover_letter' | 'resume_section_rewrite'
  section_key: string | null
  content: string
  tone: string | null
  length: string | null
  version: number
  created_at: string
}

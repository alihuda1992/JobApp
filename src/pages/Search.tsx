import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { searchJobs, adzunaConfigured } from '@/lib/adzuna'
import { useAppStore } from '@/store/useAppStore'
import type { Job } from '@/types'

type Tab = 'search' | 'paste'

function formatSalary(min: number | null, max: number | null): string | null {
  if (!min && !max) return null
  const fmt = (n: number) => '$' + (n >= 1000 ? Math.round(n / 1000) + 'k' : n)
  if (min && max) return `${fmt(min)} – ${fmt(max)}`
  if (min) return `${fmt(min)}+`
  return `Up to ${fmt(max!)}`
}

function relativeDate(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function scoreColor(score: number | null): string {
  if (score === null) return 'var(--color-match-gray)'
  if (score >= 90) return 'var(--color-match-green)'
  if (score >= 70) return 'var(--color-match-amber)'
  return 'var(--color-match-gray)'
}

function SkeletonCard() {
  return (
    <div className="job-card skeleton-card card">
      <div className="sk sk-title" />
      <div className="sk sk-sub" />
      <div className="sk sk-sub sk-sub-short" />
      <div className="sk sk-badge" />
    </div>
  )
}

function JobCard({
  job,
  onSave,
  saved,
}: {
  job: Job
  onSave: (job: Job) => Promise<void>
  saved: boolean
}) {
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  async function handleSave(e: React.MouseEvent) {
    e.stopPropagation()
    if (saved || saving) return
    setSaving(true)
    await onSave(job)
    setSaving(false)
    setJustSaved(true)
    setTimeout(() => setJustSaved(false), 2000)
  }

  const salary = formatSalary(job.salary_min, job.salary_max)
  const color = scoreColor(job.match_score)

  return (
    <div className="job-card card" onClick={() => navigate(`/jobs/${job.id}`)}>
      <div className="job-card-top">
        <div className="job-card-meta">
          <span className="job-title">{job.title}</span>
          <span className="job-company">{[job.company, job.location].filter(Boolean).join(' · ')}</span>
          {salary && <span className="job-salary">{salary}</span>}
          {job.posted_at && <span className="job-date">{relativeDate(job.posted_at)}</span>}
        </div>
        <div className="job-card-score" style={{ color }}>
          {job.match_score === null ? (
            <div className="score-dots">
              <span className="score-dot" />
              <span className="score-dot" />
              <span className="score-dot" />
            </div>
          ) : (
            <span className="score-value">{job.match_score}<span className="score-pct">%</span></span>
          )}
        </div>
      </div>
      <div className="job-card-footer">
        <span className="source-badge">{job.source === 'adzuna' ? 'Adzuna' : 'Manual'}</span>
        <button
          className={`btn ${saved || justSaved ? 'btn-saved' : 'btn-ghost'} save-btn`}
          onClick={handleSave}
          disabled={saved || saving}
        >
          {justSaved ? 'Saved ✓' : saved ? 'In Pipeline ✓' : saving ? 'Saving…' : 'Save to Pipeline'}
        </button>
      </div>
    </div>
  )
}

export function Search() {
  const navigate = useNavigate()
  const { profile, resume, searchResults, setSearchResults, updateJobScore, savedJobIds, addSavedJobId } = useAppStore()

  const [tab, setTab] = useState<Tab>('search')
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [salaryMin, setSalaryMin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  const [pasteTitle, setPasteTitle] = useState('')
  const [pasteCompany, setPasteCompany] = useState('')
  const [pasteJD, setPasteJD] = useState('')
  const [pasteLoading, setPasteLoading] = useState(false)
  const [pasteError, setPasteError] = useState<string | null>(null)

  const noAdzuna = !adzunaConfigured()
  const hasResume = !!resume?.parsed
  const resumeUploaded = !!resume

  const scoreInBatches = useCallback(
    async (jobs: Job[]) => {
      if (!hasResume) return
      const BATCH = 8
      for (let i = 0; i < jobs.length; i += BATCH) {
        await Promise.all(
          jobs.slice(i, i + BATCH).map(async (job) => {
            try {
              const { data } = await supabase.functions.invoke('ai-score-job', {
                body: { resume_parsed: resume!.parsed, job_description: job.description },
              })
              if (data?.score !== undefined) {
                updateJobScore(job.id, data.score, data.breakdown ?? null)
              }
            } catch {
              // per-card scoring failure is silent
            }
          })
        )
      }
    },
    [hasResume, resume, updateJobScore]
  )

  async function runSearch(q: string, loc?: string) {
    setError(null)
    setLoading(true)
    setSearchResults([])
    try {
      const jobs = await searchJobs({
        query: q,
        location: loc ?? (location || undefined),
        salaryMin: salaryMin ? Number(salaryMin) : undefined,
      })
      setSearchResults(jobs)
      scoreInBatches(jobs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    runSearch(query)
  }

  function handleChipClick(chip: string) {
    setQuery(chip)
    runSearch(chip)
  }

  // Suggestions: target titles first, then recent experience titles, deduplicated
  const suggestions: string[] = (() => {
    const seen = new Set<string>()
    const result: string[] = []
    const add = (s: string) => {
      const key = s.toLowerCase()
      if (s && !seen.has(key)) { seen.add(key); result.push(s) }
    }
    profile?.target_titles?.forEach(add)
    resume?.parsed?.experience?.slice(0, 3).forEach(e => add(e.title))
    return result.slice(0, 6)
  })()

  async function handlePaste(e: React.FormEvent) {
    e.preventDefault()
    setPasteError(null)
    if (pasteJD.trim().length < 50) {
      setPasteError('Job description must be at least 50 characters.')
      return
    }
    setPasteLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data: job, error: insertErr } = await supabase
        .from('jobs')
        .insert({
          user_id: user.id,
          source: 'manual',
          title: pasteTitle,
          company: pasteCompany || null,
          description: pasteJD,
          tags: [],
          salary_currency: 'USD',
        })
        .select()
        .single()

      if (insertErr) throw insertErr

      if (hasResume && job) {
        const { data: scored } = await supabase.functions.invoke('ai-score-job', {
          body: { resume_parsed: resume!.parsed, job_description: pasteJD },
        })
        if (scored?.score !== undefined) {
          await supabase
            .from('jobs')
            .update({ match_score: scored.score, match_breakdown: scored.breakdown ?? null })
            .eq('id', job.id)
        }
      }

      if (job) navigate(`/jobs/${job.id}`)
    } catch (err) {
      setPasteError(err instanceof Error ? err.message : 'Failed to save job')
    } finally {
      setPasteLoading(false)
    }
  }

  async function handleSave(job: Job) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Reuse existing job row if same Adzuna external_id already saved
    let dbJobId: string | null = null
    let dbJobScore: number | null = job.match_score

    if (job.external_id) {
      const { data: existing } = await supabase
        .from('jobs')
        .select('id, match_score')
        .eq('user_id', user.id)
        .eq('external_id', job.external_id)
        .maybeSingle()
      if (existing) {
        dbJobId = existing.id
        dbJobScore = existing.match_score
      }
    }

    if (!dbJobId) {
      const { data: saved, error } = await supabase
        .from('jobs')
        .insert({
          user_id: user.id,
          source: job.source,
          external_id: job.external_id,
          title: job.title,
          company: job.company,
          location: job.location,
          salary_min: job.salary_min != null ? Math.round(job.salary_min) : null,
          salary_max: job.salary_max != null ? Math.round(job.salary_max) : null,
          salary_currency: job.salary_currency,
          description: job.description,
          tags: job.tags,
          url: job.url,
          posted_at: job.posted_at,
          match_score: job.match_score,
          match_breakdown: job.match_breakdown,
        })
        .select('id')
        .single()
      if (error) { console.error('Job save error:', error); return }
      if (!saved) return
      dbJobId = saved.id
    }

    // Skip application insert if one already exists for this job
    const { data: existingApp } = await supabase
      .from('applications')
      .select('id')
      .eq('user_id', user.id)
      .eq('job_id', dbJobId)
      .maybeSingle()

    if (!existingApp) {
      await supabase.from('applications').insert({
        user_id: user.id,
        job_id: dbJobId,
        status: 'saved',
      })
    }

    addSavedJobId(job.id)

    // Score in background if score not yet available
    if (dbJobScore === null && resume?.parsed && job.description) {
      const capturedJobId = dbJobId
      supabase.functions
        .invoke('ai-score-job', {
          body: { resume_parsed: resume.parsed, job_description: job.description },
        })
        .then(({ data }) => {
          if (data?.score !== undefined) {
            supabase
              .from('jobs')
              .update({ match_score: data.score, match_breakdown: data.breakdown ?? null })
              .eq('id', capturedJobId)
            updateJobScore(job.id, data.score, data.breakdown ?? null)
          }
        })
    }
  }

  const sorted = [...searchResults].sort((a, b) => {
    if (a.match_score === null && b.match_score === null) return 0
    if (a.match_score === null) return 1
    if (b.match_score === null) return -1
    return b.match_score - a.match_score
  })

  return (
    <div className="search-page">
      <h1 className="page-title">Job Search</h1>

      {!resumeUploaded && !bannerDismissed && (
        <div className="banner-info">
          <span>Upload your resume to see match scores</span>
          <button className="banner-dismiss" onClick={() => setBannerDismissed(true)}>×</button>
        </div>
      )}
      {resumeUploaded && !hasResume && !bannerDismissed && (
        <div className="banner-info">
          <span>✦ Resume uploaded — AI analysis needed to show match scores. Deploy edge functions to enable.</span>
          <button className="banner-dismiss" onClick={() => setBannerDismissed(true)}>×</button>
        </div>
      )}

      <div className="search-tabs">
        <button
          className={`tab-btn ${tab === 'search' ? 'tab-active' : ''}`}
          onClick={() => setTab('search')}
        >
          Search Jobs
        </button>
        <button
          className={`tab-btn tab-btn-add ${tab === 'paste' ? 'tab-active' : ''}`}
          onClick={() => setTab('paste')}
        >
          + Add Job Manually
        </button>
      </div>

      {tab === 'search' && (
        <div className="search-panel">
          {noAdzuna && (
            <div className="banner-warn">
              Adzuna API keys not configured — search unavailable. Use Paste JD tab instead.
            </div>
          )}
          <form className="search-form" onSubmit={handleSearch}>
            <input
              className="input-base"
              placeholder="Job title or keywords"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              required
              disabled={noAdzuna}
            />
            <input
              className="input-base"
              placeholder="City or Remote"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              disabled={noAdzuna}
            />
            <input
              className="input-base"
              type="number"
              placeholder="Min salary (optional)"
              value={salaryMin}
              onChange={(e) => setSalaryMin(e.target.value)}
              disabled={noAdzuna}
            />
            <button type="submit" className="btn btn-primary" disabled={loading || noAdzuna}>
              {loading ? 'Searching…' : 'Search'}
            </button>
          </form>

          {suggestions.length > 0 && !loading && searchResults.length === 0 && (
            <div className="suggestions-strip">
              <span className="suggestions-label">Based on your resume</span>
              <div className="suggestions-chips">
                {suggestions.map(s => (
                  <button
                    key={s}
                    className="suggestion-chip"
                    onClick={() => handleChipClick(s)}
                    disabled={noAdzuna}
                  >{s}</button>
                ))}
              </div>
            </div>
          )}

          {error && <div className="search-error">{error}</div>}

          {loading && (
            <div className="results-grid">
              {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          )}

          {!loading && sorted.length > 0 && (
            <div className="results-grid">
              {sorted.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onSave={handleSave}
                  saved={savedJobIds.has(job.id)}
                />
              ))}
            </div>
          )}

          {!loading && searchResults.length === 0 && !error && query && (
            <p className="no-results">No results found. Try different keywords or location.</p>
          )}
        </div>
      )}

      {tab === 'paste' && (
        <div className="paste-panel">
          <form className="paste-form" onSubmit={handlePaste}>
            <div className="form-field">
              <label className="form-label">Job Title *</label>
              <input
                className="input-base"
                value={pasteTitle}
                onChange={(e) => setPasteTitle(e.target.value)}
                placeholder="e.g. Senior Product Manager"
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">Company</label>
              <input
                className="input-base"
                value={pasteCompany}
                onChange={(e) => setPasteCompany(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="form-field">
              <label className="form-label">Job Description *</label>
              <textarea
                className="input-base jd-textarea"
                value={pasteJD}
                onChange={(e) => setPasteJD(e.target.value)}
                placeholder="Paste the full job description here…"
                required
              />
            </div>
            {pasteError && <div className="search-error">{pasteError}</div>}
            <button type="submit" className="btn btn-primary" disabled={pasteLoading}>
              {pasteLoading ? 'Saving…' : 'Save & Score Job'}
            </button>
          </form>
        </div>
      )}

      <style>{`
        .search-page { padding: 32px; max-width: 900px; }
        .page-title { font-size: 28px; margin-bottom: 20px; }
        .banner-info, .banner-warn {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 14px; border-radius: var(--radius-btn);
          font-size: 13px; margin-bottom: 16px;
        }
        .banner-info {
          background: rgba(99,139,255,0.1); border: 1px solid rgba(99,139,255,0.25);
          color: rgba(242,240,234,0.8);
        }
        .banner-warn {
          background: rgba(255,170,50,0.1); border: 1px solid rgba(255,170,50,0.25);
          color: var(--color-match-amber);
        }
        .banner-dismiss {
          background: none; border: none; color: inherit; font-size: 16px;
          cursor: pointer; opacity: 0.6; padding: 0 4px;
        }
        .search-tabs { display: flex; gap: 8px; margin-bottom: 20px; align-items: center; }
        .tab-btn {
          padding: 7px 18px; border-radius: var(--radius-btn); font-size: 13px;
          font-weight: 500; background: none; border: 1px solid transparent;
          color: rgba(242,240,234,0.5); cursor: pointer; transition: all 0.15s;
        }
        .tab-btn:hover { color: var(--color-text); }
        .tab-active {
          background: rgba(255,255,255,0.06); border-color: var(--color-border);
          color: var(--color-text);
        }
        .tab-btn-add {
          background: rgba(255,255,255,0.05);
          border-color: var(--color-border) !important;
          color: var(--color-text) !important;
        }
        .tab-btn-add:hover {
          background: rgba(255,255,255,0.09);
          border-color: var(--color-border-hover) !important;
        }
        .tab-btn-add.tab-active {
          background: var(--color-accent);
          border-color: var(--color-accent) !important;
          color: #fff !important;
        }
        .search-form {
          display: grid; grid-template-columns: 1fr 1fr 1fr auto;
          gap: 10px; margin-bottom: 20px; align-items: end;
        }
        @media (max-width: 680px) {
          .search-form { grid-template-columns: 1fr; }
        }
        .search-error {
          background: rgba(220,50,50,0.12); border: 1px solid rgba(220,50,50,0.3);
          border-radius: var(--radius-btn); color: #f87171;
          font-size: 12px; padding: 8px 12px; margin-bottom: 16px;
        }
        .results-grid { display: flex; flex-direction: column; gap: 10px; }
        .job-card { padding: 16px; cursor: pointer; }
        .job-card-top { display: flex; justify-content: space-between; gap: 12px; }
        .job-card-meta { display: flex; flex-direction: column; gap: 3px; flex: 1; }
        .job-title { font-weight: 600; font-size: 14px; }
        .job-company, .job-date { font-size: 12px; color: rgba(242,240,234,0.5); }
        .job-salary { font-size: 12px; color: rgba(242,240,234,0.7); font-family: "DM Mono", monospace; }
        .job-card-score {
          font-size: 22px; font-weight: 700; font-family: "DM Mono", monospace;
          min-width: 44px; text-align: right; line-height: 1;
        }
        .score-pct { font-size: 11px; font-weight: 500; opacity: 0.7; margin-left: 1px; }
        .score-dots { display: flex; gap: 3px; align-items: center; justify-content: flex-end; }
        .score-dot {
          width: 5px; height: 5px; border-radius: 50%;
          background: var(--color-accent); opacity: 0.35;
          animation: score-bounce 1.1s ease-in-out infinite;
        }
        .score-dot:nth-child(2) { animation-delay: 0.18s; }
        .score-dot:nth-child(3) { animation-delay: 0.36s; }
        @keyframes score-bounce {
          0%, 70%, 100% { transform: translateY(0); opacity: 0.35; }
          35% { transform: translateY(-5px); opacity: 0.9; }
        }
        .job-card-footer {
          display: flex; align-items: center; justify-content: space-between;
          margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--color-border);
        }
        .source-badge {
          font-size: 11px; padding: 2px 8px; border-radius: 20px;
          background: rgba(255,255,255,0.06); border: 1px solid var(--color-border);
          color: rgba(242,240,234,0.5);
        }
        .save-btn { font-size: 12px; padding: 5px 12px; }
        .btn-saved {
          background: rgba(255,255,255,0.06); border: 1px solid var(--color-border);
          color: rgba(242,240,234,0.45);
        }
        .skeleton-card { padding: 16px; cursor: default; pointer-events: none; }
        .sk {
          border-radius: 4px; background: rgba(255,255,255,0.07);
          animation: shimmer 1.4s ease-in-out infinite alternate; margin-bottom: 8px;
        }
        .sk-title { height: 14px; width: 55%; }
        .sk-sub { height: 11px; width: 70%; }
        .sk-sub-short { width: 35%; }
        .sk-badge { height: 10px; width: 20%; margin-top: 12px; }
        @keyframes shimmer {
          from { opacity: 0.5; } to { opacity: 1; }
        }
        .suggestions-strip { margin-bottom: 20px; }
        .suggestions-label {
          display: block; font-size: 11px; font-weight: 600; text-transform: uppercase;
          letter-spacing: 0.5px; color: rgba(242,240,234,0.35); margin-bottom: 8px;
        }
        .suggestions-chips { display: flex; flex-wrap: wrap; gap: 7px; }
        .suggestion-chip {
          background: rgba(255,255,255,0.05); border: 1px solid var(--color-border);
          border-radius: 20px; padding: 5px 14px; font-size: 12px; cursor: pointer;
          color: rgba(242,240,234,0.75); transition: all 0.15s;
        }
        .suggestion-chip:hover:not(:disabled) {
          background: rgba(255,255,255,0.1); border-color: var(--color-accent);
          color: var(--color-text);
        }
        .no-results { color: rgba(242,240,234,0.4); font-size: 13px; margin-top: 24px; }
        .paste-panel { max-width: 560px; }
        .paste-form { display: flex; flex-direction: column; gap: 16px; }
        .form-field { display: flex; flex-direction: column; gap: 6px; }
        .form-label {
          font-size: 11px; font-weight: 500; text-transform: uppercase;
          letter-spacing: 0.5px; color: rgba(242,240,234,0.55);
        }
        .jd-textarea { min-height: 200px; resize: vertical; }
      `}</style>
    </div>
  )
}

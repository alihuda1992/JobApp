import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAppStore } from '@/store/useAppStore'
import type { Job } from '@/types'

function scoreColor(score: number | null): string {
  if (score === null) return 'var(--color-match-gray)'
  if (score >= 90) return 'var(--color-match-green)'
  if (score >= 70) return 'var(--color-match-amber)'
  return 'var(--color-match-gray)'
}

function BreakdownBar({ label, value }: { label: string; value: number }) {
  const color = scoreColor(value)
  return (
    <div className="breakdown-row">
      <div className="breakdown-label">
        <span>{label}</span>
        <span style={{ color, fontFamily: '"DM Mono", monospace', fontSize: 12 }}>{value}</span>
      </div>
      <div className="breakdown-track">
        <div className="breakdown-fill" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  )
}

export function JobDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { searchResults, resume, savedJobIds, addSavedJobId } = useAppStore()

  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [inPipeline, setInPipeline] = useState(false)
  const [saving, setSaving] = useState(false)

  const [suggestions, setSuggestions] = useState<string[]>([])
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    loadJob(id)
  }, [id])

  async function loadJob(jobId: string) {
    setLoading(true)

    // Check Zustand store first (unsaved search result)
    const storeJob = searchResults.find((j) => j.id === jobId)
    if (storeJob) {
      setJob(storeJob)
      setInPipeline(savedJobIds.has(storeJob.id))
      setLoading(false)
      return
    }

    // Fall back to Supabase (saved job)
    const { data } = await supabase.from('jobs').select('*').eq('id', jobId).single()
    if (data) {
      setJob(data as Job)
      // Check if application exists
      const { data: app } = await supabase
        .from('applications')
        .select('id')
        .eq('job_id', jobId)
        .maybeSingle()
      setInPipeline(!!app)
    }
    setLoading(false)
  }

  async function handleAddToPipeline() {
    if (!job || saving) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }

    // Upsert job to DB if it came from search (has empty user_id)
    let dbJobId = job.id
    if (!job.user_id) {
      const { data: saved } = await supabase
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
        .select()
        .single()
      if (saved) dbJobId = saved.id
    }

    await supabase.from('applications').insert({
      user_id: user.id,
      job_id: dbJobId,
      status: 'saved',
    })

    addSavedJobId(job.id)
    setInPipeline(true)
    setSaving(false)
  }

  async function handleGetSuggestions() {
    if (!job || !resume?.parsed) return
    setSuggestionsLoading(true)
    setSuggestionsError(null)
    try {
      const { data, error } = await supabase.functions.invoke('ai-tailoring-suggestions', {
        body: { resume_parsed: resume.parsed, job_description: job.description },
      })
      if (error) throw error
      setSuggestions(data?.suggestions ?? [])
      setDismissed(new Set())
    } catch {
      setSuggestionsError('Could not load suggestions — try again.')
    } finally {
      setSuggestionsLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="jd-page">
        <div className="jd-loading">Loading job…</div>
      </div>
    )
  }

  if (!job) {
    return (
      <div className="jd-page">
        <button className="back-link" onClick={() => navigate(-1)}>← Back</button>
        <p style={{ color: 'rgba(242,240,234,0.4)', marginTop: 24 }}>Job not found.</p>
      </div>
    )
  }

  const breakdown = job.match_breakdown
  const visibleSuggestions = suggestions.filter((_, i) => !dismissed.has(i))

  return (
    <div className="jd-page">
      <button className="back-link" onClick={() => navigate(-1)}>← Back</button>

      <div className="jd-layout">
        {/* Left: Job Info */}
        <div className="jd-main">
          <h1 className="jd-title">{job.title}</h1>

          <div className="jd-meta">
            {job.company && <span className="jd-meta-item">{job.company}</span>}
            {job.location && <span className="jd-meta-item">{job.location}</span>}
            {(job.salary_min || job.salary_max) && (
              <span className="jd-meta-item mono">
                {job.salary_min && job.salary_max
                  ? `$${Math.round(job.salary_min / 1000)}k – $${Math.round(job.salary_max / 1000)}k`
                  : job.salary_min
                  ? `$${Math.round(job.salary_min / 1000)}k+`
                  : `Up to $${Math.round(job.salary_max! / 1000)}k`}
              </span>
            )}
            {job.url && (
              <a href={job.url} target="_blank" rel="noopener noreferrer" className="jd-meta-item jd-link">
                View original ↗
              </a>
            )}
          </div>

          {job.match_score !== null && (
            <div className="jd-score-block">
              <div className="jd-score-number" style={{ color: scoreColor(job.match_score) }}>
                {job.match_score}<span style={{ fontSize: 20, fontWeight: 500, opacity: 0.7 }}>%</span>
                <span className="jd-score-label">match</span>
              </div>
              {breakdown && (
                <div className="jd-breakdown">
                  <BreakdownBar label="Skills" value={breakdown.skills} />
                  <BreakdownBar label="Experience" value={breakdown.experience} />
                  <BreakdownBar label="Keywords" value={breakdown.keywords} />
                  <BreakdownBar label="Seniority" value={breakdown.seniority} />
                  <BreakdownBar label="Industry" value={breakdown.industry} />
                </div>
              )}
            </div>
          )}

          <div className="jd-description">
            <h2 className="jd-section-title">Job Description</h2>
            <pre className="jd-body">{job.description}</pre>
          </div>
        </div>

        {/* Right: AI Panel */}
        <div className="jd-panel">
          <div className="jd-panel-inner card">
            <button
              className={`btn ${inPipeline ? 'btn-ghost' : 'btn-primary'} jd-pipeline-btn`}
              onClick={handleAddToPipeline}
              disabled={inPipeline || saving}
            >
              {saving ? 'Adding…' : inPipeline ? 'In Pipeline ✓' : 'Add to Pipeline'}
            </button>

            <button
              className="btn btn-ghost jd-cover-btn"
              onClick={() => navigate(`/cover/${job.id}`)}
              disabled={!inPipeline}
              title={!inPipeline ? 'Save to pipeline first' : undefined}
            >
              Generate Cover Letter
            </button>

            <div className="jd-suggestions">
              <div className="suggestions-header">
                <span className="ai-indicator">✦</span>
                <span>Tailoring Suggestions</span>
              </div>

              {visibleSuggestions.length === 0 && !suggestionsLoading && (
                <button
                  className="btn btn-ghost suggestions-trigger"
                  onClick={handleGetSuggestions}
                  disabled={!resume?.parsed}
                  title={!resume?.parsed ? 'Upload your resume first' : undefined}
                >
                  {suggestionsLoading ? 'Analysing…' : 'Get suggestions ✦'}
                </button>
              )}

              {suggestionsLoading && (
                <p className="suggestions-loading">Analysing your fit…</p>
              )}

              {suggestionsError && (
                <p className="suggestions-error">{suggestionsError}</p>
              )}

              {visibleSuggestions.length > 0 && (
                <ul className="suggestions-list">
                  {suggestions.map((s, i) =>
                    dismissed.has(i) ? null : (
                      <li key={i} className="suggestion-chip">
                        <span>{s}</span>
                        <button
                          className="chip-dismiss"
                          onClick={() => setDismissed((prev) => new Set([...prev, i]))}
                        >×</button>
                      </li>
                    )
                  )}
                  <button className="btn btn-ghost suggestions-trigger" onClick={handleGetSuggestions}>
                    Refresh ✦
                  </button>
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .jd-page { padding: 32px; }
        .back-link {
          background: none; border: none; color: rgba(242,240,234,0.5);
          font-size: 13px; cursor: pointer; margin-bottom: 24px; display: inline-block;
          padding: 0;
        }
        .back-link:hover { color: var(--color-text); }
        .jd-loading { color: rgba(242,240,234,0.4); font-size: 13px; margin-top: 32px; }
        .jd-layout {
          display: grid; grid-template-columns: 1fr 300px; gap: 28px; align-items: start;
        }
        @media (max-width: 768px) {
          .jd-layout { grid-template-columns: 1fr; }
          .jd-panel { order: -1; }
        }
        .jd-title { font-size: 30px; margin-bottom: 12px; line-height: 1.2; }
        .jd-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
        .jd-meta-item {
          font-size: 13px; color: rgba(242,240,234,0.6);
          background: rgba(255,255,255,0.05); border: 1px solid var(--color-border);
          border-radius: 20px; padding: 3px 10px;
        }
        .jd-link { color: var(--color-accent) !important; text-decoration: none; }
        .mono { font-family: "DM Mono", monospace; }
        .jd-score-block {
          display: flex; gap: 20px; align-items: flex-start;
          padding: 16px; border-radius: var(--radius-card);
          background: rgba(255,255,255,0.03); border: 1px solid var(--color-border);
          margin-bottom: 24px;
        }
        .jd-score-number {
          font-size: 48px; font-weight: 700; font-family: "DM Mono", monospace;
          line-height: 1; display: flex; flex-direction: column; align-items: center;
          min-width: 70px;
        }
        .jd-score-label { font-size: 11px; font-weight: 400; opacity: 0.6; margin-top: 2px; font-family: "DM Sans", sans-serif; }
        .jd-breakdown { flex: 1; display: flex; flex-direction: column; gap: 8px; }
        .breakdown-row { display: flex; flex-direction: column; gap: 4px; }
        .breakdown-label { display: flex; justify-content: space-between; font-size: 11px; color: rgba(242,240,234,0.55); }
        .breakdown-track { height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden; }
        .breakdown-fill { height: 100%; border-radius: 2px; transition: width 0.4s ease; }
        .jd-section-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; font-family: "DM Sans", sans-serif; }
        .jd-description { margin-top: 4px; }
        .jd-body {
          white-space: pre-wrap; font-family: inherit; font-size: 13px;
          line-height: 1.7; color: rgba(242,240,234,0.75);
          max-height: 600px; overflow-y: auto;
        }
        .jd-panel-inner { padding: 20px; display: flex; flex-direction: column; gap: 12px; position: sticky; top: 24px; }
        .jd-pipeline-btn, .jd-cover-btn { width: 100%; padding: 10px; }
        .jd-suggestions { margin-top: 4px; }
        .suggestions-header {
          display: flex; align-items: center; gap: 6px;
          font-size: 12px; font-weight: 600; text-transform: uppercase;
          letter-spacing: 0.5px; color: rgba(242,240,234,0.55); margin-bottom: 10px;
        }
        .suggestions-trigger { width: 100%; font-size: 12px; padding: 7px; }
        .suggestions-loading { font-size: 12px; color: rgba(242,240,234,0.4); text-align: center; padding: 8px 0; }
        .suggestions-error { font-size: 12px; color: #f87171; }
        .suggestions-list { list-style: none; display: flex; flex-direction: column; gap: 8px; }
        .suggestion-chip {
          display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
          background: rgba(255,255,255,0.04); border: 1px solid var(--color-border);
          border-radius: var(--radius-btn); padding: 8px 10px; font-size: 12px;
          line-height: 1.5; color: rgba(242,240,234,0.8);
        }
        .chip-dismiss {
          background: none; border: none; color: rgba(242,240,234,0.3);
          font-size: 14px; cursor: pointer; flex-shrink: 0; padding: 0; line-height: 1;
        }
        .chip-dismiss:hover { color: rgba(242,240,234,0.7); }
      `}</style>
    </div>
  )
}

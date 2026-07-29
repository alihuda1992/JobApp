import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAppStore } from '@/store/useAppStore'
import type { Job, InterviewStep } from '@/types'

type AppStatus = 'saved' | 'applied' | 'interviewing' | 'offer' | 'closed' | 'rejected'
type StepFormat = NonNullable<InterviewStep['format']>
type StepStatus = InterviewStep['status']

const STATUS_OPTIONS: { value: AppStatus; label: string }[] = [
  { value: 'saved', label: 'Saved' },
  { value: 'applied', label: 'Applied' },
  { value: 'interviewing', label: 'Interviewing' },
  { value: 'offer', label: 'Offer' },
  { value: 'closed', label: 'Closed' },
  { value: 'rejected', label: 'Rejected' },
]

const STEP_STATUS_OPTIONS: { value: StepStatus; label: string }[] = [
  { value: 'pending_schedule', label: 'Pending schedule' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const STEP_FORMAT_OPTIONS: { value: StepFormat; label: string }[] = [
  { value: 'phone', label: 'Phone' },
  { value: 'video_live', label: 'Video (live)' },
  { value: 'take_home', label: 'Take-home' },
  { value: 'onsite', label: 'Onsite' },
  { value: 'other', label: 'Other' },
]

const STEP_FORMAT_LABEL: Record<StepFormat, string> = {
  phone: 'Phone', video_live: 'Video', take_home: 'Take-home', onsite: 'Onsite', other: 'Other',
}

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface AppFields {
  id: string
  status: AppStatus
  notes: string | null
  next_step: string | null
  applied_at: string | null
  archived_at: string | null
  needs_review: boolean
}

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

  const [application, setApplication] = useState<AppFields | null>(null)
  const [statusDraft, setStatusDraft] = useState<AppStatus>('saved')
  const [notesDraft, setNotesDraft] = useState('')
  const [nextStepDraft, setNextStepDraft] = useState('')
  const [savingApp, setSavingApp] = useState(false)
  const [removing, setRemoving] = useState(false)

  const [interviewSteps, setInterviewSteps] = useState<InterviewStep[]>([])
  const [addingStep, setAddingStep] = useState(false)
  const [stepTitleDraft, setStepTitleDraft] = useState('')
  const [stepRoundDraft, setStepRoundDraft] = useState(1)
  const [stepFormatDraft, setStepFormatDraft] = useState<StepFormat | ''>('')
  const [stepDurationDraft, setStepDurationDraft] = useState('')
  const [stepInterviewerDraft, setStepInterviewerDraft] = useState('')
  const [savingNewStep, setSavingNewStep] = useState(false)

  const [editingJob, setEditingJob] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [companyDraft, setCompanyDraft] = useState('')
  const [savingJob, setSavingJob] = useState(false)

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
      const { data: app } = await supabase
        .from('applications')
        .select('id, status, notes, next_step, applied_at, archived_at, needs_review')
        .eq('job_id', jobId)
        .maybeSingle()
      setInPipeline(!!app)
      if (app) {
        const a = app as AppFields
        setApplication(a)
        setStatusDraft(a.status)
        setNotesDraft(a.notes ?? '')
        setNextStepDraft(a.next_step ?? '')
        loadInterviewSteps(a.id)
      } else {
        setApplication(null)
        setInterviewSteps([])
      }
    }
    setLoading(false)
  }

  async function loadInterviewSteps(applicationId: string) {
    const { data } = await supabase
      .from('interview_steps')
      .select('id, application_id, round_number, sequence_in_round, title, format, duration_minutes, interviewer, scheduled_at, status, source, notes')
      .eq('application_id', applicationId)
      .order('round_number', { ascending: true })
      .order('sequence_in_round', { ascending: true })
    setInterviewSteps((data as InterviewStep[]) ?? [])
  }

  async function updateStep(stepId: string, patch: Record<string, unknown>) {
    setInterviewSteps((prev) => prev.map((s) => (s.id === stepId ? ({ ...s, ...patch } as InterviewStep) : s)))
    await supabase.from('interview_steps').update({ ...patch, last_actor: 'user' }).eq('id', stepId)
  }

  async function deleteStep(stepId: string) {
    setInterviewSteps((prev) => prev.filter((s) => s.id !== stepId))
    await supabase.from('interview_steps').update({ last_actor: 'user' }).eq('id', stepId)
    await supabase.from('interview_steps').delete().eq('id', stepId)
  }

  function openAddStep() {
    setStepRoundDraft(interviewSteps.length ? Math.max(...interviewSteps.map((s) => s.round_number)) : 1)
    setStepTitleDraft('')
    setStepFormatDraft('')
    setStepDurationDraft('')
    setStepInterviewerDraft('')
    setAddingStep(true)
  }

  async function submitNewStep() {
    if (!application || !stepTitleDraft.trim() || savingNewStep) return
    setSavingNewStep(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSavingNewStep(false); return }
    const sequence = interviewSteps.filter((s) => s.round_number === stepRoundDraft).length + 1
    const { data, error } = await supabase
      .from('interview_steps')
      .insert({
        user_id: user.id,
        application_id: application.id,
        round_number: stepRoundDraft,
        sequence_in_round: sequence,
        title: stepTitleDraft.trim(),
        format: stepFormatDraft || null,
        duration_minutes: stepDurationDraft ? Number(stepDurationDraft) : null,
        interviewer: stepInterviewerDraft.trim() || null,
        status: 'pending_schedule',
        source: 'manual',
        last_actor: 'user',
      })
      .select()
      .single()
    if (!error && data) {
      setInterviewSteps((prev) =>
        [...prev, data as InterviewStep].sort(
          (a, b) => a.round_number - b.round_number || a.sequence_in_round - b.sequence_in_round
        )
      )
      setAddingStep(false)
    }
    setSavingNewStep(false)
  }

  const appDirty =
    !!application &&
    (statusDraft !== application.status ||
      notesDraft !== (application.notes ?? '') ||
      nextStepDraft !== (application.next_step ?? ''))

  async function saveApplicationEdits() {
    if (!application || savingApp) return
    setSavingApp(true)
    const patch: Record<string, unknown> = { last_actor: 'user' }
    if (statusDraft !== application.status) {
      patch.status = statusDraft
      if (statusDraft === 'applied' && !application.applied_at) patch.applied_at = new Date().toISOString()
    }
    if (notesDraft !== (application.notes ?? '')) patch.notes = notesDraft || null
    if (nextStepDraft !== (application.next_step ?? '')) patch.next_step = nextStepDraft || null

    const { error } = await supabase.from('applications').update(patch).eq('id', application.id)
    if (!error) {
      setApplication({
        ...application,
        status: statusDraft,
        notes: notesDraft || null,
        next_step: nextStepDraft || null,
        applied_at: (patch.applied_at as string) ?? application.applied_at,
      })
    }
    setSavingApp(false)
  }

  async function removeFromPipeline() {
    if (!application || removing) return
    setRemoving(true)
    await supabase.from('applications').update({ last_actor: 'user' }).eq('id', application.id)
    await supabase.from('applications').delete().eq('id', application.id)
    setApplication(null)
    setInPipeline(false)
    setInterviewSteps([])
    setRemoving(false)
  }

  async function approveReview() {
    if (!application) return
    const { error } = await supabase
      .from('applications')
      .update({ needs_review: false, last_actor: 'user' })
      .eq('id', application.id)
    if (!error) setApplication({ ...application, needs_review: false })
  }

  async function restoreFromArchive() {
    if (!application) return
    const { error } = await supabase
      .from('applications')
      .update({ archived_at: null, last_actor: 'user' })
      .eq('id', application.id)
    if (!error) setApplication({ ...application, archived_at: null })
  }

  function startEditingJob() {
    if (!job) return
    setTitleDraft(job.title)
    setCompanyDraft(job.company ?? '')
    setEditingJob(true)
  }

  async function saveJobEdits() {
    if (!job || !titleDraft.trim() || savingJob) return
    setSavingJob(true)
    const patch = { title: titleDraft.trim(), company: companyDraft.trim() || null }
    const { error } = await supabase.from('jobs').update(patch).eq('id', job.id)
    if (!error) {
      setJob({ ...job, ...patch })
      setEditingJob(false)
    }
    setSavingJob(false)
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

    const { data: app } = await supabase
      .from('applications')
      .insert({ user_id: user.id, job_id: dbJobId, status: 'saved', last_actor: 'user' })
      .select('id, status, notes, next_step, applied_at, archived_at, needs_review')
      .single()

    addSavedJobId(job.id)
    setInPipeline(true)
    if (app) {
      const a = app as AppFields
      setApplication(a)
      setStatusDraft(a.status)
      setNotesDraft(a.notes ?? '')
      setNextStepDraft(a.next_step ?? '')
      setInterviewSteps([])
    }
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
          {editingJob ? (
            <div className="jd-edit-job">
              <input
                className="jd-edit-input jd-edit-title"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                placeholder="Job title"
                autoFocus
              />
              <input
                className="jd-edit-input"
                value={companyDraft}
                onChange={(e) => setCompanyDraft(e.target.value)}
                placeholder="Company"
              />
              <div className="jd-edit-actions">
                <button className="btn btn-primary" onClick={saveJobEdits} disabled={!titleDraft.trim() || savingJob}>
                  {savingJob ? 'Saving…' : 'Save'}
                </button>
                <button className="btn btn-ghost" onClick={() => setEditingJob(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <h1 className="jd-title">
              {job.title}
              {job.user_id && (
                <button className="jd-edit-trigger" onClick={startEditingJob} title="Edit title / company">✎</button>
              )}
            </h1>
          )}

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
                <span className="jd-score-val">{job.match_score}<span className="jd-score-pct">%</span></span>
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
            <div className="jd-body">{job.description}</div>
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

            {application?.needs_review && (
              <div className="jd-review-banner">
                <span>Pending your review — added from inferred evidence, not yet confirmed.</span>
                <div className="jd-review-actions">
                  <button className="btn btn-ghost" onClick={approveReview}>Approve</button>
                  <button className="btn btn-ghost jd-danger" onClick={removeFromPipeline} disabled={removing}>
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {application?.archived_at && (
              <div className="jd-review-banner">
                <span>Archived (30+ days untouched in a closed status).</span>
                <div className="jd-review-actions">
                  <button className="btn btn-ghost" onClick={restoreFromArchive}>Restore</button>
                </div>
              </div>
            )}

            {application && !application.needs_review && (
              <div className="jd-app-edit">
                <label className="jd-field-label">Status</label>
                <select
                  className="jd-select"
                  value={statusDraft}
                  onChange={(e) => setStatusDraft(e.target.value as AppStatus)}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>

                <label className="jd-field-label">Notes</label>
                <textarea
                  className="jd-textarea"
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  placeholder="Add a note…"
                  rows={4}
                />

                <label className="jd-field-label">Next step</label>
                <input
                  className="jd-edit-input"
                  value={nextStepDraft}
                  onChange={(e) => setNextStepDraft(e.target.value)}
                  placeholder="e.g. Follow up Friday"
                />

                <button className="btn btn-primary jd-save-btn" onClick={saveApplicationEdits} disabled={!appDirty || savingApp}>
                  {savingApp ? 'Saving…' : 'Save changes'}
                </button>

                <button className="btn btn-ghost jd-danger jd-remove-btn" onClick={removeFromPipeline} disabled={removing}>
                  {removing ? 'Removing…' : 'Remove from Pipeline'}
                </button>
              </div>
            )}

            {application && (
              <div className="jd-steps">
                <div className="jd-steps-header">
                  <span className="jd-field-label" style={{ marginTop: 0 }}>Interview Steps</span>
                  {!!interviewSteps.length && (
                    <span className="jd-steps-progress">
                      {interviewSteps.filter((s) => s.status === 'completed').length}/{interviewSteps.length}
                    </span>
                  )}
                </div>

                {Object.entries(
                  interviewSteps.reduce<Record<number, InterviewStep[]>>((acc, s) => {
                    (acc[s.round_number] ??= []).push(s)
                    return acc
                  }, {})
                )
                  .map(([round, steps]) => [Number(round), steps] as [number, InterviewStep[]])
                  .sort((a, b) => a[0] - b[0])
                  .map(([round, steps]) => (
                    <div className="jd-round" key={round}>
                      <div className="jd-round-label">Round {round}</div>
                      {steps.map((step) => (
                        <div className="jd-step-row" key={step.id}>
                          <div className="jd-step-main">
                            <span className="jd-step-title">{step.title}</span>
                            <button className="jd-step-del" onClick={() => deleteStep(step.id)} title="Delete step">×</button>
                          </div>
                          {(step.format || step.duration_minutes) && (
                            <div className="jd-step-chips">
                              {step.format && <span className="jd-step-chip">{STEP_FORMAT_LABEL[step.format]}</span>}
                              {step.duration_minutes && <span className="jd-step-chip">{step.duration_minutes} min</span>}
                            </div>
                          )}

                          <select
                            className="jd-step-select"
                            value={step.status}
                            onChange={(e) => updateStep(step.id, { status: e.target.value })}
                          >
                            {STEP_STATUS_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>

                          <input
                            type="datetime-local"
                            className="jd-step-input"
                            value={toDatetimeLocalValue(step.scheduled_at)}
                            onChange={(e) =>
                              updateStep(step.id, {
                                scheduled_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                              })
                            }
                          />

                          <input
                            className="jd-step-input"
                            placeholder="Interviewer"
                            defaultValue={step.interviewer ?? ''}
                            onBlur={(e) => {
                              if (e.target.value !== (step.interviewer ?? '')) {
                                updateStep(step.id, { interviewer: e.target.value || null })
                              }
                            }}
                          />

                          <textarea
                            className="jd-step-textarea"
                            placeholder="Notes…"
                            defaultValue={step.notes ?? ''}
                            rows={2}
                            onBlur={(e) => {
                              if (e.target.value !== (step.notes ?? '')) {
                                updateStep(step.id, { notes: e.target.value || null })
                              }
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  ))}

                {addingStep ? (
                  <div className="jd-step-add-form">
                    <input
                      className="jd-edit-input"
                      placeholder="Step title (e.g. Live case interview)"
                      value={stepTitleDraft}
                      onChange={(e) => setStepTitleDraft(e.target.value)}
                      autoFocus
                    />
                    <div className="jd-step-add-row">
                      <input
                        type="number"
                        min={1}
                        className="jd-step-input jd-step-input--num"
                        placeholder="Round"
                        value={stepRoundDraft}
                        onChange={(e) => setStepRoundDraft(Number(e.target.value) || 1)}
                      />
                      <input
                        type="number"
                        min={1}
                        className="jd-step-input jd-step-input--num"
                        placeholder="Min"
                        value={stepDurationDraft}
                        onChange={(e) => setStepDurationDraft(e.target.value)}
                      />
                    </div>
                    <select
                      className="jd-step-select"
                      value={stepFormatDraft}
                      onChange={(e) => setStepFormatDraft(e.target.value as StepFormat | '')}
                    >
                      <option value="">Format…</option>
                      {STEP_FORMAT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <input
                      className="jd-edit-input"
                      placeholder="Interviewer (optional)"
                      value={stepInterviewerDraft}
                      onChange={(e) => setStepInterviewerDraft(e.target.value)}
                    />
                    <div className="jd-edit-actions">
                      <button
                        className="btn btn-primary"
                        onClick={submitNewStep}
                        disabled={!stepTitleDraft.trim() || savingNewStep}
                      >
                        {savingNewStep ? 'Adding…' : 'Add step'}
                      </button>
                      <button className="btn btn-ghost" onClick={() => setAddingStep(false)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button className="btn btn-ghost jd-step-add-btn" onClick={openAddStep}>+ Add step</button>
                )}
              </div>
            )}

            <button
              className="btn btn-ghost jd-cover-btn"
              onClick={() => navigate(`/cover/${job.id}`)}
              disabled={!inPipeline}
              title={!inPipeline ? 'Save to pipeline first' : undefined}
            >
              Generate Cover Letter
            </button>

            <button
              className="btn btn-ghost jd-cover-btn"
              onClick={() => navigate(`/tailored-resume/${job.id}`)}
              disabled={!inPipeline}
              title={!inPipeline ? 'Save to pipeline first' : undefined}
            >
              Tailor Resume ✦
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
        .jd-page { padding: 32px; max-width: 1200px; }
        .back-link {
          background: none; border: none; color: rgba(242,240,234,0.45);
          font-size: 13px; cursor: pointer; margin-bottom: 28px; display: inline-block; padding: 0;
        }
        .back-link:hover { color: var(--color-text); }
        .jd-loading { color: rgba(242,240,234,0.4); font-size: 13px; margin-top: 32px; }

        .jd-layout {
          display: grid; grid-template-columns: 1fr 280px; gap: 32px; align-items: start;
        }
        @media (max-width: 860px) {
          .jd-layout { grid-template-columns: 1fr; }
          .jd-panel { order: -1; }
        }
        @media (max-width: 600px) {
          .jd-page { padding: 16px; }
          .back-link { margin-bottom: 16px; }
          .jd-title { font-size: 20px; margin-bottom: 10px; }
          .jd-score-block { flex-direction: column; gap: 16px; padding: 14px; }
          .jd-score-number { flex-direction: row; align-items: baseline; gap: 10px; min-width: 0; }
          .jd-score-val { font-size: 38px; }
          .jd-score-label { margin-top: 0; }
          .jd-body { max-height: 320px; }
          .jd-panel-inner { position: static; }
          .jd-layout { gap: 16px; }
        }

        .jd-title { font-size: 28px; margin-bottom: 14px; line-height: 1.25; }
        .jd-meta { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 24px; }
        .jd-meta-item {
          font-size: 12px; color: rgba(242,240,234,0.6);
          background: rgba(255,255,255,0.05); border: 1px solid var(--color-border);
          border-radius: 20px; padding: 3px 11px;
        }
        .jd-link { color: var(--color-accent) !important; text-decoration: none; }
        .mono { font-family: "DM Mono", monospace; }

        /* Score block */
        .jd-score-block {
          display: flex; gap: 24px; align-items: center;
          padding: 20px; border-radius: var(--radius-card);
          background: rgba(255,255,255,0.025); border: 1px solid var(--color-border);
          margin-bottom: 28px;
        }
        .jd-score-number {
          display: flex; flex-direction: column; align-items: center;
          min-width: 76px; flex-shrink: 0;
        }
        .jd-score-val {
          font-size: 52px; font-weight: 700; font-family: "DM Mono", monospace; line-height: 1;
        }
        .jd-score-pct { font-size: 22px; font-weight: 500; opacity: 0.65; }
        .jd-score-label {
          font-size: 11px; font-weight: 400; opacity: 0.5; margin-top: 4px;
          font-family: "DM Sans", sans-serif; text-transform: uppercase; letter-spacing: 0.5px;
        }
        .jd-breakdown { flex: 1; display: flex; flex-direction: column; gap: 10px; }
        .breakdown-row { display: flex; flex-direction: column; gap: 5px; }
        .breakdown-label {
          display: flex; justify-content: space-between;
          font-size: 11px; color: rgba(242,240,234,0.5);
        }
        .breakdown-track { height: 5px; background: rgba(255,255,255,0.07); border-radius: 3px; overflow: hidden; }
        .breakdown-fill { height: 100%; border-radius: 3px; transition: width 0.5s ease; }

        /* Description */
        .jd-description { margin-top: 0; }
        .jd-section-title {
          font-size: 12px; font-weight: 600; margin-bottom: 14px;
          font-family: "DM Sans", sans-serif; text-transform: uppercase;
          letter-spacing: 0.5px; color: rgba(242,240,234,0.45);
        }
        .jd-body {
          font-size: 13px; line-height: 1.8; color: rgba(242,240,234,0.72);
          max-height: 560px; overflow-y: auto; white-space: pre-wrap;
        }

        /* Right panel */
        .jd-panel-inner {
          padding: 20px; display: flex; flex-direction: column; gap: 10px;
          position: sticky; top: 24px;
        }
        .jd-pipeline-btn, .jd-cover-btn { width: 100%; padding: 10px; }
        .jd-suggestions { margin-top: 8px; }
        .suggestions-header {
          display: flex; align-items: center; gap: 6px;
          font-size: 11px; font-weight: 600; text-transform: uppercase;
          letter-spacing: 0.5px; color: rgba(242,240,234,0.45); margin-bottom: 10px;
        }
        .suggestions-trigger { width: 100%; font-size: 12px; padding: 7px; }
        .suggestions-loading { font-size: 12px; color: rgba(242,240,234,0.4); text-align: center; padding: 8px 0; }
        .suggestions-error { font-size: 12px; color: #f87171; }
        .suggestions-list { list-style: none; display: flex; flex-direction: column; gap: 7px; }
        .suggestion-chip {
          display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
          background: rgba(255,255,255,0.03); border: 1px solid var(--color-border);
          border-radius: var(--radius-btn); padding: 8px 10px; font-size: 12px;
          line-height: 1.5; color: rgba(242,240,234,0.75);
        }
        .chip-dismiss {
          background: none; border: none; color: rgba(242,240,234,0.25);
          font-size: 14px; cursor: pointer; flex-shrink: 0; padding: 0; line-height: 1;
        }
        .chip-dismiss:hover { color: rgba(242,240,234,0.65); }

        /* Job title inline edit */
        .jd-title { display: flex; align-items: baseline; gap: 10px; }
        .jd-edit-trigger {
          background: none; border: none; color: rgba(242,240,234,0.3);
          font-size: 15px; cursor: pointer; padding: 0; flex-shrink: 0;
        }
        .jd-edit-trigger:hover { color: var(--color-accent); }
        .jd-edit-job { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
        .jd-edit-input {
          width: 100%; box-sizing: border-box; background: rgba(255,255,255,0.03);
          border: 1px solid var(--color-border); border-radius: var(--radius-btn);
          color: var(--color-text); font-size: 14px; padding: 8px 10px; font-family: inherit;
        }
        .jd-edit-title { font-size: 20px; font-weight: 600; }
        .jd-edit-actions { display: flex; gap: 8px; }

        /* Application (pipeline) edit panel */
        .jd-app-edit {
          display: flex; flex-direction: column; gap: 6px;
          padding: 12px 0 4px; margin-top: 2px;
          border-top: 1px solid var(--color-border);
        }
        .jd-field-label {
          font-size: 11px; font-weight: 600; text-transform: uppercase;
          letter-spacing: 0.4px; color: rgba(242,240,234,0.4); margin-top: 6px;
        }
        .jd-select, .jd-textarea {
          width: 100%; box-sizing: border-box; background: rgba(255,255,255,0.03);
          border: 1px solid var(--color-border); border-radius: var(--radius-btn);
          color: var(--color-text); font-size: 13px; padding: 8px 10px; font-family: inherit;
          resize: vertical;
        }
        .jd-save-btn { width: 100%; margin-top: 6px; }
        .jd-remove-btn { width: 100%; }
        .jd-danger { color: oklch(65% 0.18 25) !important; }
        .jd-review-banner {
          display: flex; flex-direction: column; gap: 8px;
          font-size: 12px; color: var(--color-secondary);
          background: rgba(255,193,99,0.08); border: 1px solid rgba(255,193,99,0.3);
          border-radius: var(--radius-btn); padding: 10px 12px; margin-top: 4px;
        }
        .jd-review-actions { display: flex; gap: 8px; }
        .jd-review-actions .btn { flex: 1; font-size: 12px; padding: 6px 10px; }

        /* Interview steps */
        .jd-steps {
          display: flex; flex-direction: column; gap: 10px;
          padding: 12px 0 4px; margin-top: 2px;
          border-top: 1px solid var(--color-border);
        }
        .jd-steps-header { display: flex; align-items: center; justify-content: space-between; }
        .jd-steps-progress {
          font-size: 12px; font-family: "DM Mono", monospace; color: var(--color-secondary);
        }
        .jd-round { display: flex; flex-direction: column; gap: 8px; }
        .jd-round-label {
          font-size: 11px; font-weight: 600; text-transform: uppercase;
          letter-spacing: 0.4px; color: rgba(242,240,234,0.4);
        }
        .jd-step-row {
          display: flex; flex-direction: column; gap: 6px;
          background: rgba(255,255,255,0.03); border: 1px solid var(--color-border);
          border-radius: var(--radius-btn); padding: 10px;
        }
        .jd-step-main { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; }
        .jd-step-title { font-size: 13px; font-weight: 600; line-height: 1.35; }
        .jd-step-del {
          background: none; border: none; color: rgba(242,240,234,0.25);
          font-size: 15px; line-height: 1; cursor: pointer; flex-shrink: 0; padding: 0;
        }
        .jd-step-del:hover { color: oklch(65% 0.18 25); }
        .jd-step-chips { display: flex; flex-wrap: wrap; gap: 5px; }
        .jd-step-chip {
          font-size: 11px; color: rgba(242,240,234,0.55);
          background: rgba(255,255,255,0.05); border: 1px solid var(--color-border);
          border-radius: 20px; padding: 2px 8px;
        }
        .jd-step-select, .jd-step-input, .jd-step-textarea {
          width: 100%; box-sizing: border-box; background: rgba(255,255,255,0.03);
          border: 1px solid var(--color-border); border-radius: var(--radius-btn);
          color: var(--color-text); font-size: 12px; padding: 6px 8px; font-family: inherit;
          resize: vertical;
        }
        .jd-step-textarea { resize: vertical; }
        .jd-step-add-row { display: flex; gap: 6px; }
        .jd-step-input--num { min-width: 0; }
        .jd-step-add-form { display: flex; flex-direction: column; gap: 6px; }
        .jd-step-add-btn { width: 100%; font-size: 12px; padding: 7px; }
      `}</style>
    </div>
  )
}

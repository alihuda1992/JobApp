import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAppStore } from '@/store/useAppStore'
import type { Job, ResumeJSON } from '@/types'

function resumeToText(r: ResumeJSON, name?: string | null): string {
  const lines: string[] = []
  if (name) lines.push(name, '')
  if (r.summary) { lines.push('SUMMARY', r.summary, '') }
  if (r.experience?.length) {
    lines.push('EXPERIENCE')
    r.experience.forEach(e => {
      lines.push(`${e.title} · ${e.company}${e.location ? ` · ${e.location}` : ''} (${e.start_date} – ${e.end_date ?? 'Present'})`)
      e.bullets.forEach(b => lines.push(`  • ${b}`))
      lines.push('')
    })
  }
  if (r.skills?.length) {
    lines.push('SKILLS')
    lines.push(r.skills.join(', '), '')
  }
  if (r.education?.length) {
    lines.push('EDUCATION')
    r.education.forEach(e => {
      lines.push(`${e.degree}${e.field ? ` in ${e.field}` : ''} · ${e.institution} (${e.graduation_year})`)
    })
    lines.push('')
  }
  if (r.certifications?.length) {
    lines.push('CERTIFICATIONS')
    r.certifications.forEach(c => lines.push(`  • ${c}`))
  }
  return lines.join('\n').trim()
}

export function TailoredResume() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()
  const { resume: storeResume, profile } = useAppStore()

  const [job, setJob] = useState<Job | null>(null)
  const [resumeParsed, setResumeParsed] = useState<ResumeJSON | null>(null)
  const [loading, setLoading] = useState(true)

  const [tailored, setTailored] = useState<ResumeJSON | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (jobId) loadData(jobId)
  }, [jobId])

  async function loadData(jid: string) {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { navigate('/login'); return }

    const [jobResult, resumeResult] = await Promise.all([
      supabase.from('jobs').select('*').eq('id', jid).single(),
      supabase.from('resumes').select('parsed').eq('user_id', user.id).eq('is_active', true)
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ])

    if (jobResult.data) setJob(jobResult.data as Job)
    setResumeParsed(resumeResult.data?.parsed ?? storeResume?.parsed ?? null)
    setLoading(false)
  }

  async function handleGenerate() {
    if (!job || !resumeParsed || generating) return
    setGenerating(true)
    setError(null)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('ai-tailor-resume', {
        body: { resume_parsed: resumeParsed, job_description: job.description },
      })
      if (fnError) throw fnError
      if (!data?.tailored) throw new Error('No output returned')
      setTailored(data.tailored as ResumeJSON)
    } catch {
      setError('Could not generate tailored resume — try again.')
    } finally {
      setGenerating(false)
    }
  }

  async function handleCopy() {
    if (!tailored) return
    await navigator.clipboard.writeText(resumeToText(tailored, profile?.full_name))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) return <div className="tr-page"><div className="tr-loading">Loading…</div></div>

  return (
    <div className="tr-page">
      <button className="back-link" onClick={() => navigate(-1)}>← Back</button>

      <h1 className="tr-title">Tailored Resume</h1>

      {job && (
        <div className="tr-job-context">
          <span className="tr-job-title">{job.title}</span>
          {job.company && <span className="tr-job-company">@ {job.company}</span>}
        </div>
      )}

      {!resumeParsed && (
        <p className="tr-no-resume">
          No resume found.{' '}
          <button className="tr-text-link" onClick={() => navigate('/resume')}>Upload one first.</button>
        </p>
      )}

      <div className="tr-actions">
        <button
          className="btn btn-primary tr-generate-btn"
          onClick={handleGenerate}
          disabled={!resumeParsed || generating}
          title={!resumeParsed ? 'Upload your resume first' : undefined}
        >
          {generating ? 'Tailoring…' : tailored ? 'Regenerate ✦' : 'Generate Tailored Resume ✦'}
        </button>

        {tailored && !generating && (
          <button className="btn btn-ghost tr-copy-btn" onClick={handleCopy}>
            {copied ? 'Copied ✓' : 'Copy as Text'}
          </button>
        )}
      </div>

      {error && <p className="tr-error">{error}</p>}

      {generating && (
        <div className="tr-generating">
          <div className="tr-dots"><span /><span /><span /></div>
          <span>Tailoring your resume for this role…</span>
        </div>
      )}

      {tailored && !generating && (
        <div className="tr-output">

          {/* Summary */}
          {tailored.summary && (
            <div className="tr-section">
              <h2 className="tr-section-title">Summary</h2>
              <p className="tr-summary">{tailored.summary}</p>
            </div>
          )}

          {/* Experience */}
          {tailored.experience?.length > 0 && (
            <div className="tr-section">
              <h2 className="tr-section-title">Experience</h2>
              <div className="tr-exp-list">
                {tailored.experience.map((exp, i) => (
                  <div key={i} className="tr-exp-card">
                    <div className="tr-exp-header">
                      <div>
                        <div className="tr-exp-title">{exp.title}</div>
                        <div className="tr-exp-meta">
                          {exp.company}{exp.location ? ` · ${exp.location}` : ''}
                          <span className="tr-exp-dates"> · {exp.start_date} – {exp.end_date ?? 'Present'}</span>
                        </div>
                      </div>
                    </div>
                    <ul className="tr-bullets">
                      {exp.bullets.map((b, j) => <li key={j}>{b}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Skills */}
          {tailored.skills?.length > 0 && (
            <div className="tr-section">
              <h2 className="tr-section-title">Skills</h2>
              <div className="tr-skills">
                {tailored.skills.map((s, i) => <span key={i} className="tr-skill-tag">{s}</span>)}
              </div>
            </div>
          )}

          {/* Education */}
          {tailored.education?.length > 0 && (
            <div className="tr-section">
              <h2 className="tr-section-title">Education</h2>
              {tailored.education.map((edu, i) => (
                <div key={i} className="tr-edu-item">
                  <div className="tr-edu-degree">{edu.degree}{edu.field ? ` in ${edu.field}` : ''}</div>
                  <div className="tr-edu-meta">{edu.institution} · {edu.graduation_year}</div>
                </div>
              ))}
            </div>
          )}

          {/* Certifications */}
          {tailored.certifications?.length > 0 && (
            <div className="tr-section">
              <h2 className="tr-section-title">Certifications</h2>
              <ul className="tr-cert-list">
                {tailored.certifications.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}

        </div>
      )}

      <style>{`
        .tr-page { padding: 32px; max-width: 820px; }
        .back-link {
          background: none; border: none; color: rgba(242,240,234,0.45);
          font-size: 13px; cursor: pointer; margin-bottom: 24px; display: inline-block; padding: 0;
        }
        .back-link:hover { color: var(--color-text); }
        .tr-loading { color: rgba(242,240,234,0.4); font-size: 13px; margin-top: 32px; }
        .tr-title { font-size: 30px; margin-bottom: 8px; line-height: 1.2; }
        .tr-job-context { display: flex; align-items: center; gap: 8px; margin-bottom: 28px; }
        .tr-job-title { font-size: 15px; font-weight: 600; }
        .tr-job-company { font-size: 14px; color: rgba(242,240,234,0.5); }
        .tr-no-resume { font-size: 13px; color: rgba(242,240,234,0.45); margin-bottom: 16px; }
        .tr-text-link { background: none; border: none; color: var(--color-accent); cursor: pointer; font-size: 13px; padding: 0; text-decoration: underline; }
        .tr-actions { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
        .tr-generate-btn { padding: 10px 24px; }
        .tr-copy-btn { padding: 10px 18px; }
        .tr-error { color: #f87171; font-size: 13px; margin-bottom: 12px; }
        .tr-generating {
          display: flex; align-items: center; gap: 10px;
          color: rgba(242,240,234,0.4); font-size: 13px; margin: 16px 0;
        }
        .tr-dots { display: flex; gap: 4px; }
        .tr-dots span {
          width: 6px; height: 6px; border-radius: 50%; background: var(--color-accent);
          animation: tr-bounce 1s ease-in-out infinite;
        }
        .tr-dots span:nth-child(2) { animation-delay: 0.15s; }
        .tr-dots span:nth-child(3) { animation-delay: 0.3s; }
        @keyframes tr-bounce {
          0%,100% { transform: translateY(0); opacity: 0.4; }
          50% { transform: translateY(-5px); opacity: 1; }
        }

        /* Output */
        .tr-output { display: flex; flex-direction: column; gap: 0; }
        .tr-section {
          padding: 24px 0;
          border-bottom: 1px solid var(--color-border);
        }
        .tr-section:last-child { border-bottom: none; }
        .tr-section-title {
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.6px; color: rgba(242,240,234,0.4);
          margin-bottom: 14px; font-family: "DM Sans", sans-serif;
        }
        .tr-summary { font-size: 13px; line-height: 1.8; color: rgba(242,240,234,0.82); }

        .tr-exp-list { display: flex; flex-direction: column; gap: 20px; }
        .tr-exp-card { }
        .tr-exp-header { margin-bottom: 10px; }
        .tr-exp-title { font-size: 14px; font-weight: 600; margin-bottom: 3px; }
        .tr-exp-meta { font-size: 12px; color: rgba(242,240,234,0.5); }
        .tr-exp-dates { }
        .tr-bullets { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 5px; }
        .tr-bullets li { font-size: 13px; line-height: 1.65; color: rgba(242,240,234,0.78); }

        .tr-skills { display: flex; flex-wrap: wrap; gap: 7px; }
        .tr-skill-tag {
          background: rgba(255,255,255,0.05); border: 1px solid var(--color-border);
          border-radius: 20px; padding: 3px 11px; font-size: 12px; color: rgba(242,240,234,0.72);
        }
        .tr-skill-tag:first-child {
          background: rgba(99,139,255,0.12); border-color: rgba(99,139,255,0.3);
          color: var(--color-accent);
        }

        .tr-edu-item { margin-bottom: 8px; }
        .tr-edu-degree { font-size: 13px; font-weight: 600; margin-bottom: 2px; }
        .tr-edu-meta { font-size: 12px; color: rgba(242,240,234,0.5); }

        .tr-cert-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 5px; }
        .tr-cert-list li { font-size: 13px; color: rgba(242,240,234,0.75); }
      `}</style>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAppStore } from '@/store/useAppStore'
import type { Job, ResumeJSON } from '@/types'

const TONES = [
  { value: 'professional', label: 'Professional' },
  { value: 'conversational', label: 'Conversational' },
  { value: 'enthusiastic', label: 'Enthusiastic' },
]

const LENGTHS = [
  { value: 'short', label: 'Short (~150w)' },
  { value: 'medium', label: 'Medium (~300w)' },
  { value: 'long', label: 'Long (~450w)' },
]

export function CoverLetter() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()
  const { resume: storeResume } = useAppStore()

  const [job, setJob] = useState<Job | null>(null)
  const [resumeParsed, setResumeParsed] = useState<ResumeJSON | null>(null)
  const [loading, setLoading] = useState(true)

  const [tone, setTone] = useState('professional')
  const [length, setLength] = useState('medium')
  const [content, setContent] = useState('')
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
      const { data, error: fnError } = await supabase.functions.invoke('ai-generate-cover-letter', {
        body: {
          resume_parsed: resumeParsed,
          job_description: job.description,
          tone,
          length,
          job_id: job.id,
        },
      })
      if (fnError) throw fnError
      setContent(data?.content ?? '')
    } catch {
      setError('Could not generate cover letter — try again.')
    } finally {
      setGenerating(false)
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return <div className="cl-page"><div className="cl-loading">Loading…</div></div>
  }

  return (
    <div className="cl-page">
      <button className="back-link" onClick={() => navigate(-1)}>← Back</button>

      <h1 className="cl-title">Cover Letter</h1>

      {job && (
        <div className="cl-job-context">
          <span className="cl-job-title">{job.title}</span>
          {job.company && <span className="cl-job-company">@ {job.company}</span>}
        </div>
      )}

      <div className="cl-controls">
        <div className="cl-control-group">
          <label className="cl-label">Tone</label>
          <div className="cl-pills">
            {TONES.map(t => (
              <button
                key={t.value}
                className={`cl-pill${tone === t.value ? ' active' : ''}`}
                onClick={() => setTone(t.value)}
              >{t.label}</button>
            ))}
          </div>
        </div>
        <div className="cl-control-group">
          <label className="cl-label">Length</label>
          <div className="cl-pills">
            {LENGTHS.map(l => (
              <button
                key={l.value}
                className={`cl-pill${length === l.value ? ' active' : ''}`}
                onClick={() => setLength(l.value)}
              >{l.label}</button>
            ))}
          </div>
        </div>
      </div>

      {!resumeParsed && (
        <p className="cl-no-resume">
          No resume found.{' '}
          <button className="cl-text-link" onClick={() => navigate('/resume')}>Upload one first.</button>
        </p>
      )}

      <button
        className="btn btn-primary cl-generate-btn"
        onClick={handleGenerate}
        disabled={!resumeParsed || generating}
        title={!resumeParsed ? 'Upload your resume first' : undefined}
      >
        {generating ? 'Generating…' : content ? 'Regenerate ✦' : 'Generate Cover Letter ✦'}
      </button>

      {error && <p className="cl-error">{error}</p>}

      {generating && (
        <div className="cl-generating">
          <div className="cl-dots"><span /><span /><span /></div>
          <span>Writing your cover letter…</span>
        </div>
      )}

      {content && !generating && (
        <div className="cl-output-wrapper">
          <div className="cl-output-header">
            <span className="ai-indicator">✦</span>
            <span>Generated Cover Letter</span>
            <button className="btn btn-ghost cl-copy-btn" onClick={handleCopy}>
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
          <textarea
            className="cl-output"
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={18}
          />
        </div>
      )}

      <style>{`
        .cl-page { padding: 32px; max-width: 760px; }
        .back-link {
          background: none; border: none; color: rgba(242,240,234,0.5);
          font-size: 13px; cursor: pointer; margin-bottom: 24px; display: inline-block; padding: 0;
        }
        .back-link:hover { color: var(--color-text); }
        .cl-loading { color: rgba(242,240,234,0.4); font-size: 13px; margin-top: 32px; }
        .cl-title { font-size: 30px; margin-bottom: 8px; line-height: 1.2; }
        .cl-job-context { display: flex; align-items: center; gap: 8px; margin-bottom: 28px; }
        .cl-job-title { font-size: 15px; font-weight: 600; }
        .cl-job-company { font-size: 14px; color: rgba(242,240,234,0.5); }
        .cl-controls { display: flex; gap: 32px; margin-bottom: 24px; flex-wrap: wrap; }
        .cl-control-group { display: flex; flex-direction: column; gap: 7px; }
        .cl-label {
          font-size: 11px; font-weight: 600; text-transform: uppercase;
          letter-spacing: 0.5px; color: rgba(242,240,234,0.4);
        }
        .cl-pills { display: flex; gap: 6px; }
        .cl-pill {
          background: rgba(255,255,255,0.05); border: 1px solid var(--color-border);
          border-radius: 20px; padding: 4px 12px; font-size: 12px; cursor: pointer;
          color: rgba(242,240,234,0.7); transition: all 0.15s;
        }
        .cl-pill:hover { border-color: var(--color-accent); color: var(--color-text); }
        .cl-pill.active { background: var(--color-accent); border-color: var(--color-accent); color: #fff; }
        .cl-no-resume { font-size: 13px; color: rgba(242,240,234,0.45); margin-bottom: 16px; }
        .cl-text-link { background: none; border: none; color: var(--color-accent); cursor: pointer; font-size: 13px; padding: 0; text-decoration: underline; }
        .cl-generate-btn { padding: 10px 24px; margin-bottom: 16px; }
        .cl-error { color: #f87171; font-size: 13px; margin-bottom: 12px; }
        .cl-generating {
          display: flex; align-items: center; gap: 10px;
          color: rgba(242,240,234,0.4); font-size: 13px; margin: 16px 0;
        }
        .cl-dots { display: flex; gap: 4px; }
        .cl-dots span {
          width: 6px; height: 6px; border-radius: 50%; background: var(--color-accent);
          animation: cl-bounce 1s ease-in-out infinite;
        }
        .cl-dots span:nth-child(2) { animation-delay: 0.15s; }
        .cl-dots span:nth-child(3) { animation-delay: 0.3s; }
        @keyframes cl-bounce {
          0%,100% { transform: translateY(0); opacity: 0.4; }
          50% { transform: translateY(-5px); opacity: 1; }
        }
        .cl-output-wrapper { margin-top: 16px; }
        .cl-output-header {
          display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.5px;
          color: rgba(242,240,234,0.55); margin-bottom: 8px;
        }
        .cl-copy-btn { margin-left: auto; padding: 4px 12px; font-size: 12px; }
        .cl-output {
          width: 100%; background: rgba(255,255,255,0.03); border: 1px solid var(--color-border);
          border-radius: var(--radius-card); padding: 16px; font-family: inherit;
          font-size: 13px; line-height: 1.8; color: rgba(242,240,234,0.85);
          resize: vertical; min-height: 320px; box-sizing: border-box;
        }
        .cl-output:focus { outline: none; border-color: var(--color-accent); }
      `}</style>
    </div>
  )
}

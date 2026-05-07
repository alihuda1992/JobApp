import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAppStore } from '@/store/useAppStore'
import * as pdfjsLib from 'pdfjs-dist'
import mammoth from 'mammoth'
import type { Resume as ResumeType, ResumeJSON } from '@/types'

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`

async function extractText(file: File): Promise<string> {
  if (file.type === 'application/pdf') {
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    const pages: string[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
    }
    return pages.join('\n')
  } else {
    const arrayBuffer = await file.arrayBuffer()
    const result = await mammoth.extractRawText({ arrayBuffer })
    return result.value
  }
}

// ── Rewrite panel shown inline below a section ──────────────────────────────
function RewritePanel({
  loading,
  suggestion,
  onAccept,
  onDismiss,
}: {
  loading: boolean
  suggestion: string | null
  onAccept: (text: string) => void
  onDismiss: () => void
}) {
  const [edited, setEdited] = useState(suggestion ?? '')

  useEffect(() => { if (suggestion) setEdited(suggestion) }, [suggestion])

  if (loading) {
    return (
      <div className="rw-panel rw-loading">
        <div className="rw-dots"><span /><span /><span /></div>
        <span>Rewriting…</span>
      </div>
    )
  }
  if (!suggestion) return null
  return (
    <div className="rw-panel">
      <div className="rw-panel-header">
        <span className="ai-indicator">✦</span>
        <span>AI Suggestion</span>
        <div className="rw-actions">
          <button className="btn btn-primary rw-btn" onClick={() => onAccept(edited)}>Accept</button>
          <button className="btn btn-ghost rw-btn" onClick={onDismiss}>Dismiss</button>
        </div>
      </div>
      <textarea
        className="rw-textarea"
        value={edited}
        onChange={e => setEdited(e.target.value)}
        rows={6}
      />
    </div>
  )
}

// ── Section wrapper card ─────────────────────────────────────────────────────
function SectionCard({
  title,
  onRewrite,
  rewriteDisabled,
  children,
}: {
  title: string
  onRewrite?: () => void
  rewriteDisabled?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="res-section card">
      <div className="res-section-header">
        <h2 className="res-section-title">{title}</h2>
        {onRewrite && (
          <button
            className="btn btn-ghost res-rewrite-btn"
            onClick={onRewrite}
            disabled={rewriteDisabled}
          >
            AI Rewrite ✦
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export function Resume() {
  const navigate = useNavigate()
  const { resume: storeResume, setResume } = useAppStore()

  const [resumeRow, setResumeRow] = useState<ResumeType | null>(null)
  const [draft, setDraft] = useState<ResumeJSON | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Upload
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadStep, setUploadStep] = useState('')
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Per-section editing
  const [editingSection, setEditingSection] = useState<string | null>(null)
  // Temp edit values
  const [editValue, setEditValue] = useState('')

  // AI Rewrite state
  const [rewriteTarget, setRewriteTarget] = useState<string | null>(null)
  const [rewriteLoading, setRewriteLoading] = useState(false)
  const [rewriteSuggestion, setRewriteSuggestion] = useState<string | null>(null)

  useEffect(() => { loadResume() }, [])

  async function loadResume() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { navigate('/login'); return }

    const { data } = await supabase
      .from('resumes').select('*')
      .eq('user_id', user.id).eq('is_active', true)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()

    if (data) {
      const row = data as ResumeType
      setResumeRow(row)
      setDraft(row.parsed ?? storeResume?.parsed ?? null)
      setResume(row)
    } else if (storeResume) {
      setResumeRow(storeResume)
      setDraft(storeResume.parsed)
    }
    setLoading(false)
  }

  function updateDraft(updater: (prev: ResumeJSON) => ResumeJSON) {
    setDraft(prev => prev ? updater(prev) : prev)
    setIsDirty(true)
  }

  async function handleSave() {
    if (!resumeRow || !draft || saving) return
    setSaving(true)
    await supabase.from('resumes').update({ parsed: draft }).eq('id', resumeRow.id)
    setResume({ ...resumeRow, parsed: draft })
    setIsDirty(false)
    setSaving(false)
  }

  // ── Edit helpers ─────────────────────────────────────────────────────────
  function openEdit(key: string, value: string) {
    setEditingSection(key)
    setEditValue(value)
    dismissRewrite()
  }

  function commitEdit(key: string) {
    if (!draft) return
    if (key === 'summary') {
      updateDraft(prev => ({ ...prev, summary: editValue }))
    } else if (key === 'skills') {
      const skills = editValue.split(/,|\n/).map(s => s.trim()).filter(Boolean)
      updateDraft(prev => ({ ...prev, skills }))
    } else if (key === 'certifications') {
      const certifications = editValue.split('\n').map(s => s.trim()).filter(Boolean)
      updateDraft(prev => ({ ...prev, certifications }))
    } else if (key.startsWith('exp-')) {
      const idx = parseInt(key.split('-')[1])
      const bullets = editValue.split('\n').map(l => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean)
      updateDraft(prev => {
        const experience = [...prev.experience]
        experience[idx] = { ...experience[idx], bullets }
        return { ...prev, experience }
      })
    }
    setEditingSection(null)
  }

  // ── AI Rewrite ────────────────────────────────────────────────────────────
  async function handleRewrite(sectionKey: string, sectionText: string, sectionType: string) {
    setRewriteTarget(sectionKey)
    setRewriteLoading(true)
    setRewriteSuggestion(null)
    setEditingSection(null)
    try {
      const { data, error } = await supabase.functions.invoke('ai-rewrite-section', {
        body: { section_text: sectionText, section_type: sectionType },
      })
      if (error) throw error
      setRewriteSuggestion(data?.rewritten ?? null)
    } catch {
      setRewriteTarget(null)
    } finally {
      setRewriteLoading(false)
    }
  }

  function dismissRewrite() {
    setRewriteTarget(null)
    setRewriteSuggestion(null)
  }

  function acceptRewrite(key: string, text: string) {
    if (!draft) return
    if (key === 'summary') {
      updateDraft(prev => ({ ...prev, summary: text }))
    } else if (key === 'skills') {
      const skills = text.split(/,|\n/).map(s => s.trim()).filter(Boolean)
      updateDraft(prev => ({ ...prev, skills }))
    } else if (key === 'certifications') {
      const certifications = text.split('\n').map(s => s.trim()).filter(Boolean)
      updateDraft(prev => ({ ...prev, certifications }))
    } else if (key.startsWith('exp-')) {
      const idx = parseInt(key.split('-')[1])
      const bullets = text.split('\n').map(l => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean)
      updateDraft(prev => {
        const experience = [...prev.experience]
        experience[idx] = { ...experience[idx], bullets }
        return { ...prev, experience }
      })
    }
    dismissRewrite()
  }

  // ── Upload new resume ─────────────────────────────────────────────────────
  async function handleUpload() {
    if (!uploadFile || uploading) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUploading(true)
    setUploadError(null)

    try {
      const ext = uploadFile.name.split('.').pop()
      const filePath = `${user.id}/${Date.now()}_${uploadFile.name}`

      setUploadStep('Uploading file…')
      const { error: storageError } = await supabase.storage.from('resumes').upload(filePath, uploadFile)
      if (storageError) throw new Error(storageError.message)

      setUploadStep('Extracting text…')
      const rawText = await extractText(uploadFile)

      // Deactivate old resume
      if (resumeRow) {
        await supabase.from('resumes').update({ is_active: false }).eq('id', resumeRow.id)
      }

      const { data: newRow, error: insertError } = await supabase.from('resumes').insert({
        user_id: user.id,
        file_path: filePath,
        file_name: uploadFile.name,
        file_type: ext === 'pdf' ? 'pdf' : 'docx',
        raw_text: rawText,
        is_active: true,
      }).select().single()

      if (insertError || !newRow) throw new Error('Failed to save resume record')

      setUploadStep('Parsing with AI…')
      const { data: fnData } = await supabase.functions.invoke('ai-parse-resume', {
        body: { text: rawText },
      })

      if (fnData?.parsed) {
        await supabase.from('resumes').update({ parsed: fnData.parsed }).eq('id', newRow.id)
        const updated = { ...newRow, parsed: fnData.parsed } as ResumeType
        setResumeRow(updated)
        setDraft(fnData.parsed)
        setResume(updated)
      } else {
        setResumeRow(newRow as ResumeType)
        setDraft(null)
        setResume(newRow as ResumeType)
      }

      setIsDirty(false)
      setUploadFile(null)
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      setUploadStep('')
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="res-page"><div className="res-loading">Loading resume…</div></div>
  }

  return (
    <div className="res-page">
      <div className="res-page-header">
        <div>
          <h1 className="res-title">Resume</h1>
          {resumeRow?.file_name && (
            <p className="res-subtitle">{resumeRow.file_name}</p>
          )}
        </div>
        {isDirty && (
          <button className="btn btn-primary res-save-btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        )}
      </div>

      {/* Upload / Replace */}
      <div className="res-upload card">
        <div className="res-upload-meta">
          <span className="res-upload-title">
            {resumeRow ? 'Replace Resume' : 'Upload Resume'}
          </span>
          <span className="res-upload-hint">PDF or DOCX, max 10 MB</span>
        </div>
        <div className="res-upload-row">
          <input
            type="file" id="resume-replace" accept=".pdf,.doc,.docx"
            style={{ display: 'none' }}
            onChange={e => { setUploadFile(e.target.files?.[0] ?? null); setUploadError(null) }}
          />
          <label htmlFor="resume-replace" className="btn btn-ghost res-file-btn">
            {uploadFile ? uploadFile.name : 'Choose file'}
          </label>
          {uploadFile && (
            <button
              className="btn btn-primary"
              onClick={handleUpload}
              disabled={uploading}
            >
              {uploading ? (uploadStep || 'Uploading…') : 'Upload & Parse ✦'}
            </button>
          )}
        </div>
        {uploading && (
          <div className="res-upload-progress">
            <div className="rw-dots"><span /><span /><span /></div>
            <span>{uploadStep}</span>
          </div>
        )}
        {uploadError && <p className="res-upload-error">{uploadError}</p>}
      </div>

      {!draft && (
        <p className="res-empty">
          No parsed resume yet. Upload a file above, or complete{' '}
          <button className="res-text-link" onClick={() => navigate('/onboarding')}>onboarding</button>.
        </p>
      )}

      {draft && (
        <div className="res-sections">

          {/* Summary */}
          <SectionCard
            title="Summary"
            onRewrite={() => handleRewrite('summary', draft.summary, 'summary')}
            rewriteDisabled={rewriteLoading}
          >
            {editingSection === 'summary' ? (
              <div className="res-edit-block">
                <textarea
                  className="res-textarea"
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  rows={5}
                  autoFocus
                />
                <div className="res-edit-actions">
                  <button className="btn btn-primary res-done-btn" onClick={() => commitEdit('summary')}>Done</button>
                  <button className="btn btn-ghost res-done-btn" onClick={() => setEditingSection(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="res-summary-view">
                <p className="res-summary-text">{draft.summary || <em className="res-empty-field">No summary</em>}</p>
                <button className="btn btn-ghost res-edit-btn" onClick={() => openEdit('summary', draft.summary)}>Edit</button>
              </div>
            )}
            {rewriteTarget === 'summary' && (
              <RewritePanel
                loading={rewriteLoading}
                suggestion={rewriteSuggestion}
                onAccept={text => acceptRewrite('summary', text)}
                onDismiss={dismissRewrite}
              />
            )}
          </SectionCard>

          {/* Experience */}
          <SectionCard title="Experience">
            <div className="res-exp-list">
              {draft.experience.map((exp, i) => {
                const key = `exp-${i}`
                const expText = `${exp.title} at ${exp.company} (${exp.start_date} – ${exp.end_date ?? 'Present'}):\n${exp.bullets.map(b => `- ${b}`).join('\n')}`
                return (
                  <div key={i} className="res-exp-card">
                    <div className="res-exp-header">
                      <div>
                        <div className="res-exp-title">{exp.title}</div>
                        <div className="res-exp-meta">
                          {exp.company}{exp.location ? ` · ${exp.location}` : ''}
                          <span className="res-exp-dates"> · {exp.start_date} – {exp.end_date ?? 'Present'}</span>
                        </div>
                      </div>
                      <div className="res-exp-actions">
                        <button
                          className="btn btn-ghost res-rewrite-btn"
                          onClick={() => handleRewrite(key, expText, 'experience')}
                          disabled={rewriteLoading}
                        >AI Rewrite ✦</button>
                        {editingSection !== key && (
                          <button
                            className="btn btn-ghost res-edit-btn"
                            onClick={() => openEdit(key, exp.bullets.map(b => `- ${b}`).join('\n'))}
                          >Edit bullets</button>
                        )}
                      </div>
                    </div>
                    {editingSection === key ? (
                      <div className="res-edit-block">
                        <textarea
                          className="res-textarea"
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          rows={Math.max(4, exp.bullets.length + 2)}
                          autoFocus
                          placeholder="One bullet per line (- or plain text)"
                        />
                        <div className="res-edit-actions">
                          <button className="btn btn-primary res-done-btn" onClick={() => commitEdit(key)}>Done</button>
                          <button className="btn btn-ghost res-done-btn" onClick={() => setEditingSection(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <ul className="res-bullets">
                        {exp.bullets.map((b, j) => <li key={j}>{b}</li>)}
                      </ul>
                    )}
                    {rewriteTarget === key && (
                      <RewritePanel
                        loading={rewriteLoading}
                        suggestion={rewriteSuggestion}
                        onAccept={text => acceptRewrite(key, text)}
                        onDismiss={dismissRewrite}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </SectionCard>

          {/* Skills */}
          <SectionCard
            title="Skills"
            onRewrite={() => handleRewrite('skills', draft.skills.join(', '), 'skills')}
            rewriteDisabled={rewriteLoading}
          >
            {editingSection === 'skills' ? (
              <div className="res-edit-block">
                <p className="res-edit-hint">Comma or newline separated</p>
                <textarea
                  className="res-textarea"
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  rows={4}
                  autoFocus
                />
                <div className="res-edit-actions">
                  <button className="btn btn-primary res-done-btn" onClick={() => commitEdit('skills')}>Done</button>
                  <button className="btn btn-ghost res-done-btn" onClick={() => setEditingSection(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div>
                <div className="res-skills-cloud">
                  {draft.skills.map((s, i) => <span key={i} className="res-skill-tag">{s}</span>)}
                  {draft.skills.length === 0 && <em className="res-empty-field">No skills listed</em>}
                </div>
                <button
                  className="btn btn-ghost res-edit-btn"
                  style={{ marginTop: 10 }}
                  onClick={() => openEdit('skills', draft.skills.join(', '))}
                >Edit</button>
              </div>
            )}
            {rewriteTarget === 'skills' && (
              <RewritePanel
                loading={rewriteLoading}
                suggestion={rewriteSuggestion}
                onAccept={text => acceptRewrite('skills', text)}
                onDismiss={dismissRewrite}
              />
            )}
          </SectionCard>

          {/* Education */}
          {draft.education.length > 0 && (
            <SectionCard title="Education">
              <div className="res-edu-list">
                {draft.education.map((edu, i) => (
                  <div key={i} className="res-edu-item">
                    <div className="res-edu-degree">{edu.degree}{edu.field ? ` in ${edu.field}` : ''}</div>
                    <div className="res-edu-meta">{edu.institution} · {edu.graduation_year}</div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* Certifications */}
          {(draft.certifications.length > 0 || editingSection === 'certifications') && (
            <SectionCard
              title="Certifications"
              onRewrite={draft.certifications.length > 0
                ? () => handleRewrite('certifications', draft.certifications.join('\n'), 'certifications')
                : undefined}
              rewriteDisabled={rewriteLoading}
            >
              {editingSection === 'certifications' ? (
                <div className="res-edit-block">
                  <p className="res-edit-hint">One per line</p>
                  <textarea
                    className="res-textarea"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    rows={4}
                    autoFocus
                  />
                  <div className="res-edit-actions">
                    <button className="btn btn-primary res-done-btn" onClick={() => commitEdit('certifications')}>Done</button>
                    <button className="btn btn-ghost res-done-btn" onClick={() => setEditingSection(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div>
                  <ul className="res-cert-list">
                    {draft.certifications.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                  <button
                    className="btn btn-ghost res-edit-btn"
                    style={{ marginTop: 8 }}
                    onClick={() => openEdit('certifications', draft.certifications.join('\n'))}
                  >Edit</button>
                </div>
              )}
              {rewriteTarget === 'certifications' && (
                <RewritePanel
                  loading={rewriteLoading}
                  suggestion={rewriteSuggestion}
                  onAccept={text => acceptRewrite('certifications', text)}
                  onDismiss={dismissRewrite}
                />
              )}
            </SectionCard>
          )}

        </div>
      )}

      <style>{`
        .res-page { padding: 32px; max-width: 820px; }
        .res-loading { color: rgba(242,240,234,0.4); font-size: 13px; margin-top: 32px; }
        .res-page-header {
          display: flex; justify-content: space-between; align-items: flex-start;
          margin-bottom: 28px;
        }
        .res-title { font-size: 30px; line-height: 1.2; margin-bottom: 4px; }
        .res-subtitle { font-size: 13px; color: rgba(242,240,234,0.4); }
        .res-save-btn { padding: 8px 20px; }

        /* Upload */
        .res-upload { padding: 16px 20px; margin-bottom: 28px; }
        .res-upload-meta { margin-bottom: 10px; }
        .res-upload-title { font-size: 13px; font-weight: 600; display: block; margin-bottom: 2px; }
        .res-upload-hint { font-size: 12px; color: rgba(242,240,234,0.4); }
        .res-upload-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .res-file-btn { font-size: 12px; padding: 7px 14px; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .res-upload-progress { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 12px; color: rgba(242,240,234,0.5); }
        .res-upload-error { color: #f87171; font-size: 13px; margin-top: 8px; }
        .res-empty { color: rgba(242,240,234,0.4); font-size: 13px; margin-top: 8px; }
        .res-text-link { background: none; border: none; color: var(--color-accent); cursor: pointer; font-size: 13px; padding: 0; text-decoration: underline; }

        /* Sections */
        .res-sections { display: flex; flex-direction: column; gap: 16px; }
        .res-section { padding: 20px 24px; }
        .res-section-header {
          display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;
        }
        .res-section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: rgba(242,240,234,0.55); }
        .res-rewrite-btn { font-size: 11px; padding: 4px 10px; }
        .res-edit-btn { font-size: 11px; padding: 4px 10px; }

        /* Summary */
        .res-summary-view { display: flex; flex-direction: column; gap: 10px; }
        .res-summary-text { font-size: 13px; line-height: 1.7; color: rgba(242,240,234,0.8); }

        /* Experience */
        .res-exp-list { display: flex; flex-direction: column; gap: 20px; }
        .res-exp-card { padding-bottom: 20px; border-bottom: 1px solid var(--color-border); }
        .res-exp-card:last-child { border-bottom: none; padding-bottom: 0; }
        .res-exp-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
        .res-exp-actions { display: flex; gap: 6px; flex-shrink: 0; }
        .res-exp-title { font-size: 14px; font-weight: 600; margin-bottom: 3px; }
        .res-exp-meta { font-size: 12px; color: rgba(242,240,234,0.5); }
        .res-exp-dates { }
        .res-bullets { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 5px; }
        .res-bullets li { font-size: 13px; line-height: 1.6; color: rgba(242,240,234,0.75); }

        /* Skills */
        .res-skills-cloud { display: flex; flex-wrap: wrap; gap: 7px; }
        .res-skill-tag {
          background: rgba(255,255,255,0.05); border: 1px solid var(--color-border);
          border-radius: 20px; padding: 3px 10px; font-size: 12px; color: rgba(242,240,234,0.7);
        }

        /* Education */
        .res-edu-list { display: flex; flex-direction: column; gap: 12px; }
        .res-edu-item { }
        .res-edu-degree { font-size: 13px; font-weight: 600; margin-bottom: 2px; }
        .res-edu-meta { font-size: 12px; color: rgba(242,240,234,0.5); }

        /* Certifications */
        .res-cert-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 5px; }
        .res-cert-list li { font-size: 13px; color: rgba(242,240,234,0.75); }

        /* Edit block */
        .res-edit-block { display: flex; flex-direction: column; gap: 8px; }
        .res-edit-hint { font-size: 11px; color: rgba(242,240,234,0.4); margin: 0; }
        .res-textarea {
          width: 100%; background: rgba(255,255,255,0.04); border: 1px solid var(--color-border);
          border-radius: var(--radius-btn); padding: 10px 12px; font-family: inherit;
          font-size: 13px; line-height: 1.7; color: rgba(242,240,234,0.85);
          resize: vertical; box-sizing: border-box;
        }
        .res-textarea:focus { outline: none; border-color: var(--color-accent); }
        .res-edit-actions { display: flex; gap: 8px; }
        .res-done-btn { font-size: 12px; padding: 5px 14px; }
        .res-empty-field { font-style: italic; color: rgba(242,240,234,0.3); font-size: 13px; }

        /* Rewrite panel */
        .rw-panel {
          margin-top: 12px; background: rgba(255,255,255,0.04); border: 1px solid var(--color-border);
          border-radius: var(--radius-card); padding: 12px 16px;
        }
        .rw-panel.rw-loading {
          display: flex; align-items: center; gap: 8px;
          font-size: 12px; color: rgba(242,240,234,0.4);
        }
        .rw-panel-header {
          display: flex; align-items: center; gap: 6px; margin-bottom: 10px;
          font-size: 12px; font-weight: 600; text-transform: uppercase;
          letter-spacing: 0.5px; color: rgba(242,240,234,0.5);
        }
        .rw-actions { display: flex; gap: 6px; margin-left: auto; }
        .rw-btn { font-size: 11px; padding: 4px 12px; }
        .rw-textarea {
          width: 100%; background: rgba(255,255,255,0.03); border: 1px solid var(--color-border);
          border-radius: var(--radius-btn); padding: 10px 12px; font-family: inherit;
          font-size: 13px; line-height: 1.7; color: rgba(242,240,234,0.85);
          resize: vertical; box-sizing: border-box;
        }
        .rw-textarea:focus { outline: none; border-color: var(--color-accent); }

        /* Bouncing dots */
        .rw-dots { display: flex; gap: 4px; }
        .rw-dots span {
          width: 5px; height: 5px; border-radius: 50%; background: var(--color-accent);
          animation: rw-bounce 1s ease-in-out infinite;
        }
        .rw-dots span:nth-child(2) { animation-delay: 0.15s; }
        .rw-dots span:nth-child(3) { animation-delay: 0.3s; }
        @keyframes rw-bounce {
          0%,100% { transform: translateY(0); opacity: 0.4; }
          50% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

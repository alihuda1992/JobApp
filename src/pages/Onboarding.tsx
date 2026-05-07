import { useState, type FormEvent, type KeyboardEvent, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAppStore } from '@/store/useAppStore'
import * as pdfjsLib from 'pdfjs-dist'
import mammoth from 'mammoth'

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

const LOCATION_CHIPS = ['Remote', 'New York', 'San Francisco', 'London', 'Austin']
const SENIORITY_OPTIONS = ['junior', 'mid', 'senior', 'lead', 'director']
const COMPANY_SIZE_OPTIONS = ['startup', 'mid-size', 'enterprise']

export function Onboarding() {
  const navigate = useNavigate()
  const { setResume } = useAppStore()
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 1
  const [fullName, setFullName] = useState('')
  const [currentTitle, setCurrentTitle] = useState('')
  const [targetTitles, setTargetTitles] = useState<string[]>([])
  const [titleInput, setTitleInput] = useState('')
  const [preferredLocations, setPreferredLocations] = useState<string[]>([])
  const [customLocation, setCustomLocation] = useState('')

  // Step 2
  const [minSalary, setMinSalary] = useState('')
  const [seniority, setSeniority] = useState('')
  const [companySizes, setCompanySizes] = useState<string[]>([])

  // Step 3
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadStep, setUploadStep] = useState('')

  async function getUserId() {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.user?.id
  }

  function addTargetTitle() {
    const val = titleInput.trim()
    if (val && !targetTitles.includes(val)) {
      setTargetTitles([...targetTitles, val])
    }
    setTitleInput('')
  }

  function handleTitleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTargetTitle()
    }
  }

  function toggleLocation(loc: string) {
    setPreferredLocations((prev) =>
      prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]
    )
  }

  function addCustomLocation() {
    const val = customLocation.trim()
    if (val && !preferredLocations.includes(val)) {
      setPreferredLocations([...preferredLocations, val])
    }
    setCustomLocation('')
  }

  function toggleCompanySize(size: string) {
    setCompanySizes((prev) =>
      prev.includes(size) ? prev.filter((s) => s !== size) : [...prev, size]
    )
  }

  async function saveStep1() {
    const userId = await getUserId()
    if (!userId) return
    await supabase.from('profiles').upsert({
      id: userId,
      full_name: fullName || null,
      current_title: currentTitle || null,
      target_titles: targetTitles,
      preferred_locations: preferredLocations,
    })
  }

  async function saveStep2() {
    const userId = await getUserId()
    if (!userId) return
    await supabase.from('profiles').upsert({
      id: userId,
      min_salary_usd: minSalary ? parseInt(minSalary) : null,
      seniority: seniority || null,
      company_size_prefs: companySizes,
    })
  }

  async function handleStep1Submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    await saveStep1()
    setSaving(false)
    setStep(2)
  }

  async function handleStep2Submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    await saveStep2()
    setSaving(false)
    setStep(3)
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0]
    if (!selected) return
    if (!['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(selected.type)) {
      setError('Only PDF and DOCX files are supported.')
      return
    }
    if (selected.size > 10 * 1024 * 1024) {
      setError('File must be under 10MB.')
      return
    }
    setError(null)
    setFile(selected)
  }

  async function handleStep3Submit(skip = false) {
    setError(null)
    setUploading(true)

    const userId = await getUserId()
    if (!userId) {
      setUploading(false)
      return
    }

    if (!skip && file) {
      const ext = file.name.split('.').pop()
      const filePath = `${userId}/${Date.now()}_${file.name}`

      setUploadStep('Uploading file…')
      const { error: uploadError } = await supabase.storage
        .from('resumes')
        .upload(filePath, file)

      if (uploadError) {
        setError(`Upload failed: ${uploadError.message}`)
        setUploading(false)
        return
      }

      setUploadStep('Extracting text…')
      let rawText = ''
      try {
        rawText = await extractText(file)
      } catch {
        // Text extraction failed — continue without it
      }

      const { data: resumeRow } = await supabase.from('resumes').insert({
        user_id: userId,
        file_path: filePath,
        file_name: file.name,
        file_type: ext === 'pdf' ? 'pdf' : 'docx',
        raw_text: rawText || null,
        is_active: true,
      }).select().single()

      if (resumeRow) setResume(resumeRow)

      if (rawText && resumeRow) {
        setUploadStep('✦ Analyzing resume…')
        try {
          const { data, error: fnError } = await supabase.functions.invoke('ai-parse-resume', {
            body: { raw_text: rawText },
          })
          if (fnError) {
            console.error('ai-parse-resume error:', fnError)
            setError(`AI analysis failed: ${fnError.message}`)
          } else if (data?.error) {
            console.error('ai-parse-resume detail:', data)
            setError(`AI analysis failed: ${data.detail ?? data.error}`)
          } else if (data?.parsed) {
            await supabase.from('resumes').update({ parsed: data.parsed }).eq('id', resumeRow.id)
            setResume({ ...resumeRow, parsed: data.parsed })
          }
        } catch (e) {
          console.error('ai-parse-resume exception:', e)
          setError(`AI analysis failed: ${String(e)}`)
        }
      }
    }

    await supabase.from('profiles').upsert({
      id: userId,
      onboarding_complete: true,
    })

    setUploading(false)
    navigate('/', { replace: true })
  }

  return (
    <div className="onboarding-page">
      <div className="onboarding-container">
        <div className="onboarding-header">
          <span className="onboarding-logo">The Job App</span>
          <div className="step-indicator">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`step-dot${s === step ? ' step-dot--active' : s < step ? ' step-dot--done' : ''}`}
              />
            ))}
          </div>
        </div>

        {step === 1 && (
          <form onSubmit={handleStep1Submit} className="onboarding-form card">
            <h2 className="onboarding-step-title">Tell us about yourself</h2>
            <p className="onboarding-step-sub">Step 1 of 3</p>

            <div className="form-field">
              <label className="form-label">Full name</label>
              <input
                className="input-base"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Smith"
                autoFocus
              />
            </div>

            <div className="form-field">
              <label className="form-label">Current job title</label>
              <input
                className="input-base"
                value={currentTitle}
                onChange={(e) => setCurrentTitle(e.target.value)}
                placeholder="Senior Product Manager"
              />
            </div>

            <div className="form-field">
              <label className="form-label">Target job titles</label>
              <div className="tag-input-row">
                <input
                  className="input-base"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  placeholder="Type a title and press Enter"
                />
                <button type="button" className="btn btn-ghost" onClick={addTargetTitle}>Add</button>
              </div>
              {targetTitles.length > 0 && (
                <div className="tag-list">
                  {targetTitles.map((t) => (
                    <span key={t} className="tag">
                      {t}
                      <button type="button" className="tag-remove" onClick={() => setTargetTitles(targetTitles.filter((x) => x !== t))}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="form-field">
              <label className="form-label">Preferred locations</label>
              <div className="chip-group">
                {LOCATION_CHIPS.map((loc) => (
                  <button
                    type="button"
                    key={loc}
                    className={`chip${preferredLocations.includes(loc) ? ' chip--active' : ''}`}
                    onClick={() => toggleLocation(loc)}
                  >
                    {loc}
                  </button>
                ))}
              </div>
              <div className="tag-input-row" style={{ marginTop: 8 }}>
                <input
                  className="input-base"
                  value={customLocation}
                  onChange={(e) => setCustomLocation(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomLocation() } }}
                  placeholder="Other city…"
                />
                <button type="button" className="btn btn-ghost" onClick={addCustomLocation}>Add</button>
              </div>
              {preferredLocations.filter((l) => !LOCATION_CHIPS.includes(l)).length > 0 && (
                <div className="tag-list">
                  {preferredLocations.filter((l) => !LOCATION_CHIPS.includes(l)).map((l) => (
                    <span key={l} className="tag">
                      {l}
                      <button type="button" className="tag-remove" onClick={() => setPreferredLocations(preferredLocations.filter((x) => x !== l))}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {error && <div className="auth-error">{error}</div>}

            <button type="submit" className="btn btn-primary onboarding-next" disabled={saving}>
              {saving ? 'Saving…' : 'Continue →'}
            </button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={handleStep2Submit} className="onboarding-form card">
            <h2 className="onboarding-step-title">Your preferences</h2>
            <p className="onboarding-step-sub">Step 2 of 3</p>

            <div className="form-field">
              <label className="form-label">Minimum salary (USD/year)</label>
              <input
                className="input-base"
                type="number"
                value={minSalary}
                onChange={(e) => setMinSalary(e.target.value)}
                placeholder="80000"
                min={0}
              />
            </div>

            <div className="form-field">
              <label className="form-label">Seniority level</label>
              <select
                className="input-base"
                value={seniority}
                onChange={(e) => setSeniority(e.target.value)}
              >
                <option value="">Select level…</option>
                {SENIORITY_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label className="form-label">Company size</label>
              <div className="chip-group">
                {COMPANY_SIZE_OPTIONS.map((size) => (
                  <button
                    type="button"
                    key={size}
                    className={`chip${companySizes.includes(size) ? ' chip--active' : ''}`}
                    onClick={() => toggleCompanySize(size)}
                  >
                    {size.charAt(0).toUpperCase() + size.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {error && <div className="auth-error">{error}</div>}

            <div className="onboarding-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>← Back</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Continue →'}
              </button>
            </div>
          </form>
        )}

        {step === 3 && (
          <div className="onboarding-form card">
            <h2 className="onboarding-step-title">Upload your resume</h2>
            <p className="onboarding-step-sub">Step 3 of 3</p>

            <div className="form-field">
              <label className="form-label">Resume file</label>
              <div className="file-drop">
                <input
                  type="file"
                  id="resume-file"
                  accept=".pdf,.docx"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
                <label htmlFor="resume-file" className="file-drop-label">
                  {file ? (
                    <div className="file-selected">
                      <span className="file-name">{file.name}</span>
                      <span className="file-size">{(file.size / 1024).toFixed(0)} KB</span>
                    </div>
                  ) : (
                    <div className="file-placeholder">
                      <span>Drop a PDF or DOCX here, or click to browse</span>
                      <span className="file-note">Max 10MB</span>
                    </div>
                  )}
                </label>
              </div>
            </div>

            {error && <div className="auth-error">{error}</div>}

            <div className="onboarding-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setStep(2)}>← Back</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={uploading || !file}
                onClick={() => handleStep3Submit(false)}
              >
                {uploading ? (uploadStep || 'Uploading…') : 'Finish setup'}
              </button>
            </div>

            <button
              type="button"
              className="onboarding-skip"
              onClick={() => handleStep3Submit(true)}
              disabled={uploading}
            >
              Skip for now →
            </button>
          </div>
        )}
      </div>

      <style>{`
        .onboarding-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: var(--color-bg);
        }

        .onboarding-container {
          width: 100%;
          max-width: 480px;
        }

        .onboarding-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 24px;
        }

        .onboarding-logo {
          font-family: "Instrument Serif", serif;
          font-size: 20px;
        }

        .step-indicator {
          display: flex;
          gap: 6px;
        }

        .step-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(242, 240, 234, 0.2);
          transition: background 0.2s ease;
        }

        .step-dot--active {
          background: var(--color-accent);
        }

        .step-dot--done {
          background: rgba(242, 240, 234, 0.5);
        }

        .onboarding-form {
          padding: 32px;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .onboarding-step-title {
          font-size: 22px;
          margin-bottom: 2px;
        }

        .onboarding-step-sub {
          font-size: 12px;
          color: rgba(242, 240, 234, 0.4);
          margin-bottom: 4px;
        }

        .form-field {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .form-label {
          font-size: 11px;
          font-weight: 500;
          color: rgba(242, 240, 234, 0.55);
          text-transform: uppercase;
          letter-spacing: 0.6px;
        }

        .tag-input-row {
          display: flex;
          gap: 8px;
        }

        .tag-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .tag {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid var(--color-border);
          border-radius: 20px;
          padding: 3px 10px 3px 10px;
          font-size: 12px;
          color: var(--color-text);
        }

        .tag-remove {
          background: none;
          border: none;
          color: rgba(242, 240, 234, 0.4);
          font-size: 14px;
          line-height: 1;
          cursor: pointer;
          padding: 0;
        }

        .tag-remove:hover {
          color: var(--color-text);
        }

        .chip-group {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .chip {
          background: transparent;
          border: 1px solid var(--color-border);
          border-radius: 20px;
          padding: 4px 12px;
          font-size: 12px;
          color: rgba(242, 240, 234, 0.6);
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .chip:hover {
          border-color: var(--color-border-hover);
          color: var(--color-text);
        }

        .chip--active {
          background: var(--color-accent);
          border-color: var(--color-accent);
          color: #fff;
        }

        .auth-error {
          background: rgba(220, 50, 50, 0.12);
          border: 1px solid rgba(220, 50, 50, 0.3);
          border-radius: var(--radius-btn);
          color: #f87171;
          font-size: 12px;
          padding: 8px 12px;
        }

        .onboarding-next {
          width: 100%;
          padding: 10px;
        }

        .onboarding-actions {
          display: flex;
          gap: 10px;
          justify-content: flex-end;
        }

        .onboarding-skip {
          background: none;
          border: none;
          color: rgba(242, 240, 234, 0.4);
          font-size: 12px;
          cursor: pointer;
          text-align: center;
          padding: 4px;
          transition: color 0.15s ease;
        }

        .onboarding-skip:hover {
          color: rgba(242, 240, 234, 0.7);
        }

        .file-drop {
          border: 1px dashed var(--color-border);
          border-radius: var(--radius-card);
          transition: border-color 0.15s ease;
        }

        .file-drop:hover {
          border-color: var(--color-border-hover);
        }

        .file-drop-label {
          display: block;
          padding: 28px 20px;
          cursor: pointer;
          text-align: center;
        }

        .file-placeholder {
          display: flex;
          flex-direction: column;
          gap: 4px;
          color: rgba(242, 240, 234, 0.45);
          font-size: 13px;
        }

        .file-note {
          font-size: 11px;
          opacity: 0.6;
        }

        .file-selected {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .file-name {
          font-size: 13px;
          color: var(--color-text);
          font-weight: 500;
        }

        .file-size {
          font-size: 11px;
          color: rgba(242, 240, 234, 0.45);
        }
      `}</style>
    </div>
  )
}

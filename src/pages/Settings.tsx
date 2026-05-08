import { useState, useEffect, type KeyboardEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useAppStore } from '@/store/useAppStore'

const LOCATION_CHIPS = ['Remote', 'New York', 'San Francisco', 'London', 'Austin']
const SENIORITY_OPTIONS = ['junior', 'mid', 'senior', 'lead', 'director'] as const
const COMPANY_SIZE_OPTIONS = ['startup', 'mid-size', 'enterprise']

export function Settings() {
  const { profile, setProfile } = useAppStore()

  // Profile form state
  const [fullName, setFullName] = useState('')
  const [currentTitle, setCurrentTitle] = useState('')
  const [targetTitles, setTargetTitles] = useState<string[]>([])
  const [titleInput, setTitleInput] = useState('')
  const [preferredLocations, setPreferredLocations] = useState<string[]>([])
  const [customLocation, setCustomLocation] = useState('')
  const [minSalary, setMinSalary] = useState('')
  const [seniority, setSeniority] = useState('')
  const [companySizes, setCompanySizes] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // Notion state
  const [notionToken, setNotionToken] = useState('')
  const [parentPageUrl, setParentPageUrl] = useState('')
  const [notionLoading, setNotionLoading] = useState(false)
  const [notionError, setNotionError] = useState('')
  const [notionMsg, setNotionMsg] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  const notionConnected = !!(profile?.notion_token && profile?.notion_db_id)
  const { applications } = useAppStore()

  useEffect(() => {
    if (!profile) return
    setFullName(profile.full_name ?? '')
    setCurrentTitle(profile.current_title ?? '')
    setTargetTitles(profile.target_titles ?? [])
    setPreferredLocations(profile.preferred_locations ?? [])
    setMinSalary(profile.min_salary_usd != null ? String(profile.min_salary_usd) : '')
    setSeniority(profile.seniority ?? '')
    setCompanySizes(profile.company_size_prefs ?? [])
  }, [profile])

  function addTargetTitle() {
    const val = titleInput.trim()
    if (val && !targetTitles.includes(val)) setTargetTitles([...targetTitles, val])
    setTitleInput('')
  }

  function handleTitleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); addTargetTitle() }
  }

  function toggleLocation(loc: string) {
    setPreferredLocations((prev) =>
      prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]
    )
  }

  function addCustomLocation() {
    const val = customLocation.trim()
    if (val && !preferredLocations.includes(val)) setPreferredLocations([...preferredLocations, val])
    setCustomLocation('')
  }

  function toggleCompanySize(size: string) {
    setCompanySizes((prev) =>
      prev.includes(size) ? prev.filter((s) => s !== size) : [...prev, size]
    )
  }

  async function handleSaveProfile() {
    if (!profile) return
    setSaving(true)
    setSaveMsg('')
    const { data, error } = await supabase.from('profiles').upsert({
      id: profile.id,
      full_name: fullName || null,
      current_title: currentTitle || null,
      target_titles: targetTitles,
      preferred_locations: preferredLocations,
      min_salary_usd: minSalary ? parseInt(minSalary) : null,
      seniority: seniority || null,
      company_size_prefs: companySizes,
    }).select().single()
    setSaving(false)
    if (error) {
      setSaveMsg('Failed to save.')
    } else if (data) {
      setProfile(data)
      setSaveMsg('Saved!')
      setTimeout(() => setSaveMsg(''), 2500)
    }
  }

  async function handleConnectNotion() {
    if (!profile || !notionToken.trim() || !parentPageUrl.trim()) return
    setNotionLoading(true)
    setNotionError('')
    setNotionMsg('')

    try {
      const { data, error } = await supabase.functions.invoke('notion-sync', {
        body: { action: 'setup', notion_token: notionToken.trim(), parent_page_id: parentPageUrl.trim() },
      })
      if (error) throw new Error(error.message)
      if (data?.error) throw new Error(data.error)

      const dbId = data?.db_id
      if (!dbId) throw new Error('No database ID returned')

      const { data: updated, error: upErr } = await supabase.from('profiles').upsert({
        id: profile.id,
        notion_token: notionToken.trim(),
        notion_db_id: dbId,
      }).select().single()
      if (upErr) throw new Error(upErr.message)
      if (updated) setProfile(updated)
      setNotionToken('')
      setParentPageUrl('')
      setNotionMsg('Notion database created and connected!')
    } catch (e) {
      setNotionError(String(e))
    } finally {
      setNotionLoading(false)
    }
  }

  async function handleSyncAll() {
    if (!profile?.notion_token || !profile?.notion_db_id || syncing) return
    setSyncing(true)
    setSyncMsg('')
    try {
      const { data, error } = await supabase.functions.invoke('notion-sync', {
        body: {
          action: 'sync_all',
          notion_token: profile.notion_token,
          notion_db_id: profile.notion_db_id,
          applications,
        },
      })
      if (error) throw new Error(error.message)
      if (data?.error) throw new Error(data.error)
      setSyncMsg(`Synced ${data?.synced ?? 0} cards to Notion`)
    } catch (e) {
      setSyncMsg(`Sync failed: ${String(e)}`)
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncMsg(''), 4000)
    }
  }

  async function handleDisconnect() {
    if (!profile) return
    const { data, error } = await supabase.from('profiles').upsert({
      id: profile.id,
      notion_token: null,
      notion_db_id: null,
    }).select().single()
    if (!error && data) setProfile(data)
  }

  return (
    <div className="settings-page">
      <h1 className="settings-title">Settings</h1>

      {/* Profile section */}
      <section className="settings-section card">
        <h2 className="settings-section-title">Profile</h2>

        <div className="form-field">
          <label className="form-label">Full name</label>
          <input className="input-base" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Smith" />
        </div>

        <div className="form-field">
          <label className="form-label">Current job title</label>
          <input className="input-base" value={currentTitle} onChange={(e) => setCurrentTitle(e.target.value)} placeholder="Senior Product Manager" />
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

        <div className="settings-row-2">
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
            <select className="input-base" value={seniority} onChange={(e) => setSeniority(e.target.value)}>
              <option value="">Select level…</option>
              {SENIORITY_OPTIONS.map((s) => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>
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

        <div className="settings-save-row">
          {saveMsg && <span className={`settings-save-msg${saveMsg === 'Saved!' ? ' settings-save-msg--ok' : ' settings-save-msg--err'}`}>{saveMsg}</span>}
          <button className="btn btn-primary" onClick={handleSaveProfile} disabled={saving}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </section>

      {/* Notion integration section */}
      <section className="settings-section card">
        <div className="settings-notion-header">
          <div>
            <h2 className="settings-section-title">Notion integration</h2>
            <p className="settings-section-sub">Sync your pipeline to a Notion database. Changes sync automatically when you move cards.</p>
          </div>
          {notionConnected && (
            <span className="notion-badge">Connected</span>
          )}
        </div>

        {notionConnected ? (
          <div className="notion-connected">
            <div className="form-field">
              <label className="form-label">Database ID</label>
              <div className="notion-db-id">{profile?.notion_db_id}</div>
            </div>
            <div className="notion-actions">
              {syncMsg && <span className="settings-save-msg">{syncMsg}</span>}
              <button className="btn btn-ghost" onClick={handleSyncAll} disabled={syncing}>
                {syncing ? 'Syncing…' : 'Sync all cards'}
              </button>
              <button className="btn btn-ghost notion-disconnect-btn" onClick={handleDisconnect}>
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="notion-setup">
            <div className="form-field">
              <label className="form-label">Notion integration token</label>
              <input
                className="input-base input-mono"
                type="password"
                value={notionToken}
                onChange={(e) => setNotionToken(e.target.value)}
                placeholder="secret_…"
                autoComplete="off"
              />
              <span className="form-hint">
                Create an internal integration at notion.so/my-integrations and copy the secret.
              </span>
            </div>

            <div className="form-field">
              <label className="form-label">Parent page URL or ID</label>
              <input
                className="input-base"
                value={parentPageUrl}
                onChange={(e) => setParentPageUrl(e.target.value)}
                placeholder="https://notion.so/your-page-…"
              />
              <span className="form-hint">
                The page where the pipeline database will be created. Make sure your integration is connected to this page.
              </span>
            </div>

            {notionError && <div className="settings-error">{notionError}</div>}
            {notionMsg && <div className="settings-success">{notionMsg}</div>}

            <button
              className="btn btn-primary"
              onClick={handleConnectNotion}
              disabled={notionLoading || !notionToken.trim() || !parentPageUrl.trim()}
            >
              {notionLoading ? 'Creating database…' : 'Create Notion database ✦'}
            </button>
          </div>
        )}
      </section>

      <style>{`
        .settings-page {
          padding: 32px;
          box-sizing: border-box;
          max-width: 680px;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .settings-title {
          font-size: 26px;
          font-family: "Instrument Serif", serif;
          font-weight: 400;
          margin: 0;
        }

        .settings-section {
          padding: 28px;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .settings-section-title {
          font-size: 15px;
          font-weight: 600;
          margin: 0 0 2px;
        }

        .settings-section-sub {
          font-size: 12px;
          color: rgba(242,240,234,0.45);
          margin: 0;
        }

        .form-field {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .form-label {
          font-size: 11px;
          font-weight: 500;
          color: rgba(242,240,234,0.55);
          text-transform: uppercase;
          letter-spacing: 0.6px;
        }

        .form-hint {
          font-size: 11px;
          color: rgba(242,240,234,0.35);
          line-height: 1.5;
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
          background: rgba(255,255,255,0.08);
          border: 1px solid var(--color-border);
          border-radius: 20px;
          padding: 3px 10px;
          font-size: 12px;
          color: var(--color-text);
        }

        .tag-remove {
          background: none;
          border: none;
          color: rgba(242,240,234,0.4);
          font-size: 14px;
          line-height: 1;
          cursor: pointer;
          padding: 0;
        }

        .tag-remove:hover { color: var(--color-text); }

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
          color: rgba(242,240,234,0.6);
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

        .settings-row-2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .settings-save-row {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 12px;
        }

        .settings-save-msg {
          font-size: 12px;
          color: rgba(242,240,234,0.5);
        }

        .settings-save-msg--ok { color: #4ade80; }
        .settings-save-msg--err { color: #f87171; }

        .settings-error {
          background: rgba(220,50,50,0.12);
          border: 1px solid rgba(220,50,50,0.3);
          border-radius: var(--radius-btn);
          color: #f87171;
          font-size: 12px;
          padding: 8px 12px;
        }

        .settings-success {
          background: rgba(74,222,128,0.1);
          border: 1px solid rgba(74,222,128,0.3);
          border-radius: var(--radius-btn);
          color: #4ade80;
          font-size: 12px;
          padding: 8px 12px;
        }

        .settings-notion-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        .notion-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          background: rgba(74,222,128,0.12);
          border: 1px solid rgba(74,222,128,0.3);
          border-radius: 20px;
          padding: 3px 10px;
          font-size: 11px;
          color: #4ade80;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .notion-badge::before {
          content: '';
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #4ade80;
        }

        .notion-connected {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .notion-db-id {
          font-family: var(--font-mono, 'DM Mono', monospace);
          font-size: 11px;
          color: rgba(242,240,234,0.4);
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-btn);
          padding: 8px 12px;
          word-break: break-all;
        }

        .notion-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .notion-disconnect-btn {
          color: rgba(248,113,113,0.7) !important;
          border-color: rgba(248,113,113,0.25) !important;
        }

        .notion-disconnect-btn:hover {
          color: #f87171 !important;
          border-color: rgba(248,113,113,0.5) !important;
        }

        .notion-setup {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .input-mono {
          font-family: var(--font-mono, 'DM Mono', monospace);
          font-size: 12px;
        }

        @media (max-width: 600px) {
          .settings-page { padding: 20px 16px; }
          .settings-row-2 { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  )
}

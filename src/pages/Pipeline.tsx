import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAppStore } from '@/store/useAppStore'
import type { Application } from '@/types'

async function notionUpsert(app: Application, notionToken: string, notionDbId: string) {
  try {
    await supabase.functions.invoke('notion-sync', {
      body: { action: 'upsert', notion_token: notionToken, notion_db_id: notionDbId, application: app },
    })
  } catch {
    // silent — Notion sync failure should never block the UI
  }
}

type KanbanStatus = 'saved' | 'applied' | 'interviewing' | 'offer' | 'rejected'

const COLUMNS: { key: KanbanStatus; label: string; accent: string }[] = [
  { key: 'saved',        label: 'Saved',        accent: 'rgba(242,240,234,0.35)' },
  { key: 'applied',      label: 'Applied',      accent: 'var(--color-accent)' },
  { key: 'interviewing', label: 'Interviewing', accent: 'var(--color-secondary)' },
  { key: 'offer',        label: 'Offer',        accent: 'var(--color-match-green)' },
  { key: 'rejected',     label: 'Rejected',     accent: 'oklch(65% 0.18 25)' },
]

const KANBAN_KEYS = COLUMNS.map((c) => c.key) as string[]

function scoreColor(score: number | null): string {
  if (score === null) return 'var(--color-match-gray)'
  if (score >= 90) return 'var(--color-match-green)'
  if (score >= 70) return 'var(--color-match-amber)'
  return 'var(--color-match-gray)'
}

function relativeDate(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return '1d ago'
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

function AppCard({
  app,
  dragging,
  onDragStart,
  onDragEnd,
  onDelete,
}: {
  app: Application
  dragging: boolean
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDelete: (id: string) => void
}) {
  const navigate = useNavigate()
  const job = app.job
  const score = job?.match_score ?? null
  const dateLabel = app.applied_at
    ? relativeDate(app.applied_at)
    : relativeDate(app.created_at)

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    onDelete(app.id)
  }

  return (
    <div
      className="app-card card"
      draggable
      data-card-id={app.id}
      onDragStart={() => onDragStart(app.id)}
      onDragEnd={onDragEnd}
      onClick={() => job && navigate(`/jobs/${job.id}`)}
      style={{ opacity: dragging ? 0.35 : 1, cursor: 'grab' }}
    >
      <div className="app-card-header">
        <span className="app-card-title">{job?.title ?? 'Unknown role'}</span>
        <button className="app-card-del" onClick={handleDelete} title="Remove">×</button>
      </div>
      {(job?.company || job?.location) && (
        <span className="app-card-company">
          {[job.company, job.location].filter(Boolean).join(' · ')}
        </span>
      )}
      <div className="app-card-footer">
        {score === null ? (
          <div className="app-score-dots">
            <span className="app-score-dot" />
            <span className="app-score-dot" />
            <span className="app-score-dot" />
          </div>
        ) : (
          <span className="app-card-score" style={{ color: scoreColor(score) }}>
            {score}<span className="app-card-pct">%</span>
          </span>
        )}
        {dateLabel && <span className="app-card-date">{dateLabel}</span>}
      </div>
    </div>
  )
}

function KanbanColumn({
  column,
  apps,
  dragId,
  isOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStart,
  onDragEnd,
  onDelete,
}: {
  column: (typeof COLUMNS)[number]
  apps: Application[]
  dragId: string | null
  isOver: boolean
  onDragOver: (col: KanbanStatus) => void
  onDragLeave: () => void
  onDrop: (col: KanbanStatus) => void
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDelete: (id: string) => void
}) {
  return (
    <div
      className={`kanban-col${isOver ? ' kanban-col-over' : ''}`}
      data-col={column.key}
      onDragOver={(e) => {
        e.preventDefault()
        onDragOver(column.key)
      }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault()
        onDrop(column.key)
      }}
    >
      <div className="kanban-col-header">
        <span className="kanban-dot" style={{ background: column.accent }} />
        <span className="kanban-label">{column.label}</span>
        <span className="kanban-count">{apps.length}</span>
      </div>
      <div className="kanban-col-body">
        {apps.map((app) => (
          <AppCard
            key={app.id}
            app={app}
            dragging={dragId === app.id}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDelete={onDelete}
          />
        ))}
        {apps.length === 0 && <div className="kanban-empty">Drop cards here</div>}
      </div>
    </div>
  )
}

export function Pipeline() {
  const { profile, applications, setApplications, upsertApplication, removeApplication, resume } = useAppStore()
  const [loading, setLoading] = useState(true)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<KanbanStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  const touchRef = useRef<{
    cardId: string | null; colOver: KanbanStatus | null
    startX: number; startY: number; active: boolean; cardEl: HTMLElement | null
  }>({ cardId: null, colOver: null, startX: 0, startY: 0, active: false, cardEl: null })
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const moveCardRef = useRef<(status: KanbanStatus, cardId?: string) => Promise<void>>(async () => {})

  const notionConnected = !!(profile as any)?.notion_token && !!(profile as any)?.notion_db_id

  useEffect(() => {
    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function scoreUnscored(apps: Application[], resumeParsed: unknown, userPrefs?: { seniority: string | null; target_titles: string[] }) {
      const unscored = apps.filter((a) => a.job && a.job.match_score === null && a.job.description)
      if (!unscored.length) return
      const BATCH = 3
      for (let i = 0; i < unscored.length; i += BATCH) {
        if (cancelled) break
        await Promise.all(
          unscored.slice(i, i + BATCH).map(async (app) => {
            const { data } = await supabase.functions.invoke('ai-score-job', {
              body: { resume_parsed: resumeParsed, job_description: app.job!.description, user_preferences: userPrefs },
            })
            if (data?.score !== undefined && !cancelled) {
              await supabase
                .from('jobs')
                .update({ match_score: data.score, match_breakdown: data.breakdown ?? null })
                .eq('id', app.job!.id)
              upsertApplication({
                ...app,
                job: { ...app.job!, match_score: data.score, match_breakdown: data.breakdown ?? null },
              })
            }
          })
        )
      }
    }

    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) {
        setLoading(false)
        return
      }

      const [appsResult, resumeResult] = await Promise.all([
        supabase
          .from('applications')
          .select('*, job:jobs!job_id(*)')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('resumes')
          .select('parsed')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

      if (cancelled) return
      if (appsResult.error) console.error('Pipeline fetch error:', appsResult.error)
      const apps = (appsResult.data as Application[]) ?? []
      setApplications(apps)
      setLoading(false)

      const resumeParsed = resumeResult.data?.parsed ?? resume?.parsed
      const userPrefs = profile ? { seniority: profile.seniority, target_titles: profile.target_titles } : undefined
      if (resumeParsed) scoreUnscored(apps, resumeParsed, userPrefs)

      channel = supabase
        .channel('pipeline-apps')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'applications', filter: `user_id=eq.${user.id}` },
          async (payload) => {
            if (payload.eventType === 'DELETE') {
              removeApplication((payload.old as { id: string }).id)
            } else {
              const { data } = await supabase
                .from('applications')
                .select('*, job:jobs!job_id(*)')
                .eq('id', (payload.new as { id: string }).id)
                .single()
              if (data) upsertApplication(data as Application)
            }
          }
        )
        .subscribe()
    }

    init()

    return () => {
      cancelled = true
      if (channel) supabase.removeChannel(channel)
    }
  }, [])

  async function moveCard(targetStatus: KanbanStatus, cardId?: string) {
    const id = cardId ?? dragId
    if (!id) return
    const app = applications.find((a) => a.id === id)
    if (!app || app.status === targetStatus) return

    const patch: Record<string, unknown> = { status: targetStatus }
    if (targetStatus === 'applied' && !app.applied_at) {
      patch.applied_at = new Date().toISOString()
    }

    const updated = { ...app, status: targetStatus, applied_at: (patch.applied_at as string) ?? app.applied_at }
    upsertApplication(updated)
    await supabase.from('applications').update(patch).eq('id', id)

    const p = profile as any
    if (p?.notion_token && p?.notion_db_id) {
      notionUpsert(updated, p.notion_token, p.notion_db_id)
    }
  }
  moveCardRef.current = moveCard

  async function handleSyncAll() {
    const p = profile as any
    if (!p?.notion_token || !p?.notion_db_id || syncing) return
    setSyncing(true)
    setSyncMsg(null)
    try {
      const { data, error } = await supabase.functions.invoke('notion-sync', {
        body: { action: 'sync_all', notion_token: p.notion_token, notion_db_id: p.notion_db_id, applications },
      })
      if (error) throw error
      setSyncMsg(`Synced ${data?.synced ?? 0} cards ✓`)
      setTimeout(() => setSyncMsg(null), 3000)
    } catch {
      setSyncMsg('Sync failed — check Settings')
      setTimeout(() => setSyncMsg(null), 4000)
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      const cardEl = (e.target as HTMLElement).closest('[data-card-id]') as HTMLElement | null
      if (!cardEl) return
      const touch = e.touches[0]
      touchRef.current = { cardId: cardEl.dataset.cardId!, colOver: null, startX: touch.clientX, startY: touch.clientY, active: false, cardEl }
      longPressTimer.current = setTimeout(() => {
        if (touchRef.current.cardId) {
          touchRef.current.active = true
          cardEl.classList.add('app-card--lifting')
          if ('vibrate' in navigator) navigator.vibrate(30)
        }
      }, 300)
    }

    function onTouchMove(e: TouchEvent) {
      const state = touchRef.current
      if (!state.cardId) return
      const touch = e.touches[0]
      if (!state.active) {
        if (Math.abs(touch.clientX - state.startX) > 6 || Math.abs(touch.clientY - state.startY) > 6) {
          if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
          touchRef.current.cardId = null
        }
        return
      }
      e.preventDefault()
      document.querySelectorAll('.kanban-col-over').forEach(el => el.classList.remove('kanban-col-over'))
      state.colOver = null
      for (const el of document.elementsFromPoint(touch.clientX, touch.clientY)) {
        const colEl = (el as HTMLElement).closest('[data-col]') as HTMLElement | null
        if (colEl?.dataset.col) {
          colEl.classList.add('kanban-col-over')
          state.colOver = colEl.dataset.col as KanbanStatus
          break
        }
      }
    }

    function onTouchEnd() {
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
      const { cardId, active, colOver, cardEl } = touchRef.current
      cardEl?.classList.remove('app-card--lifting')
      document.querySelectorAll('.kanban-col-over').forEach(el => el.classList.remove('kanban-col-over'))
      if (active && cardId && colOver) moveCardRef.current(colOver, cardId)
      touchRef.current = { cardId: null, colOver: null, startX: 0, startY: 0, active: false, cardEl: null }
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onTouchEnd)
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      if (longPressTimer.current) clearTimeout(longPressTimer.current)
    }
  }, [])

  async function deleteApplication(id: string) {
    removeApplication(id)
    await supabase.from('applications').delete().eq('id', id)
  }

  const visible = applications.filter((a) => KANBAN_KEYS.includes(a.status))
  const byStatus = (key: KanbanStatus) =>
    visible
      .filter((a) => a.status === key)
      .sort((a, b) => {
        const sa = a.job?.match_score ?? -1
        const sb = b.job?.match_score ?? -1
        return sb - sa
      })

  return (
    <div className="pipeline-page">
      <div className="pipeline-header">
        <h1 className="page-title">Pipeline</h1>
        {!loading && (
          <span className="pipeline-total">{visible.length} application{visible.length !== 1 ? 's' : ''}</span>
        )}
        {notionConnected && (
          <div className="pipeline-notion">
            {syncMsg && <span className="notion-sync-msg">{syncMsg}</span>}
            <button className="btn btn-ghost notion-sync-btn" onClick={handleSyncAll} disabled={syncing}>
              {syncing ? 'Syncing…' : '↑ Sync Notion'}
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="pipeline-loading">
          {COLUMNS.map((col) => (
            <div key={col.key} className="kanban-col kanban-col-skeleton">
              <div className="kanban-col-header">
                <span className="kanban-dot" style={{ background: col.accent }} />
                <span className="kanban-label">{col.label}</span>
              </div>
              <div className="kanban-col-body">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="app-card card sk-card">
                    <div className="sk-line sk-title" />
                    <div className="sk-line sk-sub" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="kanban-board">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.key}
              column={col}
              apps={byStatus(col.key)}
              dragId={dragId}
              isOver={dragOver === col.key && dragId !== null}
              onDragOver={setDragOver}
              onDragLeave={() => setDragOver(null)}
              onDrop={(col) => {
                moveCard(col)
                setDragOver(null)
                setDragId(null)
              }}
              onDragStart={setDragId}
              onDragEnd={() => {
                setDragId(null)
                setDragOver(null)
              }}
              onDelete={deleteApplication}
            />
          ))}
        </div>
      )}

      <style>{`
        .pipeline-page {
          padding: 32px;
          height: 100dvh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-sizing: border-box;
        }
        .pipeline-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding-bottom: 20px;
          flex-shrink: 0;
        }
        .pipeline-notion { display: flex; align-items: center; gap: 10px; margin-left: auto; }
        .notion-sync-btn { font-size: 12px; padding: 5px 12px; }
        .notion-sync-msg { font-size: 12px; color: rgba(242,240,234,0.5); }
        .page-title { font-size: 28px; }
        .pipeline-total {
          font-size: 13px;
          color: rgba(242,240,234,0.4);
          font-family: "DM Mono", monospace;
        }
        .kanban-board, .pipeline-loading {
          display: flex;
          gap: 12px;
          flex: 1;
          overflow-x: auto;
          overflow-y: hidden;
          padding-bottom: 8px;
        }
        .kanban-col {
          flex-shrink: 0;
          width: 252px;
          display: flex;
          flex-direction: column;
          background: rgba(255,255,255,0.02);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-card);
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .kanban-col-over {
          border-color: var(--color-accent);
          background: rgba(99,139,255,0.05);
        }
        .kanban-col-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 14px 10px;
          border-bottom: 1px solid var(--color-border);
          flex-shrink: 0;
        }
        .kanban-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .kanban-label {
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: rgba(242,240,234,0.65);
          flex: 1;
        }
        .kanban-count {
          font-size: 12px;
          font-family: "DM Mono", monospace;
          color: rgba(242,240,234,0.35);
        }
        .kanban-col-body {
          flex: 1;
          overflow-y: auto;
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .kanban-empty {
          font-size: 12px;
          color: rgba(242,240,234,0.2);
          text-align: center;
          padding: 24px 0;
          border: 1px dashed rgba(255,255,255,0.08);
          border-radius: var(--radius-btn);
        }
        .app-card {
          padding: 12px;
          cursor: grab;
          user-select: none;
          transition: opacity 0.15s ease, border-color 0.15s ease;
        }
        .app-card:hover {
          border-color: var(--color-border-hover);
        }
        .app-card:active { cursor: grabbing; }
        .app-card--lifting {
          opacity: 0.6;
          transform: scale(0.97);
          border-color: var(--color-accent) !important;
        }
        .app-card-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 6px;
          margin-bottom: 3px;
        }
        .app-card-title {
          font-size: 13px;
          font-weight: 600;
          line-height: 1.35;
          flex: 1;
        }
        .app-card-del {
          background: none;
          border: none;
          color: rgba(242,240,234,0.25);
          font-size: 16px;
          line-height: 1;
          padding: 0 2px;
          cursor: pointer;
          flex-shrink: 0;
          transition: color 0.12s;
        }
        .app-card-del:hover { color: rgba(242,240,234,0.7); }
        .app-card-company {
          font-size: 12px;
          color: rgba(242,240,234,0.45);
          display: block;
          margin-bottom: 8px;
        }
        .app-card-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          padding-top: 8px;
          border-top: 1px solid var(--color-border);
        }
        .app-card-score {
          font-size: 15px;
          font-weight: 700;
          font-family: "DM Mono", monospace;
          line-height: 1;
        }
        .app-card-pct {
          font-size: 10px;
          font-weight: 500;
          opacity: 0.7;
          margin-left: 1px;
        }
        .app-score-dots { display: flex; gap: 3px; align-items: center; }
        .app-score-dot {
          width: 4px; height: 4px; border-radius: 50%;
          background: var(--color-accent); opacity: 0.35;
          animation: score-bounce 1.1s ease-in-out infinite;
        }
        .app-score-dot:nth-child(2) { animation-delay: 0.18s; }
        .app-score-dot:nth-child(3) { animation-delay: 0.36s; }
        @keyframes score-bounce {
          0%, 70%, 100% { transform: translateY(0); opacity: 0.35; }
          35% { transform: translateY(-4px); opacity: 0.9; }
        }
        .app-card-date {
          font-size: 11px;
          color: rgba(242,240,234,0.35);
          font-family: "DM Mono", monospace;
        }
        .sk-card { pointer-events: none; }
        .sk-line {
          background: rgba(255,255,255,0.06);
          border-radius: 4px;
          animation: sk-pulse 1.4s ease-in-out infinite;
        }
        .sk-title { height: 13px; width: 80%; margin-bottom: 8px; }
        .sk-sub { height: 11px; width: 55%; }
        @keyframes sk-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        @media (max-width: 768px) {
          .pipeline-page { height: auto; overflow: visible; padding: 16px 16px 0; }
          .pipeline-header { padding-bottom: 14px; }
          .page-title { font-size: 22px; }
          .kanban-board, .pipeline-loading { overflow-x: auto; padding-bottom: 16px; -webkit-overflow-scrolling: touch; }
          .kanban-col { width: 200px; }
          .pipeline-notion { flex-direction: column; align-items: flex-end; gap: 6px; }
        }
      `}</style>
    </div>
  )
}

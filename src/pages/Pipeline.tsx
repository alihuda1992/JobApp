import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAppStore } from '@/store/useAppStore'
import { useAuth } from '@/hooks/useAuth'
import type { Application } from '@/types'

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
      onDragStart={() => onDragStart(app.id)}
      onDragEnd={onDragEnd}
      onClick={() => job && navigate(`/jobs/${job.id}`)}
      style={{ opacity: dragging ? 0.35 : 1, cursor: 'grab' }}
    >
      <div className="app-card-header">
        <span className="app-card-title">{job?.title ?? 'Unknown role'}</span>
        <button className="app-card-del" onClick={handleDelete} title="Remove">×</button>
      </div>
      {job?.company && <span className="app-card-company">{job.company}</span>}
      <div className="app-card-footer">
        {score !== null && (
          <span className="app-card-score" style={{ color: scoreColor(score) }}>
            {score}
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
  const { user } = useAuth()
  const { applications, setApplications, upsertApplication, removeApplication } = useAppStore()
  const [loading, setLoading] = useState(true)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<KanbanStatus | null>(null)

  useEffect(() => {
    if (!user) return

    supabase
      .from('applications')
      .select('*, job:jobs(*)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setApplications(data as Application[])
        setLoading(false)
      })

    const channel = supabase
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
              .select('*, job:jobs(*)')
              .eq('id', (payload.new as { id: string }).id)
              .single()
            if (data) upsertApplication(data as Application)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id])

  async function moveCard(targetStatus: KanbanStatus) {
    if (!dragId) return
    const app = applications.find((a) => a.id === dragId)
    if (!app || app.status === targetStatus) return

    const patch: Record<string, unknown> = { status: targetStatus }
    if (targetStatus === 'applied' && !app.applied_at) {
      patch.applied_at = new Date().toISOString()
    }

    upsertApplication({ ...app, status: targetStatus, applied_at: (patch.applied_at as string) ?? app.applied_at })

    await supabase.from('applications').update(patch).eq('id', dragId)
  }

  async function deleteApplication(id: string) {
    removeApplication(id)
    await supabase.from('applications').delete().eq('id', id)
  }

  const visible = applications.filter((a) => KANBAN_KEYS.includes(a.status))
  const byStatus = (key: KanbanStatus) => visible.filter((a) => a.status === key)

  return (
    <div className="pipeline-page">
      <div className="pipeline-header">
        <h1 className="page-title">Pipeline</h1>
        {!loading && (
          <span className="pipeline-total">{visible.length} application{visible.length !== 1 ? 's' : ''}</span>
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
          padding: 0;
          height: calc(100vh - 64px);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .pipeline-header {
          display: flex;
          align-items: baseline;
          gap: 12px;
          padding: 0 0 20px 0;
          flex-shrink: 0;
        }
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
          .pipeline-page { height: auto; overflow: visible; }
          .kanban-board, .pipeline-loading { overflow-x: auto; padding-bottom: 16px; }
          .kanban-col { width: 220px; }
        }
      `}</style>
    </div>
  )
}

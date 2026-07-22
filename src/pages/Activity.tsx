import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAppStore } from '@/store/useAppStore'
import type { ActivityEntry } from '@/types'

const ACTOR_LABEL: Record<string, string> = {
  claude: '✦ Claude',
  user: 'You',
  system: 'Auto',
}

const STATUS_LABEL: Record<string, string> = {
  saved: 'Saved',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  closed: 'Closed',
  rejected: 'Rejected',
}

function describe(entry: ActivityEntry): string {
  const d = entry.details ?? {}
  switch (entry.action) {
    case 'created':
      return d.needs_review
        ? `Flagged for review (${STATUS_LABEL[d.status as string] ?? d.status}) — uncertain match, needs your OK`
        : `Added to pipeline (${STATUS_LABEL[d.status as string] ?? d.status})`
    case 'status_changed':
      return `Moved ${STATUS_LABEL[d.from as string] ?? d.from} → ${STATUS_LABEL[d.to as string] ?? d.to}`
    case 'archived':
      return 'Archived (30+ days in a closed status)'
    case 'unarchived':
      return 'Restored from archive'
    case 'flagged_for_review':
      return 'Flagged for review — needs your OK'
    case 'review_approved':
      return 'Approved from review queue'
    case 'review_dismissed':
      return 'Dismissed from review queue'
    case 'notes_updated': {
      const note = String(d.note ?? '')
      const lastLine = note.split('\n').filter(Boolean).pop()
      return lastLine ? `Note: ${lastLine}` : 'Notes updated'
    }
    case 'next_step_updated':
      return d.next_step ? `Next step: ${d.next_step}` : 'Next step cleared'
    case 'deleted':
      return 'Removed from pipeline'
    case 'cover_letter_saved':
      return 'Cover letter saved'
    case 'job_scored':
      return d.score != null ? `Match scored: ${d.score}%` : 'Match scored'
    default:
      return entry.action
  }
}

function timeLabel(iso: string): string {
  const date = new Date(iso)
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function dayKey(iso: string): string {
  const date = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export function Activity() {
  const navigate = useNavigate()
  const { setUnreadActivity } = useAppStore()
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  // Snapshot of last_seen at page open — keeps "new" highlights visible after we mark read
  const [seenBefore, setSeenBefore] = useState<string | null>(null)
  const markedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) {
        setLoading(false)
        return
      }

      const [logResult, profileResult] = await Promise.all([
        supabase
          .from('activity_log')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(100),
        supabase.from('profiles').select('last_seen_activity_at').eq('id', user.id).single(),
      ])

      if (cancelled) return
      setEntries((logResult.data as ActivityEntry[]) ?? [])
      setSeenBefore(profileResult.data?.last_seen_activity_at ?? null)
      setLoading(false)

      // Mark everything read once per visit
      if (!markedRef.current) {
        markedRef.current = true
        await supabase
          .from('profiles')
          .update({ last_seen_activity_at: new Date().toISOString() })
          .eq('id', user.id)
        setUnreadActivity(0)
      }

      channel = supabase
        .channel('activity-page')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'activity_log', filter: `user_id=eq.${user.id}` },
          (payload) => {
            setEntries((prev) => [payload.new as ActivityEntry, ...prev])
          }
        )
        .subscribe()
    }

    init()
    return () => {
      cancelled = true
      if (channel) supabase.removeChannel(channel)
    }
  }, [setUnreadActivity])

  const isNew = (entry: ActivityEntry) =>
    seenBefore !== null && entry.created_at > seenBefore

  // Group into day buckets, preserving newest-first order
  const groups: { day: string; items: ActivityEntry[] }[] = []
  for (const entry of entries) {
    const day = dayKey(entry.created_at)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.items.push(entry)
    else groups.push({ day, items: [entry] })
  }

  return (
    <div className="activity-page">
      <div className="activity-header">
        <h1 className="page-title">Activity</h1>
        <span className="activity-sub">what changed while you were away</span>
      </div>

      {loading ? (
        <div className="activity-empty">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="activity-empty card">
          No activity yet. Changes to your pipeline — yours, Claude's, or automatic
          archiving — will show up here.
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.day} className="activity-group">
            <div className="activity-day">{group.day}</div>
            {group.items.map((entry) => (
              <div
                key={entry.id}
                className={`activity-row card${isNew(entry) ? ' activity-row--new' : ''}${entry.job_id ? ' activity-row--link' : ''}`}
                onClick={() => entry.job_id && entry.action !== 'deleted' && navigate(`/jobs/${entry.job_id}`)}
              >
                <span
                  className={`activity-actor activity-actor--${entry.actor ?? 'unknown'}`}
                >
                  {ACTOR_LABEL[entry.actor ?? ''] ?? '—'}
                </span>
                <div className="activity-body">
                  <span className="activity-what">{describe(entry)}</span>
                  <span className="activity-job">
                    {[entry.job_title, entry.company].filter(Boolean).join(' · ') || 'Unknown job'}
                  </span>
                </div>
                <span className="activity-time">{timeLabel(entry.created_at)}</span>
              </div>
            ))}
          </div>
        ))
      )}

      <style>{`
        .activity-page {
          padding: 32px;
          max-width: 720px;
        }
        .activity-header {
          display: flex;
          align-items: baseline;
          gap: 12px;
          padding-bottom: 20px;
        }
        .activity-sub {
          font-size: 13px;
          color: rgba(242,240,234,0.4);
        }
        .activity-empty {
          padding: 32px;
          font-size: 13px;
          color: rgba(242,240,234,0.5);
          text-align: center;
        }
        .activity-group { margin-bottom: 22px; }
        .activity-day {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: rgba(242,240,234,0.35);
          padding: 0 2px 8px;
        }
        .activity-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          margin-bottom: 8px;
        }
        .activity-row--link { cursor: pointer; }
        .activity-row--link:hover { border-color: var(--color-border-hover); }
        .activity-row--new {
          border-left: 2px solid var(--color-accent);
        }
        .activity-actor {
          flex-shrink: 0;
          font-size: 11px;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: 999px;
          border: 1px solid var(--color-border);
          color: rgba(242,240,234,0.55);
          white-space: nowrap;
        }
        .activity-actor--claude {
          color: var(--color-accent);
          border-color: rgba(99,139,255,0.35);
        }
        .activity-actor--system {
          color: var(--color-secondary);
          border-color: rgba(255,193,99,0.3);
        }
        .activity-body {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .activity-what {
          font-size: 13px;
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .activity-job {
          font-size: 12px;
          color: rgba(242,240,234,0.45);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .activity-time {
          flex-shrink: 0;
          font-size: 11px;
          font-family: "DM Mono", monospace;
          color: rgba(242,240,234,0.35);
        }
        @media (max-width: 768px) {
          .activity-page { padding: 16px; }
          .activity-header { flex-direction: column; gap: 2px; padding-bottom: 14px; }
          .page-title { font-size: 22px; }
        }
      `}</style>
    </div>
  )
}

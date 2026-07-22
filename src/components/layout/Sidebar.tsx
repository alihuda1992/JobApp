import { useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { useAppStore } from '@/store/useAppStore'
import type { ActivityEntry } from '@/types'

const navItems = [
  { to: '/', label: 'Pipeline', icon: '⬡' },
  { to: '/search', label: 'Search', icon: '⊹' },
  { to: '/resume', label: 'Resume', icon: '◈' },
  { to: '/activity', label: 'Activity', icon: '✦' },
  { to: '/settings', label: 'Settings', icon: '◎' },
]

export function Sidebar() {
  const { user, signOut } = useAuth()
  const { unreadActivity, setUnreadActivity, bumpUnreadActivity } = useAppStore()

  useEffect(() => {
    if (!user) return
    let cancelled = false

    async function loadUnread() {
      // Unseen entries not made by the user in-app (claude / system / unknown)
      const { data: profile } = await supabase
        .from('profiles')
        .select('last_seen_activity_at')
        .eq('id', user!.id)
        .single()
      if (cancelled || !profile) return
      const since = profile.last_seen_activity_at ?? '1970-01-01'
      const { count, error } = await supabase
        .from('activity_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user!.id)
        .gt('created_at', since)
        .or('actor.neq.user,actor.is.null')
      if (!cancelled && !error && count !== null) setUnreadActivity(count)
    }

    loadUnread()

    const channel = supabase
      .channel('activity-badge')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'activity_log', filter: `user_id=eq.${user.id}` },
        (payload) => {
          const entry = payload.new as ActivityEntry
          if (entry.actor !== 'user') bumpUnreadActivity()
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const badge =
    unreadActivity > 0 ? (
      <span className="nav-badge">{unreadActivity > 99 ? '99+' : unreadActivity}</span>
    ) : null

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <NavLink to="/" className="sidebar-logo-text">The Job App</NavLink>
        </div>

        <nav className="sidebar-nav">
          {navItems.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `sidebar-link${isActive ? ' sidebar-link--active' : ''}`
              }
            >
              <span className="sidebar-link-icon">{icon}</span>
              {label}
              {to === '/activity' && badge}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-user-email">{user?.email}</div>
          <button className="btn btn-ghost sidebar-signout" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile bottom tab bar */}
      <nav className="mobile-tabs">
        {navItems.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `mobile-tab${isActive ? ' mobile-tab--active' : ''}`
            }
          >
            <span className="mobile-tab-icon">
              {icon}
              {to === '/activity' && unreadActivity > 0 && <span className="mobile-tab-dot" />}
            </span>
            <span className="mobile-tab-label">{label}</span>
          </NavLink>
        ))}
      </nav>

      <style>{`
        .sidebar {
          width: var(--sidebar-width);
          height: 100vh;
          position: fixed;
          top: 0;
          left: 0;
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--color-border);
          background: var(--color-bg);
          padding: 20px 0;
          z-index: 10;
        }

        .sidebar-logo {
          padding: 0 20px 24px;
          border-bottom: 1px solid var(--color-border);
          margin-bottom: 12px;
        }

        .sidebar-logo-text {
          font-family: "Instrument Serif", serif;
          font-size: 20px;
          color: var(--color-text);
          letter-spacing: -0.3px;
          text-decoration: none;
        }

        .sidebar-nav {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 0 10px;
        }

        .sidebar-link {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          border-radius: 7px;
          color: rgba(242, 240, 234, 0.55);
          font-size: 13px;
          font-weight: 450;
          transition: color 0.15s ease, background 0.15s ease;
          text-decoration: none;
        }

        .sidebar-link:hover {
          color: var(--color-text);
          background: rgba(255, 255, 255, 0.05);
          opacity: 1;
        }

        .sidebar-link--active {
          color: var(--color-text);
          background: rgba(255, 255, 255, 0.07);
        }

        .sidebar-link-icon {
          font-size: 15px;
          width: 18px;
          text-align: center;
        }

        .nav-badge {
          margin-left: auto;
          font-size: 10px;
          font-weight: 700;
          font-family: "DM Mono", monospace;
          line-height: 1;
          padding: 3px 6px;
          border-radius: 999px;
          background: var(--color-accent);
          color: #0e0f11;
        }

        .mobile-tab-icon { position: relative; }

        .mobile-tab-dot {
          position: absolute;
          top: -2px;
          right: -6px;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--color-accent);
        }

        .sidebar-bottom {
          padding: 16px 16px 0;
          border-top: 1px solid var(--color-border);
          margin-top: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .sidebar-user-email {
          font-size: 11px;
          color: rgba(242, 240, 234, 0.35);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .sidebar-signout {
          width: 100%;
          font-size: 12px;
          padding: 6px 10px;
        }

        .mobile-tabs {
          display: none;
        }

        @media (max-width: 768px) {
          .sidebar {
            display: none;
          }

          .mobile-tabs {
            display: flex;
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            height: auto;
            padding-bottom: env(safe-area-inset-bottom);
            background: var(--color-bg);
            border-top: 1px solid var(--color-border);
            z-index: 10;
          }

          .mobile-tab {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 3px;
            height: 60px;
            color: rgba(242, 240, 234, 0.45);
            text-decoration: none;
            transition: color 0.15s ease;
          }

          .mobile-tab--active {
            color: var(--color-accent);
          }

          .mobile-tab-icon {
            font-size: 18px;
          }

          .mobile-tab-label {
            font-size: 10px;
            font-weight: 500;
          }
        }
      `}</style>
    </>
  )
}

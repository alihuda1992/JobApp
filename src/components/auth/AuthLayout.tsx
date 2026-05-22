import type { ReactNode } from 'react'

const IMAGE_URL =
  'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1400&q=80'

interface AuthLayoutProps {
  children: ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="auth-shell">
      {/* ── Left panel: form ── */}
      <div className="auth-left">
        <div className="auth-inner">
          <div className="auth-brand">
            <div className="auth-logo">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" />
                <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
                <line x1="12" y1="12" x2="12" y2="17" />
                <line x1="9" y1="14.5" x2="15" y2="14.5" />
              </svg>
            </div>
            <span className="auth-brand-name">The Job App</span>
          </div>
          {children}
        </div>
      </div>

      {/* ── Right panel: image ── */}
      <div className="auth-right">
        <img src={IMAGE_URL} alt="" className="auth-bg-img" />
        <div className="auth-img-overlay" />
        <div className="auth-overlay-brand">
          <div className="auth-overlay-logo">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" />
              <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
              <line x1="12" y1="12" x2="12" y2="17" />
              <line x1="9" y1="14.5" x2="15" y2="14.5" />
            </svg>
          </div>
          <span className="auth-overlay-brand-name">The Job App</span>
        </div>
        <div className="auth-caption">
          <p className="auth-caption-heading">Land your next role.</p>
          <p className="auth-caption-sub">
            AI-powered search, scoring, and applications — all in one place.
          </p>
        </div>
      </div>

      <style>{`
        .auth-shell {
          display: flex;
          min-height: 100vh;
        }

        /* ── Left ── */
        .auth-left {
          flex: 0 0 520px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--color-bg);
          padding: 64px 56px;
          overflow-y: auto;
        }
        .auth-inner {
          width: 100%;
          max-width: 400px;
        }
        .auth-brand {
          display: none;
          align-items: center;
          gap: 10px;
          margin-bottom: 52px;
        }
        .auth-logo {
          width: 36px;
          height: 36px;
          background: var(--color-accent);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          flex-shrink: 0;
        }
        .auth-brand-name {
          font-family: 'Instrument Serif', Georgia, serif;
          font-size: 18px;
          color: var(--color-text);
          letter-spacing: -0.2px;
        }

        /* ── Form elements (shared by Login & Signup) ── */
        .auth-title {
          font-size: 26px;
          font-weight: 600;
          margin-bottom: 8px;
          color: var(--color-text);
          line-height: 1.2;
        }
        .auth-subtitle {
          color: rgba(242, 240, 234, 0.45);
          font-size: 14px;
          margin-bottom: 36px;
        }
        .oauth-group {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .btn-oauth {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 11px 16px;
          background: rgba(255,255,255,0.05);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-btn);
          color: var(--color-text);
          font-size: 14px;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
        }
        .btn-oauth:hover:not(:disabled) {
          background: rgba(255,255,255,0.09);
          border-color: var(--color-border-hover);
        }
        .btn-oauth:disabled { opacity: 0.5; cursor: not-allowed; }
        .auth-divider {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 28px 0;
          color: rgba(242,240,234,0.3);
          font-size: 12px;
        }
        .auth-divider::before,
        .auth-divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: var(--color-border);
        }
        .auth-form {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .form-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .form-label {
          font-size: 11px;
          font-weight: 500;
          color: rgba(242, 240, 234, 0.55);
          text-transform: uppercase;
          letter-spacing: 0.6px;
        }
        .auth-error {
          background: rgba(220, 50, 50, 0.12);
          border: 1px solid rgba(220, 50, 50, 0.3);
          border-radius: var(--radius-btn);
          color: #f87171;
          font-size: 12px;
          padding: 8px 12px;
        }
        .auth-submit {
          width: 100%;
          margin-top: 4px;
          padding: 11px;
          font-size: 14px;
        }
        .auth-switch {
          text-align: center;
          margin-top: 28px;
          font-size: 13px;
          color: rgba(242, 240, 234, 0.45);
        }
        .auth-switch a {
          color: var(--color-accent);
          text-decoration: none;
        }
        .auth-switch a:hover { text-decoration: underline; }

        /* ── Right ── */
        .auth-right {
          flex: 1;
          position: relative;
          overflow: hidden;
          min-height: 100vh;
        }
        .auth-bg-img {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center;
        }
        .auth-img-overlay {
          position: absolute;
          inset: 0;
          background:
            linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 28%),
            linear-gradient(to top,    rgba(0,0,0,0.80) 0%, rgba(0,0,0,0) 45%);
        }
        .auth-overlay-brand {
          position: absolute;
          top: 48px;
          left: 52px;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .auth-overlay-logo {
          width: 48px;
          height: 48px;
          background: var(--color-accent);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          flex-shrink: 0;
        }
        .auth-overlay-brand-name {
          font-family: 'Instrument Serif', Georgia, serif;
          font-size: 26px;
          color: #fff;
          letter-spacing: -0.3px;
        }
        .auth-caption {
          position: absolute;
          bottom: 52px;
          left: 52px;
          right: 52px;
        }
        .auth-caption-heading {
          font-family: 'Instrument Serif', Georgia, serif;
          font-size: 36px;
          font-weight: 400;
          color: #fff;
          line-height: 1.15;
          margin-bottom: 10px;
          letter-spacing: -0.5px;
        }
        .auth-caption-sub {
          font-size: 15px;
          color: rgba(255, 255, 255, 0.65);
          line-height: 1.5;
          max-width: 380px;
        }

        /* ── Responsive: hide right panel on small screens ── */
        @media (max-width: 860px) {
          .auth-left {
            flex: 1;
            padding: 40px 28px;
          }
          .auth-brand { display: flex; }
          .auth-right { display: none; }
        }
      `}</style>
    </div>
  )
}

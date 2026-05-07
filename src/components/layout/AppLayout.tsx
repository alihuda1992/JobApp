import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export function AppLayout() {
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="app-main">
        <Outlet />
      </main>

      <style>{`
        .app-layout {
          display: flex;
          height: 100%;
          min-height: 100vh;
        }

        .app-main {
          margin-left: var(--sidebar-width);
          flex: 1;
          overflow-y: auto;
          padding: 32px;
          min-height: 100vh;
        }

        @media (max-width: 768px) {
          .app-main {
            margin-left: 0;
            padding: 20px 16px 80px;
          }
        }
      `}</style>
    </div>
  )
}

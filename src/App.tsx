import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { Login } from '@/pages/Login'
import { Signup } from '@/pages/Signup'
import { Onboarding } from '@/pages/Onboarding'
import { Pipeline } from '@/pages/Pipeline'
import { Search } from '@/pages/Search'
import { JobDetail } from '@/pages/JobDetail'
import { Resume } from '@/pages/Resume'
import { CoverLetter } from '@/pages/CoverLetter'
import { TailoredResume } from '@/pages/TailoredResume'
import { Settings } from '@/pages/Settings'

export default function App() {
  return (
    <BrowserRouter basename="/JobApp">
      <Routes>
        {/* Public */}
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />

        {/* Onboarding — protected but outside main layout */}
        <Route
          path="/onboarding"
          element={
            <ProtectedRoute>
              <Onboarding />
            </ProtectedRoute>
          }
        />

        {/* Main app — protected, with sidebar layout */}
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Pipeline />} />
          <Route path="/search" element={<Search />} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/resume" element={<Resume />} />
          <Route path="/cover/:jobId" element={<CoverLetter />} />
          <Route path="/tailored-resume/:jobId" element={<TailoredResume />} />
          <Route path="/settings" element={<Settings />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

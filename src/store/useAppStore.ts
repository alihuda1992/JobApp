import { create } from 'zustand'
import type { Profile, Job, Application, Resume } from '@/types'

interface AppStore {
  profile: Profile | null
  resume: Resume | null
  jobs: Job[]
  applications: Application[]
  searchResults: Job[]
  savedJobIds: Set<string>
  setProfile: (profile: Profile | null) => void
  setResume: (resume: Resume | null) => void
  setJobs: (jobs: Job[]) => void
  setApplications: (applications: Application[]) => void
  upsertApplication: (application: Application) => void
  removeApplication: (id: string) => void
  setSearchResults: (jobs: Job[]) => void
  updateJobScore: (jobId: string, score: number, breakdown: Job['match_breakdown']) => void
  addSavedJobId: (id: string) => void
  unreadActivity: number
  setUnreadActivity: (count: number) => void
  bumpUnreadActivity: () => void
}

export const useAppStore = create<AppStore>((set) => ({
  profile: null,
  resume: null,
  jobs: [],
  applications: [],
  searchResults: [],
  savedJobIds: new Set(),

  setProfile: (profile) => set({ profile }),
  setResume: (resume) => set({ resume }),
  setJobs: (jobs) => set({ jobs }),
  setApplications: (applications) => set({ applications }),

  upsertApplication: (application) =>
    set((state) => {
      const existing = state.applications.findIndex((a) => a.id === application.id)
      if (existing >= 0) {
        const updated = [...state.applications]
        updated[existing] = application
        return { applications: updated }
      }
      return { applications: [...state.applications, application] }
    }),

  removeApplication: (id) =>
    set((state) => ({
      applications: state.applications.filter((a) => a.id !== id),
    })),

  setSearchResults: (jobs) => set({ searchResults: jobs }),

  updateJobScore: (jobId, score, breakdown) =>
    set((state) => ({
      searchResults: state.searchResults.map((j) =>
        j.id === jobId ? { ...j, match_score: score, match_breakdown: breakdown } : j
      ),
    })),

  addSavedJobId: (id) =>
    set((state) => ({
      savedJobIds: new Set([...state.savedJobIds, id]),
    })),

  unreadActivity: 0,
  setUnreadActivity: (count) => set({ unreadActivity: count }),
  bumpUnreadActivity: () => set((state) => ({ unreadActivity: state.unreadActivity + 1 })),
}))

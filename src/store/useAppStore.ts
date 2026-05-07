import { create } from 'zustand'
import type { Profile, Job, Application, Resume } from '@/types'

interface AppStore {
  profile: Profile | null
  resume: Resume | null
  jobs: Job[]
  applications: Application[]
  setProfile: (profile: Profile | null) => void
  setResume: (resume: Resume | null) => void
  setJobs: (jobs: Job[]) => void
  setApplications: (applications: Application[]) => void
  upsertApplication: (application: Application) => void
  removeApplication: (id: string) => void
}

export const useAppStore = create<AppStore>((set) => ({
  profile: null,
  resume: null,
  jobs: [],
  applications: [],

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
}))

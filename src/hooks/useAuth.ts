import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useAppStore } from '@/store/useAppStore'
import type { Profile, Resume } from '@/types'

interface AuthState {
  user: User | null
  loading: boolean
  signOut: () => Promise<void>
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const { setResume, setProfile } = useAppStore()

  async function fetchActiveResume(userId: string) {
    const { data } = await supabase
      .from('resumes')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setResume(data as Resume | null)
  }

  async function fetchOrCreateProfile(userId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (data) {
      setProfile(data as Profile)
      return data as Profile
    }

    // First-time OAuth sign-in — no profile exists yet
    const { data: created } = await supabase
      .from('profiles')
      .insert({ id: userId, onboarding_complete: false, target_titles: [], preferred_locations: [], company_size_prefs: [] })
      .select()
      .single()

    if (created) setProfile(created as Profile)
    return created as Profile | null
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
      if (session?.user) {
        fetchOrCreateProfile(session.user.id).then((p) => {
          if (p && !p.onboarding_complete) navigate('/onboarding', { replace: true })
        }).catch(() => {})
        fetchActiveResume(session.user.id).catch(() => {})
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
        if (session?.user) {
          fetchOrCreateProfile(session.user.id).then((p) => {
            if (p && !p.onboarding_complete) navigate('/onboarding', { replace: true })
          }).catch(() => {})
          fetchActiveResume(session.user.id).catch(() => {})
        } else {
          setProfile(null)
          setResume(null)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [navigate])

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  return { user, loading, signOut }
}

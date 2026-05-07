import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/types'

interface AuthState {
  user: User | null
  profile: Profile | null
  loading: boolean
  signOut: () => Promise<void>
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

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
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        const p = await fetchOrCreateProfile(session.user.id)
        if (p && !p.onboarding_complete) {
          navigate('/onboarding', { replace: true })
        }
      }
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setUser(session?.user ?? null)
        if (session?.user) {
          const p = await fetchOrCreateProfile(session.user.id)
          if (p && !p.onboarding_complete) {
            navigate('/onboarding', { replace: true })
          }
        } else {
          setProfile(null)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [navigate])

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  return { user, profile, loading, signOut }
}

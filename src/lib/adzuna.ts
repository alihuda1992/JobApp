import type { Job } from '@/types'

const APP_ID = import.meta.env.VITE_ADZUNA_APP_ID as string
const APP_KEY = import.meta.env.VITE_ADZUNA_APP_KEY as string
const BASE = 'https://api.adzuna.com/v1/api/jobs/us/search'

interface AdzunaResult {
  id: string
  title: string
  company: { display_name: string }
  location: { display_name: string }
  salary_min?: number
  salary_max?: number
  description: string
  redirect_url: string
  created: string
}

interface AdzunaResponse {
  results: AdzunaResult[]
}

export function adzunaConfigured(): boolean {
  return APP_ID !== 'your-adzuna-app-id' && !!APP_ID
}

export async function searchJobs(params: {
  query: string
  location?: string
  salaryMin?: number
  page?: number
}): Promise<Job[]> {
  const { query, location, salaryMin, page = 1 } = params

  const url = new URL(`${BASE}/${page}`)
  url.searchParams.set('app_id', APP_ID)
  url.searchParams.set('app_key', APP_KEY)
  url.searchParams.set('what', query)
  url.searchParams.set('results_per_page', '20')
  if (location) url.searchParams.set('where', location)
  if (salaryMin) url.searchParams.set('salary_min', String(salaryMin))

  let res: Response
  try {
    res = await fetch(url.toString())
  } catch {
    throw new Error('Search unavailable — check your connection')
  }

  if (res.status === 429) throw new Error('Rate limit reached — try again in a moment')
  if (!res.ok) throw new Error(`Search failed (${res.status})`)

  const data: AdzunaResponse = await res.json()
  if (!data.results?.length) return []

  return data.results.map((r): Job => ({
    id: crypto.randomUUID(),
    user_id: '',
    source: 'adzuna',
    external_id: r.id,
    title: r.title,
    company: r.company?.display_name ?? null,
    location: r.location?.display_name ?? null,
    salary_min: r.salary_min ?? null,
    salary_max: r.salary_max ?? null,
    salary_currency: 'USD',
    description: r.description,
    tags: [],
    url: r.redirect_url,
    posted_at: r.created,
    match_score: null,
    match_breakdown: null,
    created_at: new Date().toISOString(),
  }))
}

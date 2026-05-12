import type { Job } from '@/types'

const BASE = 'https://remotive.com/api/remote-jobs'

interface RemotiveJob {
  id: number
  url: string
  title: string
  company_name: string
  tags: string[]
  publication_date: string
  candidate_required_location: string
  description: string
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function searchRemotive(query: string): Promise<Job[]> {
  const url = new URL(BASE)
  url.searchParams.set('search', query)
  url.searchParams.set('limit', '20')

  try {
    const res = await fetch(url.toString())
    if (!res.ok) return []
    const data = await res.json()
    const jobs: RemotiveJob[] = data.jobs ?? []

    return jobs.map((r): Job => ({
      id: crypto.randomUUID(),
      user_id: '',
      source: 'remotive',
      external_id: String(r.id),
      title: r.title,
      company: r.company_name ?? null,
      location: r.candidate_required_location || 'Remote',
      salary_min: null,
      salary_max: null,
      salary_currency: 'USD',
      description: stripHtml(r.description),
      tags: r.tags ?? [],
      url: r.url,
      posted_at: r.publication_date ?? null,
      match_score: null,
      match_breakdown: null,
      created_at: new Date().toISOString(),
    }))
  } catch {
    return []
  }
}

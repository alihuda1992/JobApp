import type { Job } from '@/types'

const BASE = 'https://arbeitnow.com/api/job-board-api'

interface ArbeitnowJob {
  slug: string
  company_name: string
  title: string
  description: string
  remote: boolean
  tags: string[]
  location: string
  created_at: number
  url: string
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function searchArbeitnow(query: string): Promise<Job[]> {
  try {
    const res = await fetch(BASE)
    if (!res.ok) return []
    const data = await res.json()
    const jobs: ArbeitnowJob[] = data.data ?? []

    const q = query.toLowerCase()
    const filtered = jobs.filter(
      (j) =>
        j.title.toLowerCase().includes(q) ||
        j.tags.some((t) => t.toLowerCase().includes(q))
    )

    return filtered.map((r): Job => ({
      id: crypto.randomUUID(),
      user_id: '',
      source: 'arbeitnow',
      external_id: r.slug,
      title: r.title,
      company: r.company_name ?? null,
      location: r.remote ? 'Remote' : (r.location || null),
      salary_min: null,
      salary_max: null,
      salary_currency: 'USD',
      description: stripHtml(r.description),
      tags: r.tags ?? [],
      url: r.url,
      posted_at: r.created_at ? new Date(r.created_at * 1000).toISOString() : null,
      match_score: null,
      match_breakdown: null,
      created_at: new Date().toISOString(),
    }))
  } catch {
    return []
  }
}

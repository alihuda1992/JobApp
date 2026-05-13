import type { Job } from '@/types'

const APP_ID = import.meta.env.VITE_ADZUNA_APP_ID as string
const APP_KEY = import.meta.env.VITE_ADZUNA_APP_KEY as string
const BASE = 'https://api.adzuna.com/v1/api/jobs'

export const CATEGORIES: { value: string; label: string }[] = [
  { value: '',                       label: 'Any Industry' },
  { value: 'it-jobs',                label: 'IT & Technology' },
  { value: 'consultancy-jobs',       label: 'Consulting' },
  { value: 'accounting-finance-jobs',label: 'Finance & Accounting' },
  { value: 'marketing-jobs',         label: 'Marketing' },
  { value: 'sales-jobs',             label: 'Sales' },
  { value: 'engineering-jobs',       label: 'Engineering' },
  { value: 'hr-jobs',                label: 'Human Resources' },
  { value: 'legal-jobs',             label: 'Legal' },
  { value: 'healthcare-nursing-jobs',label: 'Healthcare & Nursing' },
  { value: 'creative-design-jobs',   label: 'Creative & Design' },
  { value: 'customer-services-jobs', label: 'Customer Service' },
  { value: 'logistics-warehouse-jobs',label: 'Logistics & Warehouse' },
  { value: 'manufacturing-jobs',     label: 'Manufacturing' },
  { value: 'teaching-jobs',          label: 'Education & Teaching' },
  { value: 'scientific-qa-jobs',     label: 'Science & QA' },
  { value: 'public-sector-jobs',     label: 'Public Sector' },
  { value: 'social-work-jobs',       label: 'Social Work' },
  { value: 'property-jobs',          label: 'Property & Real Estate' },
  { value: 'retail-jobs',            label: 'Retail' },
  { value: 'hospitality-catering-jobs', label: 'Hospitality & Catering' },
  { value: 'trade-construction-jobs',label: 'Trade & Construction' },
  { value: 'energy-oil-gas-jobs',    label: 'Energy & Oil/Gas' },
  { value: 'travel-jobs',            label: 'Travel & Tourism' },
  { value: 'graduate-jobs',          label: 'Graduate' },
]

export const COUNTRIES: { code: string; label: string; currency: string }[] = [
  { code: 'us', label: 'United States', currency: 'USD' },
  { code: 'ca', label: 'Canada',        currency: 'CAD' },
  { code: 'gb', label: 'United Kingdom',currency: 'GBP' },
  { code: 'au', label: 'Australia',     currency: 'AUD' },
  { code: 'de', label: 'Germany',       currency: 'EUR' },
  { code: 'fr', label: 'France',        currency: 'EUR' },
  { code: 'in', label: 'India',         currency: 'INR' },
  { code: 'nl', label: 'Netherlands',   currency: 'EUR' },
  { code: 'sg', label: 'Singapore',     currency: 'SGD' },
  { code: 'nz', label: 'New Zealand',   currency: 'NZD' },
  { code: 'za', label: 'South Africa',  currency: 'ZAR' },
  { code: 'br', label: 'Brazil',        currency: 'BRL' },
  { code: 'mx', label: 'Mexico',        currency: 'MXN' },
  { code: 'it', label: 'Italy',         currency: 'EUR' },
  { code: 'ch', label: 'Switzerland',   currency: 'CHF' },
  { code: 'at', label: 'Austria',       currency: 'EUR' },
  { code: 'be', label: 'Belgium',       currency: 'EUR' },
  { code: 'pl', label: 'Poland',        currency: 'PLN' },
]

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
  country?: string
  category?: string
}): Promise<Job[]> {
  const { query, location, salaryMin, page = 1, country = 'us', category } = params
  const currency = COUNTRIES.find((c) => c.code === country)?.currency ?? 'USD'

  const isRemote = location?.toLowerCase() === 'remote'
  const effectiveQuery = isRemote ? `${query} remote` : query

  const url = new URL(`${BASE}/${country}/search/${page}`)
  url.searchParams.set('app_id', APP_ID)
  url.searchParams.set('app_key', APP_KEY)
  url.searchParams.set('what', effectiveQuery)
  url.searchParams.set('results_per_page', '20')
  if (location && !isRemote) url.searchParams.set('where', location)
  if (salaryMin) url.searchParams.set('salary_min', String(salaryMin))
  if (category) url.searchParams.set('category', category)

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
    salary_currency: currency,
    description: r.description,
    tags: [],
    url: r.redirect_url,
    posted_at: r.created,
    match_score: null,
    match_breakdown: null,
    created_at: new Date().toISOString(),
  }))
}

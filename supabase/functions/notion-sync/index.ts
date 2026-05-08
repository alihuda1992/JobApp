import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const NOTION_API = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

function notionHeaders(token: string) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION,
  }
}

// Extract the 32-char hex ID from a Notion URL or bare UUID and format as hyphenated UUID
function parsePageId(input: string): string {
  // Strip URL prefix if present — the ID is the last path segment (optionally with query)
  const segment = input.split('/').pop()?.split('?')[0] ?? input
  // Strip hyphens then grab last 32 hex chars (handles "Page-Title-abc123..." slugs)
  const hex = segment.replace(/-/g, '').replace(/[^a-f0-9]/gi, '')
  const id = hex.slice(-32)
  if (id.length !== 32) throw new Error(`Could not parse a valid Notion page ID from: ${input}`)
  return `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function buildProperties(app: Record<string, unknown>): Record<string, unknown> {
  const job = (app.job ?? {}) as Record<string, unknown>
  const props: Record<string, unknown> = {
    'Name': { title: [{ text: { content: (job.title as string) ?? 'Unknown' } }] },
    'Company': { rich_text: [{ text: { content: (job.company as string) ?? '' } }] },
    'Location': { rich_text: [{ text: { content: (job.location as string) ?? '' } }] },
    'Status': { select: { name: capitalize((app.status as string) ?? 'saved') } },
    'Source': { select: { name: capitalize((job.source as string) ?? 'manual') } },
    'App ID': { rich_text: [{ text: { content: (app.id as string) ?? '' } }] },
  }
  if (job.match_score !== null && job.match_score !== undefined) {
    props['Match Score'] = { number: job.match_score as number }
  }
  if (job.url) {
    props['Job URL'] = { url: job.url as string }
  }
  if (app.applied_at) {
    props['Applied Date'] = { date: { start: app.applied_at as string } }
  }
  return props
}

async function setup(token: string, parentPageId: string) {
  const pageId = parsePageId(parentPageId)

  const body = {
    parent: { type: 'page_id', page_id: pageId },
    title: [{ type: 'text', text: { content: 'The Job App — Pipeline' } }],
    properties: {
      'Name':        { title: {} },
      'Company':     { rich_text: {} },
      'Location':    { rich_text: {} },
      'Status': {
        select: {
          options: [
            { name: 'Saved',        color: 'gray' },
            { name: 'Applied',      color: 'blue' },
            { name: 'Interviewing', color: 'yellow' },
            { name: 'Offer',        color: 'green' },
            { name: 'Rejected',     color: 'red' },
          ],
        },
      },
      'Match Score': { number: { format: 'number' } },
      'Job URL':     { url: {} },
      'Applied Date':{ date: {} },
      'Source': {
        select: {
          options: [
            { name: 'Adzuna', color: 'orange' },
            { name: 'Manual', color: 'purple' },
          ],
        },
      },
      'App ID':      { rich_text: {} },
    },
  }

  const res = await fetch(`${NOTION_API}/databases`, {
    method: 'POST',
    headers: notionHeaders(token),
    body: JSON.stringify(body),
  })

  if (!res.ok) throw new Error(`Notion setup error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return { db_id: data.id as string }
}

async function upsertOne(token: string, dbId: string, app: Record<string, unknown>) {
  const appId = app.id as string

  // Query for existing page with this App ID
  const queryRes = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
    method: 'POST',
    headers: notionHeaders(token),
    body: JSON.stringify({
      filter: { property: 'App ID', rich_text: { equals: appId } },
      page_size: 1,
    }),
  })
  if (!queryRes.ok) throw new Error(`Notion query error ${queryRes.status}: ${await queryRes.text()}`)
  const queryData = await queryRes.json()
  const existing = queryData.results?.[0]

  const properties = buildProperties(app)

  if (existing) {
    const patchRes = await fetch(`${NOTION_API}/pages/${existing.id}`, {
      method: 'PATCH',
      headers: notionHeaders(token),
      body: JSON.stringify({ properties }),
    })
    if (!patchRes.ok) throw new Error(`Notion patch error ${patchRes.status}: ${await patchRes.text()}`)
  } else {
    const postRes = await fetch(`${NOTION_API}/pages`, {
      method: 'POST',
      headers: notionHeaders(token),
      body: JSON.stringify({ parent: { database_id: dbId }, properties }),
    })
    if (!postRes.ok) throw new Error(`Notion create error ${postRes.status}: ${await postRes.text()}`)
  }

  return { ok: true }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const { action, notion_token } = body

    if (!notion_token) {
      return new Response(JSON.stringify({ error: 'notion_token is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let result: unknown

    if (action === 'setup') {
      const { parent_page_id } = body
      if (!parent_page_id) throw new Error('parent_page_id is required')
      result = await setup(notion_token, parent_page_id)

    } else if (action === 'upsert') {
      const { notion_db_id, application } = body
      if (!notion_db_id || !application) throw new Error('notion_db_id and application are required')
      result = await upsertOne(notion_token, notion_db_id, application)

    } else if (action === 'sync_all') {
      const { notion_db_id, applications } = body
      if (!notion_db_id || !Array.isArray(applications)) throw new Error('notion_db_id and applications are required')
      let synced = 0
      for (const app of applications) {
        await upsertOne(notion_token, notion_db_id, app)
        synced++
      }
      result = { synced }

    } else {
      return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`

const SYSTEM_PROMPT = `You are a job listing parser. Extract structured job details from webpage text.

Return ONLY valid JSON:
{
  "title": "<job title>",
  "company": "<company name or null>",
  "location": "<location string or null>",
  "salary_min": <integer annual USD or null>,
  "salary_max": <integer annual USD or null>,
  "description": "<full job description text, cleaned up, preserving sections like Responsibilities/Requirements>"
}

Rules:
- title: the exact job title as listed
- company: the hiring company name (not a recruiter/agency unless it's their own role)
- location: city, state, country, or "Remote" — as stated
- salary_min/salary_max: annual USD integers. Convert hourly × 2080. Convert "100k" → 100000. null if not mentioned
- description: the full job description. Remove navigation menus, headers/footers, cookie banners, and unrelated site content. Keep all requirements, responsibilities, and qualifications intact.
- Return only the JSON object, no markdown`

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim()
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { url } = await req.json()
    if (!url?.trim()) {
      return new Response(JSON.stringify({ error: 'url is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let html: string
    try {
      const pageRes = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; JobAppBot/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(10000),
      })
      if (!pageRes.ok) throw new Error(`Page returned ${pageRes.status}`)
      html = await pageRes.text()
    } catch (err) {
      return new Response(JSON.stringify({ error: `Could not fetch URL: ${String(err)}` }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const pageText = stripHtml(html).slice(0, 20000)

    const geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: pageText }] }],
        generationConfig: { temperature: 0 },
      }),
    })

    if (!geminiRes.ok) throw new Error(`Gemini error ${geminiRes.status}: ${await geminiRes.text()}`)
    const json = await geminiRes.json()
    const raw = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim()
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
    const result = JSON.parse(cleaned)

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

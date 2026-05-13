import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`

async function callGemini(rawText: string): Promise<unknown> {
  const prompt = `You are a resume parser. Extract structured data from the resume below and return ONLY valid JSON with no explanation, no markdown, no code fences.

Critical rules:
- Include EVERY work experience entry present in the resume — do not skip, merge, or omit any role, even if dates overlap or the role seems minor.
- Include EVERY education entry.
- If a field is missing or unclear, use an empty string, not null (except end_date which may be null for current roles).
- bullets: extract all bullet points or responsibilities listed for each role. If none are listed, use an empty array.

Required JSON schema:
{
  "summary": "string (use existing summary/objective if present, otherwise synthesise one sentence from the experience)",
  "experience": [{"title":"string","company":"string","location":"string","start_date":"string","end_date":"string or null","bullets":["string"]}],
  "education": [{"degree":"string","institution":"string","field":"string","graduation_year":"string"}],
  "skills": ["string"],
  "certifications": ["string"]
}

RESUME:
${rawText}`

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0 },
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini API error ${res.status}: ${err}`)
  }
  const json = await res.json()
  const content = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim()
  const cleaned = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
  return JSON.parse(cleaned)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { raw_text } = await req.json()
    if (!raw_text) {
      return new Response(JSON.stringify({ error: 'raw_text is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let parsed: unknown
    try {
      parsed = await callGemini(raw_text)
    } catch (e1) {
      try {
        parsed = await callGemini(raw_text)

      } catch (e2) {
        return new Response(JSON.stringify({ error: 'parse_failed', detail: String(e2), first: String(e1) }), {
          status: 422,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    return new Response(JSON.stringify({ parsed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

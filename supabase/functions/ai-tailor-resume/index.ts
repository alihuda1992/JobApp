import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`

const SYSTEM_PROMPT = `You are a resume optimization expert. Tailor the provided resume JSON for a specific job description.

Rules:
1. NEVER change factual data: company names, job titles held, employment dates, institution names, degrees, graduation years.
2. DO rewrite the summary to position the candidate specifically for this role.
3. DO rephrase experience bullets to highlight the most relevant achievements and naturally incorporate keywords from the job description.
4. DO reorder the skills array so the most relevant skills appear first.
5. Keep certifications unchanged.
6. Return the EXACT same JSON schema as the input resume — same fields, same structure.

Return ONLY valid JSON. No markdown fences, no explanation, no preamble.`

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { resume_parsed, job_description } = await req.json()
    if (!resume_parsed || !job_description) {
      return new Response(JSON.stringify({ error: 'resume_parsed and job_description are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const text = `RESUME:\n${JSON.stringify(resume_parsed, null, 2)}\n\nJOB DESCRIPTION:\n${job_description}\n\nReturn the tailored resume JSON now.`

    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { temperature: 0.3 },
      }),
    })

    if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`)
    const json = await res.json()
    const raw = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim()
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
    const tailored = JSON.parse(cleaned)

    return new Response(JSON.stringify({ tailored }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

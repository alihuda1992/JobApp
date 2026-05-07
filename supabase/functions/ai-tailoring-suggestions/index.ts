import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`

const SYSTEM_PROMPT = `You are a career coach reviewing a candidate's resume against a job description. Identify 2-5 specific, actionable gaps or improvements the candidate should address. Return ONLY valid JSON: { "suggestions": ["string", ...] }. Each suggestion must be concrete and specific to this job — no generic advice. Return only the JSON object.`

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { resume_parsed, job_description } = await req.json()
    if (!resume_parsed || !job_description) {
      return new Response(JSON.stringify({ error: 'resume_parsed and job_description are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const text = `RESUME:\n${JSON.stringify(resume_parsed, null, 2)}\n\nJOB DESCRIPTION:\n${job_description}`

    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
      }),
    })

    if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`)
    const json = await res.json()
    const content = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const result = JSON.parse(content.trim())

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

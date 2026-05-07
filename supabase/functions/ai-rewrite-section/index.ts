import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { section_text, job_description, section_type } = await req.json()
    if (!section_text || !section_type) {
      return new Response(JSON.stringify({ error: 'section_text and section_type are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const jobContext = job_description ? `\n\nTailor this rewrite toward the following job description:\n${job_description}` : ''
    const systemPrompt = `You are a professional resume writer. Rewrite the provided resume ${section_type} section to be stronger, more impactful, and results-oriented. Use action verbs. Quantify achievements where possible. Keep the same factual content.${jobContext} Return only the rewritten text — no explanation, no preamble.`

    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: section_text }] }],
        generationConfig: { temperature: 0.5 },
      }),
    })

    if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`)
    const json = await res.json()
    const rewritten = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

    return new Response(JSON.stringify({ rewritten }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

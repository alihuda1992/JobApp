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
2. NEVER remove, merge, or reorder experience entries. The output experience array MUST contain EXACTLY the same number of entries in the EXACT same order as the input.
3. DO rewrite the summary to position the candidate specifically for this role.
4. DO rephrase bullet points within each experience entry to highlight relevant achievements and incorporate keywords from the job description. Keep the same number of bullets per entry.
5. DO reorder the skills array so the most relevant skills appear first.
6. Keep education and certifications unchanged.
7. Return the EXACT same JSON schema as the input resume — same fields, same structure, same number of entries in every array.

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

    // Ensure no experience entries were dropped — merge back any missing ones
    if (Array.isArray(resume_parsed.experience) && Array.isArray(tailored.experience)) {
      if (tailored.experience.length < resume_parsed.experience.length) {
        const merged = resume_parsed.experience.map((orig: Record<string, unknown>, i: number) => {
          const ai = tailored.experience[i]
          if (!ai) return orig
          // Keep factual fields from original; take only bullets from AI
          return { ...orig, bullets: Array.isArray(ai.bullets) ? ai.bullets : orig.bullets }
        })
        tailored.experience = merged
      }
    }

    return new Response(JSON.stringify({ tailored }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

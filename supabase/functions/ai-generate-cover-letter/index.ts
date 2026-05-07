import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`

const LENGTH_WORDS: Record<string, string> = {
  short: '~150 words', medium: '~300 words', long: '~450 words',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { resume_parsed, job_description, tone = 'professional', length = 'medium', job_id } = await req.json()
    if (!resume_parsed || !job_description) {
      return new Response(JSON.stringify({ error: 'resume_parsed and job_description are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const wordTarget = LENGTH_WORDS[length] || '~300 words'
    const systemPrompt = `You are a professional cover letter writer. Write a ${tone} cover letter of ${wordTarget}. Use plain text only — no markdown, no headers, no bullet points. Write in first person. Do not start with "I". Be specific and reference the job requirements directly.`
    const text = `CANDIDATE RESUME:\n${JSON.stringify(resume_parsed, null, 2)}\n\nJOB DESCRIPTION:\n${job_description}\n\nWrite the cover letter now.`

    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { temperature: 0.7 },
      }),
    })

    if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`)
    const json = await res.json()
    const content = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

    const authHeader = req.headers.get('Authorization')
    if (job_id && authHeader) {
      const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
      const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
      if (user) {
        await supabase.from('generated_docs').insert({ user_id: user.id, job_id, type: 'cover_letter', content, tone, length })
      }
    }

    return new Response(JSON.stringify({ content }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

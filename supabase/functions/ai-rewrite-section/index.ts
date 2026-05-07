import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Anthropic from 'npm:@anthropic-ai/sdk'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { section_text, job_description, section_type } = await req.json()

    if (!section_text || !section_type) {
      return new Response(JSON.stringify({ error: 'section_text and section_type are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const jobContext = job_description
      ? `\n\nTailor this rewrite toward the following job description:\n${job_description}`
      : ''

    const systemPrompt = `You are a professional resume writer. Rewrite the provided resume ${section_type} section to be stronger, more impactful, and results-oriented. Use action verbs. Quantify achievements where possible. Keep the same factual content.${jobContext}
Return only the rewritten text — no explanation, no preamble.`

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      temperature: 0.5,
      system: systemPrompt,
      messages: [{ role: 'user', content: section_text }],
    })

    const rewritten = message.content[0].type === 'text' ? message.content[0].text : ''

    return new Response(JSON.stringify({ rewritten }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

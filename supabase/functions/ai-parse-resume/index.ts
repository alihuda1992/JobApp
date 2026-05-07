import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Anthropic from 'npm:@anthropic-ai/sdk'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })

const SYSTEM_PROMPT = `You are a resume parser. Extract structured data from the provided resume text and return ONLY valid JSON matching this exact schema:
{
  "summary": "string",
  "experience": [{"title":"string","company":"string","location":"string","start_date":"string","end_date":"string|null","bullets":["string"]}],
  "education": [{"degree":"string","institution":"string","field":"string","graduation_year":"string"}],
  "skills": ["string"],
  "certifications": ["string"]
}
Return only the JSON object. No explanation, no markdown, no code fences.`

async function parseResume(rawText: string): Promise<unknown> {
  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 2048,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: rawText }],
  })
  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  return JSON.parse(text.trim())
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
      parsed = await parseResume(raw_text)
    } catch {
      // Retry once
      try {
        parsed = await parseResume(raw_text)
      } catch {
        return new Response(JSON.stringify({ error: 'parse_failed' }), {
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

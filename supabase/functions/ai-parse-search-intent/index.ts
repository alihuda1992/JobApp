import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`

const CATEGORIES = [
  'it-jobs', 'consultancy-jobs', 'accounting-finance-jobs', 'marketing-jobs',
  'sales-jobs', 'engineering-jobs', 'hr-jobs', 'legal-jobs',
  'healthcare-nursing-jobs', 'creative-design-jobs', 'customer-services-jobs',
  'logistics-warehouse-jobs', 'manufacturing-jobs', 'teaching-jobs',
  'scientific-qa-jobs', 'public-sector-jobs', 'social-work-jobs',
  'property-jobs', 'retail-jobs', 'hospitality-catering-jobs',
  'trade-construction-jobs', 'energy-oil-gas-jobs', 'travel-jobs', 'graduate-jobs',
]

const SYSTEM_PROMPT = `You are a job search assistant. Extract structured search parameters from a natural language job description.

Return ONLY valid JSON with these fields:
{
  "query": "<concise job title / keyword string for a job board search, e.g. 'senior product manager'>",
  "location": "<city name, 'Remote', or null if not mentioned>",
  "salary_min": <integer annual USD salary or null if not mentioned>,
  "country": "<ISO 2-letter country code, default 'us' if not mentioned — infer from location if possible>",
  "category": "<one of the valid category tags below, or null if none fits>"
}

Valid category tags:
${CATEGORIES.join(', ')}

Rules:
- query: distil the role/skills into 2-5 words, no filler like "looking for" or "want"
- location: if the user says remote/work from home/WFH → "Remote"; if a city → that city; if unspecified → null
- salary_min: annual USD only; convert "100k" → 100000; if not mentioned → null
- country: infer from city (London → gb, Berlin → de, Toronto → ca); default us
- category: map industry/domain to the closest tag. Examples: consulting/strategy → consultancy-jobs, software/engineering/dev → it-jobs, finance/banking → accounting-finance-jobs, doctor/nurse → healthcare-nursing-jobs. If ambiguous or not listed → null
- Return only the JSON object, no explanation or markdown`

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { description } = await req.json()
    if (!description?.trim()) {
      return new Response(JSON.stringify({ error: 'description is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: description }] }],
        generationConfig: { temperature: 0 },
      }),
    })

    if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`)
    const json = await res.json()
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

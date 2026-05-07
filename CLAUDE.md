# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # start dev server (localhost:5173/JobApp/)
npm run build        # production build to dist/
npm run lint         # ESLint
```

Run a single Supabase Edge Function locally:
```bash
supabase functions serve ai-parse-resume --env-file .env.local
```

Deploy edge functions:
```bash
supabase functions deploy ai-parse-resume
supabase secrets set ANTHROPIC_API_KEY=...
```

## Architecture

**Frontend**: React 19 + Vite + TypeScript, deployed to GitHub Pages at `https://alihuda1992.github.io/JobApp/`. Vite base is `/JobApp/`. SPA routing uses the `public/404.html` sessionStorage redirect trick.

**Backend**: Supabase — Postgres (with RLS), Auth (email+password), Storage (resumes bucket), and Edge Functions (Deno/TypeScript in `supabase/functions/`).

**AI**: All Claude API calls are proxied through Edge Functions (key never in client). Haiku (`claude-haiku-4-5`) for parsing/scoring, Sonnet (`claude-sonnet-4-6`) for generation.

**State**: Zustand store in `src/store/useAppStore.ts` holds `{ profile, applications, jobs }`. Auth state lives in `useAuth` hook (`src/hooks/useAuth.ts`).

## Key Data Flow

1. **Auth** → `useAuth` detects login → checks `profiles.onboarding_complete` → routes to `/onboarding` or `/`
2. **Resume upload** → client extracts text (pdfjs/mammoth) → `ai-parse-resume` edge fn → stored in `resumes.parsed`
3. **Job search** → Adzuna API called client-side → results held in Zustand → `ai-score-job` called lazily in batches of 3
4. **Pipeline** → `applications` table with real-time Supabase subscription → Zustand store updated on INSERT/UPDATE/DELETE

## Database

Schema lives in `supabase/migrations/001_initial_schema.sql`. Tables: `profiles`, `resumes`, `jobs`, `applications`, `generated_docs`. RLS enabled on all tables — users can only access their own rows.

## Edge Functions

| Function | Model | Temp | Purpose |
|---|---|---|---|
| `ai-parse-resume` | Haiku | 0 | Extract structured JSON from resume text |
| `ai-score-job` | Haiku | 0 | Score resume vs JD (0–100 + breakdown) |
| `ai-tailoring-suggestions` | Haiku | 0.3 | 2–5 gap suggestions between resume and JD |
| `ai-generate-cover-letter` | Sonnet | 0.7 | Draft cover letter; saves to `generated_docs` |
| `ai-rewrite-section` | Sonnet | 0.5 | Rewrite a resume section, optionally targeting a JD |

## Design System

CSS custom properties in `src/styles/globals.css`. Key tokens:
- Background: `#0e0f11`, Text: `#f2f0ea`
- Accent (cobalt): `var(--color-accent)`, Secondary (amber): `var(--color-secondary)`
- Match score: green ≥ 90, amber 70–89, gray < 70
- AI indicator glyph: ✦
- Fonts: DM Sans (UI), Instrument Serif (headings), DM Mono (numbers)

## Environment Variables

Copy `.env.example` → `.env.local`. Never commit `.env.local`.
GitHub Actions reads from repo Secrets (Settings → Secrets and variables → Actions).

## Sprint Status

- Sprint 0 (scaffolding): ✅ complete
- Sprint 1 (auth + onboarding): ✅ complete
- Sprint 2 (edge functions): ✅ stubs complete — need `ANTHROPIC_API_KEY` wired in Supabase
- Sprint 3 (job search UI): pending
- Sprint 4 (kanban pipeline): pending
- Sprint 5 (resume editor + cover letter): pending
- Sprint 6 (polish): pending

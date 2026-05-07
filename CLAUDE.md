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
supabase functions deploy <function-name>
# GEMINI_API_KEY is the only secret needed — already set on the project
```

## Architecture

**Frontend**: React 19 + Vite + TypeScript, deployed to GitHub Pages at `https://alihuda1992.github.io/JobApp/`. App display name is "The Job App". Vite base is `/JobApp/`. SPA routing uses the `public/404.html` sessionStorage redirect trick.

**Backend**: Supabase — Postgres (with RLS), Auth (email+password), Storage (resumes bucket), and Edge Functions (Deno/TypeScript in `supabase/functions/`).

**AI**: All AI calls go through Edge Functions (key never in client). All functions use **Gemini 2.5 Flash** via the Gemini API (`GEMINI_API_KEY` secret on Supabase).

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
| `ai-tailor-resume` | Gemini 2.5 Flash | 0.3 | Full resume tailored to a specific JD; returns modified ResumeJSON |

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
- Sprint 2 (edge functions): ✅ complete — all 6 functions on Gemini 2.5 Flash
- Sprint 3 (job search UI): ✅ complete — Adzuna search, paste JD, AI scoring, resume-based search chips
- Sprint 4 (kanban pipeline): ✅ complete — drag-and-drop board, real-time subscription, delete, auto-scoring
- Sprint 5 (resume editor + cover letter): ✅ complete — resume editor with AI rewrite per section, cover letter generator, tailored resume generator
- Sprint 6 (polish): 🔜 next — see below

## Sprint 6 Scope (next session)

Priority order:

1. **Settings page** — `src/pages/Settings.tsx` is a stub. Should let users update their profile (name, target titles, preferred locations, seniority, min salary, company size prefs) — same fields as onboarding. Read from `profiles` table, save with upsert.

2. **Error boundaries** — Wrap the app in a React error boundary so uncaught render errors show a friendly message instead of a blank screen. Add a simple `ErrorBoundary` class component in `src/components/`.

3. **Empty states** — Pipeline with 0 applications should prompt to search. Search with no results should suggest using the resume chips. Resume page with no upload should be more inviting.

4. **Mobile polish** — The app has basic mobile support (bottom tab bar on ≤768px) but pages haven't been tested at small widths. Pipeline kanban scrolls horizontally which is fine; other pages may need padding/font-size tweaks.

5. **Stale resume deduplication** — When a user re-uploads a resume, old rows are marked `is_active: false` but never cleaned up. Not urgent, low priority.

### Pages still as stubs
- `src/pages/Settings.tsx` — only meaningful stub remaining

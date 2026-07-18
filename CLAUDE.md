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

Build the MCP server (after changing `mcp-server/src/`):
```bash
cd mcp-server && npm run build
```

## Architecture

**Frontend**: React 19 + Vite + TypeScript, deployed to GitHub Pages at `https://alihuda1992.github.io/JobApp/`. App display name is "The Job App". Vite base is `/JobApp/`. SPA routing uses the `public/404.html` sessionStorage redirect trick.

**Backend**: Supabase — Postgres (with RLS), Auth (email+password), Storage (resumes bucket), and Edge Functions (Deno/TypeScript in `supabase/functions/`).

**AI**: All AI calls go through Edge Functions (key never in client). All functions use **Gemini 2.5 Flash** via the Gemini API (`GEMINI_API_KEY` secret on Supabase).

**State**: Zustand store in `src/store/useAppStore.ts` holds `{ profile, applications, jobs }`. Auth state lives in `useAuth` hook (`src/hooks/useAuth.ts`).

**MCP server**: `mcp-server/` is a local stdio MCP server (TypeScript, `@modelcontextprotocol/sdk`) that lets Claude Code / Claude Desktop read and write the app's data directly through Supabase. It signs in with user credentials from `mcp-server/.env` (gitignored — copy `.env.example`), so RLS applies normally. Auto-registered for Claude Code via `.mcp.json` at the repo root. 14 tools: reads (`get_pipeline`, `list_jobs`, `get_job`, `get_active_resume`), writes (`add_job`, `create_application`, `update_application`, `delete_application`), free saves where Claude does the AI work in-session (`save_job_score`, `save_cover_letter`), and Gemini-backed edge-function wrappers (`score_job`, `get_tailoring_suggestions`, `tailor_resume`, `generate_cover_letter`). Because the app subscribes to Supabase Realtime, MCP writes appear in the open app instantly. See `mcp-server/README.md` and `ARCHITECTURE.md`.

**Keep-alive**: `.github/workflows/keep-alive.yml` pings the database every 3 days (prevents Supabase free-tier auto-pause) and pushes an empty heartbeat commit if the repo has had no commits for 45+ days (prevents GitHub's 60-day scheduled-workflow suspension). Failures email the repo owner.

## Key Data Flow

1. **Auth** → `useAuth` detects login → checks `profiles.onboarding_complete` → routes to `/onboarding` or `/`
2. **Resume upload** → client extracts text (pdfjs/mammoth) → `ai-parse-resume` edge fn → stored in `resumes.parsed`
3. **Job search** → Adzuna called client-side → results held in Zustand → `ai-score-job` called lazily in batches of 3
4. **Pipeline** → `applications` table with real-time Supabase subscription → Zustand store updated on INSERT/UPDATE/DELETE

## Database

Schema lives in `supabase/migrations/001_initial_schema.sql`. Tables: `profiles`, `resumes`, `jobs`, `applications`, `generated_docs`. RLS enabled on all tables — users can only access their own rows.

## Edge Functions

All functions use **Gemini 2.5 Flash** except `notion-sync`.

| Function | Temp | Purpose |
|---|---|---|
| `ai-parse-resume` | 0 | Extract structured JSON from resume text |
| `ai-score-job` | 0 | Score resume vs JD (0–100 + breakdown) |
| `ai-parse-search-intent` | 0 | Parse natural-language search into structured query params |
| `ai-fetch-job-url` | 0 | Fetch & parse a job listing from a URL (SSRF-guarded: blocks private IPs & non-HTTP/S) |
| `ai-tailoring-suggestions` | 0.3 | 2–5 gap suggestions between resume and JD |
| `ai-tailor-resume` | 0.3 | Full resume tailored to a specific JD; returns modified ResumeJSON |
| `ai-rewrite-section` | 0.5 | Rewrite a resume section, optionally targeting a JD |
| `ai-generate-cover-letter` | 0.7 | Draft cover letter; saves to `generated_docs` |
| `notion-sync` | — | Sync application data to Notion (no AI) |

## Key Components

- `src/components/auth/AuthLayout.tsx` — shared split-panel wrapper used by Login and Signup (dark form left, full-height image right, hides image on mobile ≤768px)

## Design System

CSS custom properties in `src/index.css`. Key tokens:
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

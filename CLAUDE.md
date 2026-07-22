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

**MCP server**: `mcp-server/` is a local stdio MCP server (TypeScript, `@modelcontextprotocol/sdk`) that lets Claude Code / Claude Desktop read and write the app's data directly through Supabase. It signs in with user credentials from `mcp-server/.env` (gitignored — copy `.env.example`), so RLS applies normally. Auto-registered for Claude Code via `.mcp.json` at the repo root. 17 tools: reads (`get_pipeline`, `list_jobs`, `get_job`, `get_active_resume`), writes (`add_job`, `create_application`, `update_application`, `delete_application`), inbox reconciliation (`reconcile_inbox` — Claude scans Gmail in-session via the Gmail connector and extracts structured evidence; the tool matches it to pipeline applications by company/role and applies forward-only status fixes with an audit note, flagging unmatched emails as missed applications for user approval), free saves where Claude does the AI work in-session (`save_job_score`, `save_cover_letter`), local file tools (`save_tailored_resume`, `list_tailored_resumes` — park resume files in the gitignored `tailored-resumes/` folder at the repo root; used by the claude.ai `tailor-resume` skill to persist its sandbox-built `.docx`/`.pdf` onto the local machine), and Gemini-backed edge-function wrappers (`score_job`, `get_tailoring_suggestions`, `tailor_resume`, `generate_cover_letter`). Because the app subscribes to Supabase Realtime, MCP writes appear in the open app instantly. See `mcp-server/README.md` and `ARCHITECTURE.md`.

**Keep-alive**: `.github/workflows/keep-alive.yml` pings the database every 3 days (prevents Supabase free-tier auto-pause) and pushes an empty heartbeat commit if the repo has had no commits for 45+ days (prevents GitHub's 60-day scheduled-workflow suspension). Failures email the repo owner.

## Activity Feed, Auto-Archive & Needs Review

**Activity feed**: a DB trigger on `applications` (migration 003) logs every insert / status change / archive / note / next-step change / delete into `activity_log`, including who did it. Writers stamp `applications.last_actor` on every write (`'user'` = app pages, `'claude'` = MCP server, `'system'` = auto-archive sweep) and the trigger copies it into the log. Deletes stamp `last_actor` in a separate update first (actor-only updates log nothing). MCP writes that don't touch `applications` (`save_job_score`, `score_job`, `save_cover_letter`, `generate_cover_letter`) insert `activity_log` rows directly via `logActivity()`. The Activity page (`src/pages/Activity.tsx`, route `/activity`) lists the feed with "new since last visit" highlighting; the sidebar badge counts unseen non-user entries against `profiles.last_seen_activity_at` (marked read when the page is opened) and updates live via a Realtime subscription on `activity_log`.

**Auto-archive**: `applications.archived_at` hides cards from the board. On Pipeline load the client archives terminal cards (`rejected`/`closed`) whose `updated_at` is 30+ days old (`ARCHIVE_AFTER_DAYS` in `Pipeline.tsx`) with `last_actor: 'system'`, so archives show up in the activity feed. The Pipeline header has an "Archived (n)" toggle with restore/delete. MCP `get_pipeline` excludes archived rows unless `include_archived: true`; `update_application` accepts an `archived` boolean. `reconcile_inbox` deliberately still matches archived applications — otherwise their emails would surface as "missed applications".

**Needs Review** (migration 004): `applications.needs_review` is the human-in-the-loop gate for anything the MCP server infers rather than something the user explicitly confirmed in-conversation — chiefly `reconcile_inbox`'s `unmatched` results. Cards with `needs_review = true` are excluded from the live board (client-side filter in `Pipeline.tsx`, and `get_pipeline` excludes them unless `include_review: true`) and instead surface in the Pipeline header's "Needs Review (n)" panel, where the user Approves (`needs_review → false`) or Dismisses (deletes). `add_job` and `create_application` both take a `needs_review` param (default `false`) — their tool descriptions instruct Claude to set it `true` for anything inferred, and to *always* set it `true` for `reconcile_inbox` unmatched-entry adds when running unattended with no user to actually ask. This exists because an earlier unattended reconcile run added two placeholder-titled cards ("Role TBD (LinkedIn application)" / Sud Recruiting, "Role not stated in confirmation email" / Deloitte) straight to the live board — the tool description alone ("confirm with the user") wasn't a real gate for a session with no user present, so the gate is now structural.

## Key Data Flow

1. **Auth** → `useAuth` detects login → checks `profiles.onboarding_complete` → routes to `/onboarding` or `/`
2. **Resume upload** → client extracts text (pdfjs/mammoth) → `ai-parse-resume` edge fn → stored in `resumes.parsed`
3. **Job search** → Adzuna called client-side → results held in Zustand → `ai-score-job` called lazily in batches of 3
4. **Pipeline** → `applications` table with real-time Supabase subscription → Zustand store updated on INSERT/UPDATE/DELETE

## Database

Schema lives in `supabase/migrations/001_initial_schema.sql`. Tables: `profiles`, `resumes`, `jobs`, `applications`, `generated_docs`, `activity_log` (003). RLS enabled on all tables — users can only access their own rows. Migrations are applied manually via the Supabase SQL editor (no CLI link).

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

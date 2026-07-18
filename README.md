# The Job App

**https://alihuda1992.github.io/JobApp/**

AI-powered job search and application tracker — search jobs, score them against your resume, track applications on a kanban pipeline, and generate tailored resumes and cover letters.

**Stack**: React 19 + Vite + TypeScript frontend (GitHub Pages) · Supabase backend (Postgres + RLS, Auth, Storage, Realtime, Edge Functions) · Gemini 2.5 Flash for in-app AI features.

**Claude integration**: [`mcp-server/`](mcp-server/) is a Model Context Protocol server that lets Claude (Claude Code or Claude Desktop) read and update the app conversationally — add jobs, move pipeline stages, score matches, draft cover letters, park tailored resumes locally — with changes appearing live in the open app. See [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit together.

## Development

```bash
npm install
npm run dev        # localhost:5173/JobApp/
```

Copy `.env.example` → `.env.local` for Supabase and Adzuna keys. Deploys to GitHub Pages automatically on push to `main`.

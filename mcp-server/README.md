# JobApp MCP Server

A local stdio MCP server that lets Claude (Claude Code / Claude Desktop) read and update **The Job App** directly through Supabase. Because the app subscribes to Supabase in real time, changes made through these tools appear instantly in the open app.

## Tools

**Read**
- `get_pipeline` — kanban applications grouped by status, with job details
- `list_jobs` / `get_job` — saved jobs (search by title/company)
- `get_active_resume` — the parsed active resume JSON

**Write**
- `add_job` — add a manual job; optionally auto-creates a `saved` application
- `create_application` / `update_application` / `delete_application` — manage the pipeline (move stages, notes, next steps)

**Save (free — Claude does the AI work in-session, these just persist it)**
- `save_job_score` — save a score + breakdown Claude computed itself onto a job
- `save_cover_letter` — save a cover letter Claude wrote itself to `generated_docs`

**Local files (`tailored-resumes/` at the repo root, gitignored)**
- `save_tailored_resume` — park a base64-encoded `.docx`/`.pdf` resume built in-session (e.g. by the
  claude.ai `tailor-resume` skill) into `tailored-resumes/`, named `Huda_Aliraza_<Company>_<Role>.<ext>`;
  optionally appends a note to the job's pipeline application. This is the bridge that lets Claude
  Desktop's sandboxed skills persist files onto the local machine.
- `list_tailored_resumes` — list parked resume files, newest first

**AI (via Supabase Edge Functions — each call spends a Gemini request)**
- `score_job` — score resume vs job, saved back onto the job
- `get_tailoring_suggestions` — gap suggestions for a job
- `tailor_resume` — tailored resume JSON for a job
- `generate_cover_letter` — drafts and saves a cover letter to `generated_docs`

When driving the app through Claude (Code/Desktop), prefer the save tools: Claude reads the resume and job via the read tools, does the scoring/writing itself on your Claude plan, and persists results — no Gemini spend. The edge-function tools remain for parity with the app's own behavior.

## Setup

```bash
cd mcp-server
npm install
npm run build
cp .env.example .env   # then fill in JOBAPP_EMAIL / JOBAPP_PASSWORD
```

`SUPABASE_URL` / `SUPABASE_ANON_KEY` are picked up automatically from the repo's `.env.local` (`VITE_` vars) if not set in `.env`.

## Registering with Claude

Claude Code picks the server up automatically from the repo's `.mcp.json`. To register it globally instead:

```bash
claude mcp add jobapp -- node "/path/to/JobApp/mcp-server/dist/index.js"
```

For Claude Desktop, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jobapp": {
      "command": "node",
      "args": ["/path/to/JobApp/mcp-server/dist/index.js"]
    }
  }
}
```

## Auth model

The server signs in to Supabase Auth with your app credentials from `.env` and uses the resulting user JWT for all queries and edge-function calls — so row-level security applies exactly as it does in the app. No service-role key is used.

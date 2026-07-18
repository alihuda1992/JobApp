#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { callEdgeFunction, getClient, getUserId } from "./supabase.js";

const APPLICATION_STATUSES = ["saved", "applied", "interviewing", "offer", "closed", "rejected"] as const;

const server = new McpServer({ name: "jobapp", version: "0.1.0" });

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function wrap<A>(fn: (args: A) => Promise<ToolResult>): (args: A) => Promise<ToolResult> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      return { content: [{ type: "text", text: String(err instanceof Error ? err.message : err) }], isError: true };
    }
  };
}

async function fetchJob(jobId: string) {
  const supa = await getClient();
  const { data, error } = await supa.from("jobs").select("*").eq("id", jobId).single();
  if (error) throw new Error(`Job ${jobId} not found: ${error.message}`);
  return data;
}

async function fetchActiveResume() {
  const supa = await getClient();
  const { data, error } = await supa
    .from("resumes")
    .select("id, file_name, parsed, created_at")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  if (!data?.length || !data[0].parsed) {
    throw new Error("No active parsed resume found. Upload a resume in the app first.");
  }
  return data[0];
}

// ---------- Read tools ----------

server.registerTool(
  "get_pipeline",
  {
    title: "Get application pipeline",
    description:
      "List all applications in the kanban pipeline with their job details, grouped by status (saved, applied, interviewing, offer, closed, rejected).",
    inputSchema: {},
  },
  wrap(async () => {
    const supa = await getClient();
    const { data, error } = await supa
      .from("applications")
      .select("id, status, applied_at, notes, next_step, updated_at, jobs(id, title, company, location, match_score, url)")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    const grouped: Record<string, unknown[]> = {};
    for (const status of APPLICATION_STATUSES) grouped[status] = [];
    for (const app of data ?? []) (grouped[app.status] ??= []).push(app);
    return ok(grouped);
  })
);

server.registerTool(
  "list_jobs",
  {
    title: "List saved jobs",
    description:
      "List jobs saved in the app, newest first. Optionally filter by a search term matched against title and company. Returns job ids needed by other tools.",
    inputSchema: {
      query: z.string().optional().describe("Case-insensitive term matched against job title and company"),
      limit: z.number().int().min(1).max(100).default(25),
    },
  },
  wrap(async ({ query, limit }) => {
    const supa = await getClient();
    let q = supa
      .from("jobs")
      .select("id, title, company, location, source, salary_min, salary_max, match_score, url, posted_at, created_at")
      .order("created_at", { ascending: false })
      .limit(limit ?? 25);
    if (query) q = q.or(`title.ilike.%${query}%,company.ilike.%${query}%`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return ok(data);
  })
);

server.registerTool(
  "get_job",
  {
    title: "Get job details",
    description: "Fetch one saved job by id, including its full description and match breakdown.",
    inputSchema: { job_id: z.string().uuid() },
  },
  wrap(async ({ job_id }) => ok(await fetchJob(job_id)))
);

server.registerTool(
  "get_active_resume",
  {
    title: "Get active resume",
    description: "Return the user's active resume as structured JSON (the AI-parsed version used for scoring and tailoring).",
    inputSchema: {},
  },
  wrap(async () => ok(await fetchActiveResume()))
);

// ---------- Write tools ----------

server.registerTool(
  "add_job",
  {
    title: "Add a job manually",
    description:
      "Add a job to the app (source: manual). By default also creates a pipeline application in 'saved' status so it appears on the kanban board immediately.",
    inputSchema: {
      title: z.string().min(1),
      company: z.string().optional(),
      location: z.string().optional(),
      description: z.string().optional().describe("Full job description text — required later for AI scoring/tailoring"),
      url: z.string().url().optional(),
      salary_min: z.number().int().optional(),
      salary_max: z.number().int().optional(),
      tags: z.array(z.string()).optional(),
      save_to_pipeline: z.boolean().default(true).describe("Also create a 'saved' application for the kanban board"),
    },
  },
  wrap(async ({ save_to_pipeline, ...job }) => {
    const supa = await getClient();
    const userId = await getUserId();
    const { data: inserted, error } = await supa
      .from("jobs")
      .insert({ ...job, user_id: userId, source: "manual" })
      .select()
      .single();
    if (error) throw new Error(error.message);

    let application = null;
    if (save_to_pipeline !== false) {
      const { data: app, error: appErr } = await supa
        .from("applications")
        .insert({ user_id: userId, job_id: inserted.id, status: "saved" })
        .select()
        .single();
      if (appErr) throw new Error(`Job created but application failed: ${appErr.message}`);
      application = app;
    }
    return ok({ job: inserted, application });
  })
);

server.registerTool(
  "create_application",
  {
    title: "Add job to pipeline",
    description: "Create a pipeline application for an existing saved job.",
    inputSchema: {
      job_id: z.string().uuid(),
      status: z.enum(APPLICATION_STATUSES).default("saved"),
      notes: z.string().optional(),
    },
  },
  wrap(async ({ job_id, status, notes }) => {
    const supa = await getClient();
    const userId = await getUserId();
    const { data, error } = await supa
      .from("applications")
      .insert({
        user_id: userId,
        job_id,
        status: status ?? "saved",
        notes,
        applied_at: status === "applied" ? new Date().toISOString() : null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return ok(data);
  })
);

server.registerTool(
  "update_application",
  {
    title: "Update application",
    description:
      "Update a pipeline application: move it to a new status (kanban stage), or set notes / next step. Moving to 'applied' stamps applied_at automatically.",
    inputSchema: {
      application_id: z.string().uuid(),
      status: z.enum(APPLICATION_STATUSES).optional(),
      notes: z.string().optional(),
      next_step: z.string().optional(),
    },
  },
  wrap(async ({ application_id, status, notes, next_step }) => {
    const supa = await getClient();
    const patch: Record<string, unknown> = {};
    if (status !== undefined) patch.status = status;
    if (notes !== undefined) patch.notes = notes;
    if (next_step !== undefined) patch.next_step = next_step;
    if (!Object.keys(patch).length) throw new Error("Nothing to update — pass status, notes, or next_step.");
    if (status === "applied") {
      const { data: existing } = await supa.from("applications").select("applied_at").eq("id", application_id).single();
      if (!existing?.applied_at) patch.applied_at = new Date().toISOString();
    }
    const { data, error } = await supa.from("applications").update(patch).eq("id", application_id).select().single();
    if (error) throw new Error(error.message);
    return ok(data);
  })
);

server.registerTool(
  "delete_application",
  {
    title: "Delete application",
    description: "Remove an application from the pipeline. The underlying job row is kept.",
    inputSchema: { application_id: z.string().uuid() },
  },
  wrap(async ({ application_id }) => {
    const supa = await getClient();
    const { error, count } = await supa
      .from("applications")
      .delete({ count: "exact" })
      .eq("id", application_id);
    if (error) throw new Error(error.message);
    if (!count) throw new Error(`No application found with id ${application_id}.`);
    return ok({ deleted: application_id });
  })
);

// ---------- Save tools (Claude does the AI work in-session, these persist it) ----------

server.registerTool(
  "save_job_score",
  {
    title: "Save a job match score",
    description:
      "Save a match score you computed yourself (by comparing the active resume to the job description) onto a saved job. " +
      "Use get_active_resume and get_job first, score fit 0-100 overall and per dimension, then save here. " +
      "Shows up in the app exactly like an AI-scored job. Alternative to score_job (which spends a Gemini call).",
    inputSchema: {
      job_id: z.string().uuid(),
      score: z.number().int().min(0).max(100),
      breakdown: z.object({
        skills: z.number().int().min(0).max(100),
        experience: z.number().int().min(0).max(100),
        keywords: z.number().int().min(0).max(100),
        seniority: z.number().int().min(0).max(100),
        industry: z.number().int().min(0).max(100),
      }),
    },
  },
  wrap(async ({ job_id, score, breakdown }) => {
    const supa = await getClient();
    const { data, error } = await supa
      .from("jobs")
      .update({ match_score: score, match_breakdown: breakdown })
      .eq("id", job_id)
      .select("id, title, company, match_score")
      .single();
    if (error) throw new Error(error.message);
    return ok(data);
  })
);

server.registerTool(
  "save_cover_letter",
  {
    title: "Save a cover letter",
    description:
      "Save a cover letter you wrote yourself for a saved job into the app's generated_docs (plain text, first person). " +
      "Alternative to generate_cover_letter (which spends a Gemini call).",
    inputSchema: {
      job_id: z.string().uuid(),
      content: z.string().min(1),
      tone: z.string().default("professional"),
      length: z.enum(["short", "medium", "long"]).default("medium"),
    },
  },
  wrap(async ({ job_id, content, tone, length }) => {
    const supa = await getClient();
    const userId = await getUserId();
    const { data, error } = await supa
      .from("generated_docs")
      .insert({
        user_id: userId,
        job_id,
        type: "cover_letter",
        content,
        tone: tone ?? "professional",
        length: length ?? "medium",
      })
      .select("id, job_id, type, tone, length, created_at")
      .single();
    if (error) throw new Error(error.message);
    return ok(data);
  })
);

// ---------- AI tools (Supabase Edge Functions) ----------

async function resumeAndJob(jobId: string) {
  const [resume, job] = await Promise.all([fetchActiveResume(), fetchJob(jobId)]);
  if (!job.description) {
    throw new Error(`Job "${job.title}" has no description — add one first (needed for AI functions).`);
  }
  return { resume, job };
}

server.registerTool(
  "score_job",
  {
    title: "Score job vs resume",
    description:
      "Run the AI match scorer (Gemini) comparing the active resume against a saved job's description. Saves the score and breakdown back onto the job (visible in the app).",
    inputSchema: { job_id: z.string().uuid() },
  },
  wrap(async ({ job_id }) => {
    const { resume, job } = await resumeAndJob(job_id);
    const supa = await getClient();
    const { data: profile } = await supa.from("profiles").select("seniority, target_titles").single();
    const result = await callEdgeFunction<{ score: number; breakdown: unknown }>("ai-score-job", {
      resume_parsed: resume.parsed,
      job_description: job.description,
      user_preferences: profile ?? undefined,
    });
    const { error } = await supa
      .from("jobs")
      .update({ match_score: result.score, match_breakdown: result.breakdown })
      .eq("id", job_id);
    if (error) throw new Error(`Scored, but saving failed: ${error.message}`);
    return ok({ job: { id: job.id, title: job.title, company: job.company }, ...result });
  })
);

server.registerTool(
  "get_tailoring_suggestions",
  {
    title: "Get tailoring suggestions",
    description: "Get 2–5 concrete AI suggestions for closing gaps between the active resume and a saved job's description.",
    inputSchema: { job_id: z.string().uuid() },
  },
  wrap(async ({ job_id }) => {
    const { resume, job } = await resumeAndJob(job_id);
    const result = await callEdgeFunction<{ suggestions: string[] }>("ai-tailoring-suggestions", {
      resume_parsed: resume.parsed,
      job_description: job.description,
    });
    return ok({ job: { id: job.id, title: job.title, company: job.company }, ...result });
  })
);

server.registerTool(
  "tailor_resume",
  {
    title: "Tailor resume for job",
    description:
      "Generate a version of the active resume tailored to a saved job (rewritten summary and bullets, reordered skills; facts unchanged). Returns the tailored resume JSON — it is not saved anywhere.",
    inputSchema: { job_id: z.string().uuid() },
  },
  wrap(async ({ job_id }) => {
    const { resume, job } = await resumeAndJob(job_id);
    const result = await callEdgeFunction<Record<string, unknown>>("ai-tailor-resume", {
      resume_parsed: resume.parsed,
      job_description: job.description,
    });
    return ok(result);
  })
);

server.registerTool(
  "generate_cover_letter",
  {
    title: "Generate cover letter",
    description:
      "Draft an AI cover letter for a saved job using the active resume. The letter is saved to generated_docs in the app automatically.",
    inputSchema: {
      job_id: z.string().uuid(),
      tone: z.enum(["professional", "friendly", "enthusiastic", "formal"]).default("professional"),
      length: z.enum(["short", "medium", "long"]).default("medium"),
    },
  },
  wrap(async ({ job_id, tone, length }) => {
    const { resume, job } = await resumeAndJob(job_id);
    const result = await callEdgeFunction<{ content: string }>("ai-generate-cover-letter", {
      resume_parsed: resume.parsed,
      job_description: job.description,
      tone: tone ?? "professional",
      length: length ?? "medium",
      job_id,
    });
    return ok({ job: { id: job.id, title: job.title, company: job.company }, ...result });
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);

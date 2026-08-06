#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { repoRoot } from "./env.js";
import { callEdgeFunction, getClient, getUserId } from "./supabase.js";
import { EVENT_TO_STATUS, pickStepToSchedule, reconcile, type Evidence, type PipelineApp } from "./reconcile.js";

const APPLICATION_STATUSES = ["saved", "applied", "interviewing", "offer", "closed", "rejected"] as const;
const INTERVIEW_STEP_FORMATS = ["phone", "video_live", "take_home", "onsite", "other"] as const;
const INTERVIEW_STEP_STATUSES = ["pending_schedule", "scheduled", "completed", "cancelled"] as const;

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

// Best-effort entry in the app's activity feed for writes that don't touch the
// applications table (those are logged by a DB trigger). Never fails the tool.
async function logActivity(entry: {
  action: string;
  job_id?: string | null;
  application_id?: string | null;
  job_title?: string | null;
  company?: string | null;
  details?: Record<string, unknown>;
}) {
  try {
    const supa = await getClient();
    const userId = await getUserId();
    await supa.from("activity_log").insert({ user_id: userId, actor: "claude", details: {}, ...entry });
  } catch {
    // activity feed is optional — ignore (e.g. migration 003 not applied yet)
  }
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
      "List all applications in the kanban pipeline with their job details, grouped by status (saved, applied, interviewing, offer, closed, rejected). " +
      "Archived applications (terminal cards auto-archived after 30 days) are excluded unless include_archived is true. Applications awaiting the " +
      "user's review (needs_review=true — added from inferred/uncertain evidence, not yet approved onto the board) are excluded unless include_review is true. " +
      "Each application embeds application_notes (newest first) — that's the timeline, not a flat notes field. The current 'next step' is the most " +
      "recent entry with source='next_step'; everything else is a general update.",
    inputSchema: {
      include_archived: z.boolean().default(false).describe("Also return archived applications"),
      include_review: z.boolean().default(false).describe("Also return applications still pending in the Needs Review queue"),
    },
  },
  wrap(async ({ include_archived, include_review }) => {
    const supa = await getClient();
    let q = supa
      .from("applications")
      .select(
        `id, status, applied_at, archived_at, needs_review, updated_at,
         jobs(id, title, company, location, match_score, url),
         interview_steps(id, round_number, sequence_in_round, title, format, duration_minutes, interviewer, scheduled_at, status, notes),
         application_notes(id, body, actor, source, created_at)`
      )
      .order("updated_at", { ascending: false })
      .order("round_number", { referencedTable: "interview_steps", ascending: true })
      .order("sequence_in_round", { referencedTable: "interview_steps", ascending: true })
      .order("created_at", { referencedTable: "application_notes", ascending: false });
    if (!include_archived) q = q.is("archived_at", null);
    if (!include_review) q = q.eq("needs_review", false);
    const { data, error } = await q;
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
    if (query) {
      // Strip PostgREST filter metacharacters so the term can't alter the filter syntax
      const safe = query.replace(/[,()]/g, " ").trim();
      if (safe) q = q.or(`title.ilike.%${safe}%,company.ilike.%${safe}%`);
    }
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
      "Add a job to the app (source: manual). By default also creates a pipeline application in 'saved' status so it appears on the kanban board immediately. " +
      "IMPORTANT — needs_review: set needs_review=true whenever this job/application is built from inference rather than the user directly telling you " +
      "to add it in the current conversation (e.g. an 'unmatched' entry from reconcile_inbox, a guessed title/company from a vague email, a job pulled from " +
      "search results the user didn't explicitly pick). Review-flagged cards are hidden from the live kanban board and instead land in the app's 'Needs " +
      "Review' queue for the user to approve or dismiss themselves — this is the only correct way to surface an uncertain add when you're running " +
      "unattended and can't actually ask. Only leave needs_review=false when a real person, in this conversation, told you to add this specific job.",
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
      needs_review: z.boolean().default(false).describe(
        "true = inferred, not user-confirmed — goes to the Needs Review queue instead of the live board. See tool description."
      ),
    },
  },
  wrap(async ({ save_to_pipeline, needs_review, ...job }) => {
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
        .insert({ user_id: userId, job_id: inserted.id, status: "saved", last_actor: "claude", needs_review: needs_review ?? false })
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
    description:
      "Create a pipeline application for an existing saved job. Set needs_review=true if the user didn't explicitly " +
      "direct you to add this specific job in the current conversation (see add_job's description for the full rule) — " +
      "it will land in the app's Needs Review queue instead of the live board.",
    inputSchema: {
      job_id: z.string().uuid(),
      status: z.enum(APPLICATION_STATUSES).default("saved"),
      notes: z.string().optional().describe("Optional first update, e.g. why this was added — saved as its own note block, not a flat field"),
      needs_review: z.boolean().default(false).describe("true = inferred, not user-confirmed — goes to the Needs Review queue"),
    },
  },
  wrap(async ({ job_id, status, notes, needs_review }) => {
    const supa = await getClient();
    const userId = await getUserId();
    const { data, error } = await supa
      .from("applications")
      .insert({
        user_id: userId,
        job_id,
        status: status ?? "saved",
        applied_at: status === "applied" ? new Date().toISOString() : null,
        last_actor: "claude",
        needs_review: needs_review ?? false,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    if (notes) {
      await supa.from("application_notes").insert({ user_id: userId, application_id: data.id, body: notes, actor: "claude" });
    }
    return ok(data);
  })
);

server.registerTool(
  "update_application",
  {
    title: "Update application",
    description:
      "Update a pipeline application: move it to a new status (kanban stage) or archive/unarchive it. Moving to " +
      "'applied' stamps applied_at automatically. To log an update (a call, an email, a decision) or set the " +
      "'next step', use add_application_note instead — see its description for the source='next_step' convention.",
    inputSchema: {
      application_id: z.string().uuid(),
      status: z.enum(APPLICATION_STATUSES).optional(),
      archived: z.boolean().optional().describe("true = archive (hide from the board), false = restore"),
    },
  },
  wrap(async ({ application_id, status, archived }) => {
    const supa = await getClient();
    const patch: Record<string, unknown> = {};
    if (status !== undefined) patch.status = status;
    if (archived !== undefined) patch.archived_at = archived ? new Date().toISOString() : null;
    if (!Object.keys(patch).length) throw new Error("Nothing to update — pass status or archived.");
    patch.last_actor = "claude";
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
  "add_application_note",
  {
    title: "Add a note to an application",
    description:
      "Log one distinct update on a pipeline application's timeline — a call, an email, a status change reason, " +
      "a file saved. Each call adds its own block (with actor + timestamp), it never overwrites or appends to a " +
      "prior note. This is the only way to write notes now — update_application no longer has a notes field. " +
      "Pass source='next_step' to set what the app shows as the pinned 'Next step' (e.g. 'Recruiting screen " +
      "Thursday 4pm ET') — the most recent note with that source is the current one; there's no separate field " +
      "for it anymore, so use a plain call (no source) for a general update instead.",
    inputSchema: {
      application_id: z.string().uuid(),
      body: z.string().min(1),
      source: z.string().optional().describe(
        "Optional short label. 'next_step' pins this as the current next step. Other free-form labels " +
        "(e.g. 'gmail_reconcile', 'tailored_resume') just tag the entry — omit for a plain update."
      ),
    },
  },
  wrap(async ({ application_id, body, source }) => {
    const supa = await getClient();
    const userId = await getUserId();
    const { data, error } = await supa
      .from("application_notes")
      .insert({ user_id: userId, application_id, body, actor: "claude", source })
      .select()
      .single();
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
    // Stamp the actor first so the activity trigger credits the delete to Claude
    // (an actor-only update logs nothing itself)
    await supa.from("applications").update({ last_actor: "claude" }).eq("id", application_id);
    const { error, count } = await supa
      .from("applications")
      .delete({ count: "exact" })
      .eq("id", application_id);
    if (error) throw new Error(error.message);
    if (!count) throw new Error(`No application found with id ${application_id}.`);
    return ok({ deleted: application_id });
  })
);

// ---------- Interview lifecycle steps ----------

server.registerTool(
  "add_interview_step",
  {
    title: "Add an interview step",
    description:
      "Record one step of an application's interview loop — a round can be a single step or several " +
      "(e.g. a round with both a live case interview and a take-home presentation is round_number 2, " +
      "sequence_in_round 1 and 2). Use this for anything a recruiter tells you verbally or by scheduling " +
      "link, not just what shows up in Gmail — that's the main reason this exists as a separate manual tool. " +
      "Leave scheduled_at unset until an actual date/time is known; status stays 'pending_schedule' until then.",
    inputSchema: {
      application_id: z.string().uuid(),
      round_number: z.number().int().positive(),
      sequence_in_round: z.number().int().positive().default(1),
      title: z.string().min(1).describe("e.g. 'Mini case + behavioral', 'Live case interview', 'Take-home case presentation'"),
      format: z.enum(INTERVIEW_STEP_FORMATS).optional(),
      duration_minutes: z.number().int().positive().optional(),
      interviewer: z.string().optional().describe("Name or role, e.g. 'Managing Director'"),
      scheduled_at: z.string().datetime().optional(),
      status: z.enum(INTERVIEW_STEP_STATUSES).default("pending_schedule"),
      notes: z.string().optional(),
    },
  },
  wrap(async ({ application_id, ...step }) => {
    const supa = await getClient();
    const userId = await getUserId();
    const { data, error } = await supa
      .from("interview_steps")
      .insert({ user_id: userId, application_id, last_actor: "claude", ...step })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return ok(data);
  })
);

server.registerTool(
  "update_interview_step",
  {
    title: "Update an interview step",
    description: "Reschedule, mark completed/cancelled, or annotate an existing interview step.",
    inputSchema: {
      interview_step_id: z.string().uuid(),
      scheduled_at: z.string().datetime().optional(),
      status: z.enum(INTERVIEW_STEP_STATUSES).optional(),
      interviewer: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  wrap(async ({ interview_step_id, ...fields }) => {
    const supa = await getClient();
    const patch: Record<string, unknown> = { last_actor: "claude" };
    for (const [key, value] of Object.entries(fields)) if (value !== undefined) patch[key] = value;
    if (Object.keys(patch).length === 1) {
      throw new Error("Nothing to update — pass scheduled_at, status, interviewer, or notes.");
    }
    const { data, error } = await supa
      .from("interview_steps")
      .update(patch)
      .eq("id", interview_step_id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return ok(data);
  })
);

server.registerTool(
  "delete_interview_step",
  {
    title: "Delete an interview step",
    description: "Remove a step that was added by mistake. To record a step that was called off, prefer update_interview_step with status='cancelled' instead — it keeps the history.",
    inputSchema: { interview_step_id: z.string().uuid() },
  },
  wrap(async ({ interview_step_id }) => {
    const supa = await getClient();
    await supa.from("interview_steps").update({ last_actor: "claude" }).eq("id", interview_step_id);
    const { error, count } = await supa
      .from("interview_steps")
      .delete({ count: "exact" })
      .eq("id", interview_step_id);
    if (error) throw new Error(error.message);
    if (!count) throw new Error(`No interview step found with id ${interview_step_id}.`);
    return ok({ deleted: interview_step_id });
  })
);

// ---------- Inbox reconciliation (Claude scans Gmail in-session, this tool matches & applies) ----------

const EvidenceSchema = z.object({
  company: z.string().min(1).describe("Company name as it appears in the email"),
  role: z.string().optional().describe("Role/title if the email mentions it — used to disambiguate multiple applications at the same company"),
  event: z.enum(Object.keys(EVENT_TO_STATUS) as [keyof typeof EVENT_TO_STATUS, ...
    (keyof typeof EVENT_TO_STATUS)[]]).describe(
    "What the email signals: applied (application received/submitted), interview (interview invite or scheduling), offer, rejected, closed (role withdrawn/filled)"
  ),
  email_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date of the email, YYYY-MM-DD"),
  subject: z.string().optional().describe("Email subject line — recorded as its own note block for the audit trail"),
  gmail_thread_id: z.string().optional(),
  interview_step_scheduled_at: z.string().datetime().optional().describe(
    "Set when this email confirms/reschedules a specific interview step (e.g. a calendar invite or " +
    "'your interview is confirmed for...'), as opposed to just being a generic interview-stage signal. " +
    "When set, the tool advances the application's earliest still-pending interview step to 'scheduled' at this time."
  ),
  interview_step_round: z.number().int().positive().optional().describe(
    "Only if the email states which round it's for — otherwise the earliest pending step is assumed."
  ),
});

server.registerTool(
  "reconcile_inbox",
  {
    title: "Reconcile Gmail evidence with pipeline",
    description:
      "Reconcile job-application emails against the kanban pipeline. Claude should first scan Gmail in-session " +
      "(search e.g. 'application received', 'thank you for applying', 'interview', 'unfortunately', 'offer', plus " +
      "greenhouse.io / lever.co / myworkday / ashbyhq / icims senders), extract one evidence entry per company/role " +
      "signal, then call this tool. The tool matches evidence to applications by normalized company name (role title " +
      "as tiebreaker) and returns: proposals (status is behind the email trail — forward moves and terminal " +
      "rejected/closed only, never downgrades, never auto-touches an already-terminal application), in_sync, " +
      "conflicts (terminal application contradicted by email — review manually), ambiguous (multiple matching " +
      "applications), and unmatched (emails with no pipeline entry — possibly missed applications). Call with " +
      "apply=false first and show the user the report; call again with apply=true to write the proposed status " +
      "updates (stamps applied_at, logs a distinct note block with the email subject/date) — this only ever updates " +
      "applications that already exist, so it's safe to auto-apply. " +
      "unmatched entries are different: they are not yet confirmed to be real, distinct applications. NEVER call " +
      "add_job for one with needs_review left at its default (false). If there's a live user in this conversation, " +
      "show them the unmatched list and only add_job the ones they explicitly say to add. If you're running " +
      "unattended (a scheduled/autonomous session with no user to ask), call add_job with needs_review=true for " +
      "each unmatched entry that plausibly represents a real application — this routes it to the app's Needs " +
      "Review queue, hidden from the live board, instead of guessing on the user's behalf. " +
      "If an application has interview_steps recorded (e.g. added manually via add_interview_step from a recruiter " +
      "call) and an evidence entry sets interview_step_scheduled_at, the tool also advances that application's " +
      "earliest still-pending step to 'scheduled' — reported under interview_step_matches, applied only when " +
      "apply=true. This never invents steps: an application with no pending interview_steps is left alone (only " +
      "its status moves, as before) since email alone can't reliably reconstruct a whole interview loop.",
    inputSchema: {
      evidence: z.array(EvidenceSchema).min(1),
      apply: z.boolean().default(false).describe("false = dry-run report only; true = apply the proposed status updates"),
    },
  },
  wrap(async ({ evidence, apply }) => {
    const supa = await getClient();
    const userId = await getUserId();
    const { data, error } = await supa
      .from("applications")
      .select(
        `id, status, applied_at, updated_at, jobs(id, title, company),
         interview_steps(id, round_number, sequence_in_round, title, status)`
      )
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);

    const apps: PipelineApp[] = (data ?? []).map((a: Record<string, unknown>) => ({
      id: a.id as string,
      status: a.status as string,
      applied_at: a.applied_at as string | null,
      updated_at: a.updated_at as string,
      job: (Array.isArray(a.jobs) ? a.jobs[0] : a.jobs) as PipelineApp["job"],
      interview_steps: (a.interview_steps ?? undefined) as PipelineApp["interview_steps"],
    }));

    const report = reconcile(apps, evidence as Evidence[]);

    // Evidence that confirms a specific interview step, resolved against the app it
    // matched to (proposals + in_sync — a second scheduling email for an app already
    // 'interviewing' shows up as in_sync on status but still needs a step advanced).
    const stepMatches = [...report.proposals, ...report.in_sync]
      .filter(m => m.evidence.interview_step_scheduled_at)
      .map(m => {
        const app = apps.find(a => a.id === m.application_id)!;
        const step = pickStepToSchedule(app.interview_steps, m.evidence.interview_step_round);
        return { application_id: m.application_id, company: m.company, evidence: m.evidence, matched_step: step ?? null };
      });

    if (!apply) return ok({ mode: "dry_run", ...report, interview_step_matches: stepMatches });

    const applied: unknown[] = [];
    for (const p of report.proposals) {
      const app = apps.find(a => a.id === p.application_id)!;
      const patch: Record<string, unknown> = { status: p.to_status, last_actor: "claude" };
      if (p.to_status === "applied" && !app.applied_at) {
        patch.applied_at = `${p.evidence.email_date}T00:00:00Z`;
      }
      const { data: updated, error: upErr } = await supa
        .from("applications")
        .update(patch)
        .eq("id", p.application_id)
        .select("id, status, applied_at")
        .single();
      if (upErr) throw new Error(`Applied ${applied.length}/${report.proposals.length}, then failed on ${p.company}: ${upErr.message}`);
      const line = `Gmail reconcile ${p.evidence.email_date}: ${p.evidence.subject ?? p.evidence.event} → ${p.to_status}`;
      await supa.from("application_notes").insert({
        user_id: userId, application_id: p.application_id, body: line, actor: "claude", source: "gmail_reconcile",
      });
      applied.push({ ...p, result: updated });
    }

    const stepsAdvanced: unknown[] = [];
    for (const m of stepMatches) {
      if (!m.matched_step) continue;
      const { data: updated, error: stepErr } = await supa
        .from("interview_steps")
        .update({ scheduled_at: m.evidence.interview_step_scheduled_at, status: "scheduled", source: "gmail_reconcile", last_actor: "claude" })
        .eq("id", m.matched_step.id)
        .select()
        .single();
      if (stepErr) throw new Error(`Applied application updates, then failed advancing interview step for ${m.company}: ${stepErr.message}`);
      stepsAdvanced.push({ application_id: m.application_id, company: m.company, result: updated });
    }

    return ok({ mode: "applied", applied, interview_steps_advanced: stepsAdvanced, ...report, proposals: undefined });
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
    await logActivity({
      action: "job_scored", job_id, job_title: data.title, company: data.company,
      details: { score },
    });
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
    const job = await fetchJob(job_id).catch(() => null);
    await logActivity({
      action: "cover_letter_saved", job_id, job_title: job?.title, company: job?.company,
      details: { tone: tone ?? "professional", length: length ?? "medium" },
    });
    return ok(data);
  })
);

// ---------- Local file tools (tailored-resumes/ folder) ----------

const tailoredDir = process.env.TAILORED_RESUMES_DIR ?? join(repoRoot, "tailored-resumes");

// Matches the tailor-resume skill's naming convention: clean identifiers, underscores, no spaces
function cleanIdentifier(s: string): string {
  return s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

const resumeTemplatePath = join(repoRoot, "mcp-server", "private", "resume_template.docx");
const renderScriptPath   = join(repoRoot, "mcp-server", "scripts", "render_resume.py");

const RenderOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_text"),          anchor: z.string(), text: z.string(),              occurrence: z.number().int().positive().default(1) }),
  z.object({ op: z.literal("replace_bullets"),   anchor: z.string(), bullets: z.array(z.string()),  occurrence: z.number().int().positive().default(1) }),
  z.object({ op: z.literal("remove_role"),       anchor: z.string(), company_anchor: z.string().optional(), occurrence: z.number().int().positive().default(1) }),
  z.object({ op: z.literal("set_skill_category"), label: z.string(), items: z.string(),             occurrence: z.number().int().positive().default(1) }),
]);

server.registerTool(
  "render_tailored_resume",
  {
    title: "Render tailored resume locally",
    description:
      "Apply a list of structured edits to the local resume template and save the result to " +
      "tailored-resumes/. Accepts edit operations (set_text, replace_bullets, remove_role, " +
      "set_skill_category) rather than a file — no base64 transfer needed. " +
      "Requires python3 + python-docx on the local machine. " +
      "If job_id is given, stamps a note on the pipeline card.",
    inputSchema: {
      company:    z.string().min(1),
      role:       z.string().min(1),
      job_id:     z.string().uuid().optional(),
      operations: z.array(RenderOp).min(1).describe(
        "Ordered list of edit operations to apply to the template. " +
        "anchor values must match the start of a paragraph in the template — " +
        "check references/resume-template-spec.md for exact strings."
      ),
    },
  },
  wrap(async ({ company, role, job_id, operations }) => {
    if (!existsSync(resumeTemplatePath)) {
      throw new Error(
        `Resume template not found at ${resumeTemplatePath}. ` +
        `Copy assets/resume_template.docx from the tailor-resume skill bundle into mcp-server/private/.`
      );
    }
    if (!existsSync(renderScriptPath)) {
      throw new Error(`Render script not found at ${renderScriptPath}.`);
    }

    mkdirSync(tailoredDir, { recursive: true });
    const base = `Huda_Aliraza_${cleanIdentifier(company)}_${cleanIdentifier(role)}`;
    let name = base;
    for (let n = 2; existsSync(join(tailoredDir, `${name}.docx`)); n++) name = `${base}_${n}`;
    const outputPath = join(tailoredDir, `${name}.docx`);

    const opsFile = join(tailoredDir, `.render_ops_${Date.now()}.json`);
    writeFileSync(opsFile, JSON.stringify({ template_path: resumeTemplatePath, output_path: outputPath, operations }));

    let result;
    try {
      result = spawnSync("python3", [renderScriptPath], {
        input: readFileSync(opsFile),
        encoding: "utf8",
        timeout: 30_000,
      });
    } finally {
      try { unlinkSync(opsFile); } catch {}
    }

    if (result.status !== 0) {
      throw new Error(`Render failed:\n${result.stderr || result.error?.message || "unknown error"}`);
    }

    const output = JSON.parse(result.stdout.trim());

    let application: unknown = null;
    if (job_id) {
      const supa = await getClient();
      const userId = await getUserId();
      const { data: apps } = await supa
        .from("applications")
        .select("id")
        .eq("job_id", job_id)
        .order("updated_at", { ascending: false })
        .limit(1);
      if (apps?.length) {
        const line = `Tailored resume: ${name} (${new Date().toISOString().slice(0, 10)})`;
        const { data, error } = await supa
          .from("application_notes")
          .insert({ user_id: userId, application_id: apps[0].id, body: line, actor: "claude", source: "tailored_resume" })
          .select()
          .single();
        if (error) throw new Error(`File saved, but logging the pipeline note failed: ${error.message}`);
        application = data;
      }
    }

    return ok({ saved: output.saved, purged_bullets: output.purged_bullets, application });
  })
);

server.registerTool(
  "save_tailored_resume",
  {
    title: "Save tailored resume file locally",
    description:
      "Park a tailored resume built in-session (e.g. by the tailor-resume skill) into the local tailored-resumes/ " +
      "folder next to the app, named Huda_Aliraza_<Company>_<Role>.<ext>. Pass the file content base64-encoded " +
      "(docx and/or pdf — at least one). If job_id is given, a note with the filename is appended to that job's " +
      "pipeline application so the board records which resume version was used.",
    inputSchema: {
      company: z.string().min(1),
      role: z.string().min(1),
      docx_base64: z.string().optional().describe("Base64-encoded .docx file content"),
      pdf_base64: z.string().optional().describe("Base64-encoded .pdf file content"),
      job_id: z.string().uuid().optional().describe("Saved job to link this resume to on the pipeline"),
    },
  },
  wrap(async ({ company, role, docx_base64, pdf_base64, job_id }) => {
    const files: { ext: string; buf: Buffer }[] = [];
    if (docx_base64) {
      const buf = Buffer.from(docx_base64, "base64");
      if (buf.subarray(0, 2).toString("latin1") !== "PK") {
        throw new Error("docx_base64 does not decode to a .docx file (missing zip header) — re-encode and retry.");
      }
      files.push({ ext: "docx", buf });
    }
    if (pdf_base64) {
      const buf = Buffer.from(pdf_base64, "base64");
      if (buf.subarray(0, 4).toString("latin1") !== "%PDF") {
        throw new Error("pdf_base64 does not decode to a .pdf file (missing %PDF header) — re-encode and retry.");
      }
      files.push({ ext: "pdf", buf });
    }
    if (!files.length) throw new Error("Provide docx_base64 and/or pdf_base64.");

    mkdirSync(tailoredDir, { recursive: true });
    const base = `Huda_Aliraza_${cleanIdentifier(company)}_${cleanIdentifier(role)}`;
    // Bump a shared suffix until no provided format collides, so docx+pdf stay paired
    let name = base;
    for (let n = 2; files.some(f => existsSync(join(tailoredDir, `${name}.${f.ext}`))); n++) {
      name = `${base}_${n}`;
    }
    const saved = files.map(f => {
      const path = join(tailoredDir, `${name}.${f.ext}`);
      writeFileSync(path, f.buf);
      return path;
    });

    let application: unknown = null;
    if (job_id) {
      const supa = await getClient();
      const userId = await getUserId();
      const { data: apps } = await supa
        .from("applications")
        .select("id")
        .eq("job_id", job_id)
        .order("updated_at", { ascending: false })
        .limit(1);
      if (apps?.length) {
        const line = `Tailored resume: ${name} (${new Date().toISOString().slice(0, 10)})`;
        const { data, error } = await supa
          .from("application_notes")
          .insert({ user_id: userId, application_id: apps[0].id, body: line, actor: "claude", source: "tailored_resume" })
          .select()
          .single();
        if (error) throw new Error(`Files saved, but logging the application note failed: ${error.message}`);
        application = data;
      }
    }
    return ok({ saved, application: application ?? (job_id ? "no application found for that job" : undefined) });
  })
);

server.registerTool(
  "list_tailored_resumes",
  {
    title: "List tailored resume files",
    description: "List resume files parked in the local tailored-resumes/ folder, newest first.",
    inputSchema: {},
  },
  wrap(async () => {
    if (!existsSync(tailoredDir)) return ok([]);
    const entries = readdirSync(tailoredDir)
      .filter(f => /\.(docx|pdf)$/i.test(f))
      .map(f => {
        const s = statSync(join(tailoredDir, f));
        return { file: f, path: join(tailoredDir, f), modified: s.mtime.toISOString(), size_kb: Math.round(s.size / 1024) };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
    return ok(entries);
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
    await logActivity({
      action: "job_scored", job_id, job_title: job.title, company: job.company,
      details: { score: result.score },
    });
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
    await logActivity({
      action: "cover_letter_saved", job_id, job_title: job.title, company: job.company,
      details: { tone: tone ?? "professional", length: length ?? "medium" },
    });
    return ok({ job: { id: job.id, title: job.title, company: job.company }, ...result });
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);

// Pure matching logic for reconciling Gmail-derived evidence against the pipeline.
// Kept free of Supabase/MCP imports so it can be unit-tested with plain node.

export const EVENT_TO_STATUS = {
  applied: "applied",
  interview: "interviewing",
  offer: "offer",
  rejected: "rejected",
  closed: "closed",
} as const;

export type EmailEvent = keyof typeof EVENT_TO_STATUS;

export interface Evidence {
  company: string;
  role?: string;
  event: EmailEvent;
  email_date: string; // YYYY-MM-DD
  subject?: string;
  gmail_thread_id?: string;
}

export interface PipelineApp {
  id: string;
  status: string;
  applied_at: string | null;
  notes: string | null;
  updated_at: string;
  job: { id: string; title: string | null; company: string | null };
}

export interface Proposal {
  application_id: string;
  company: string | null;
  title: string | null;
  from_status: string;
  to_status: string;
  evidence: Evidence;
}

export interface ReconcileReport {
  proposals: Proposal[];
  in_sync: { application_id: string; company: string | null; status: string; evidence: Evidence }[];
  conflicts: { application_id: string; company: string | null; status: string; evidence: Evidence; reason: string }[];
  unmatched: Evidence[];
  ambiguous: { evidence: Evidence; candidate_application_ids: string[] }[];
}

const STATUS_RANK: Record<string, number> = { saved: 0, applied: 1, interviewing: 2, offer: 3 };
const TERMINAL = new Set(["rejected", "closed"]);

// Legal/organizational suffixes that carry no identity: "Acme Inc" === "Acme"
const NOISE_TOKENS = new Set(["inc", "llc", "ltd", "corp", "corporation", "co", "company", "plc", "gmbh", "the"]);

export function normalizeCompany(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .split(/\s+/)
    .filter(t => t && !NOISE_TOKENS.has(t));
}

export function companiesMatch(a: string, b: string): boolean {
  const ta = normalizeCompany(a);
  const tb = normalizeCompany(b);
  if (!ta.length || !tb.length) return false;
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  // Every token of the shorter name must appear, in order, at the start of the longer
  // ("Wipfli" matches "Wipfli LLP Consulting"; "General Motors" doesn't match "General Mills")
  return shorter.every((t, i) => longer[i] === t);
}

function titleOverlap(role: string, title: string | null): number {
  if (!title) return 0;
  const rt = new Set(normalizeCompany(role));
  return normalizeCompany(title).filter(t => rt.has(t)).length;
}

/** Match one piece of evidence to pipeline applications by company (and role as tiebreaker). */
function matchEvidence(apps: PipelineApp[], ev: Evidence): { app?: PipelineApp; candidates?: PipelineApp[] } {
  const byCompany = apps.filter(a => a.job.company && companiesMatch(a.job.company, ev.company));
  if (byCompany.length <= 1) return { app: byCompany[0] };
  if (ev.role) {
    const scored = byCompany
      .map(a => ({ a, s: titleOverlap(ev.role!, a.job.title) }))
      .sort((x, y) => y.s - x.s);
    if (scored[0].s > 0 && scored[0].s > (scored[1]?.s ?? 0)) return { app: scored[0].a };
  }
  return { candidates: byCompany };
}

export function reconcile(apps: PipelineApp[], evidence: Evidence[]): ReconcileReport {
  const report: ReconcileReport = { proposals: [], in_sync: [], conflicts: [], unmatched: [], ambiguous: [] };

  // Group evidence per matched application; keep only the strongest signal per app
  const perApp = new Map<string, { app: PipelineApp; evs: Evidence[] }>();
  for (const ev of evidence) {
    const { app, candidates } = matchEvidence(apps, ev);
    if (candidates) {
      report.ambiguous.push({ evidence: ev, candidate_application_ids: candidates.map(c => c.id) });
    } else if (!app) {
      report.unmatched.push(ev);
    } else {
      const entry = perApp.get(app.id) ?? { app, evs: [] };
      entry.evs.push(ev);
      perApp.set(app.id, entry);
    }
  }

  for (const { app, evs } of perApp.values()) {
    // Latest email wins; on a same-day tie, the further-along status wins
    const best = [...evs].sort((a, b) =>
      b.email_date.localeCompare(a.email_date) ||
      (STATUS_RANK[EVENT_TO_STATUS[b.event]] ?? 99) - (STATUS_RANK[EVENT_TO_STATUS[a.event]] ?? 99)
    )[0];
    const target = EVENT_TO_STATUS[best.event];
    const base = { application_id: app.id, company: app.job.company, evidence: best };

    if (target === app.status) {
      report.in_sync.push({ ...base, status: app.status });
    } else if (TERMINAL.has(app.status)) {
      report.conflicts.push({
        ...base,
        status: app.status,
        reason: `Email suggests '${target}' but application is already terminal ('${app.status}') — review manually.`,
      });
    } else if (TERMINAL.has(target) || (STATUS_RANK[target] ?? 0) > (STATUS_RANK[app.status] ?? 0)) {
      report.proposals.push({ ...base, title: app.job.title, from_status: app.status, to_status: target });
    } else {
      // Older-stage email than current status (e.g. application receipt for an interviewing app) — already ahead
      report.in_sync.push({ ...base, status: app.status });
    }
  }

  return report;
}

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Minimal .env parser — dotenv prints a banner to stdout, which corrupts
// the MCP stdio transport, so we roll our own.
function parseEnvFile(path: string): Record<string, string> {
  try {
    const out: Record<string, string> = {};
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

const here = dirname(fileURLToPath(import.meta.url)); // .../mcp-server/dist
const serverRoot = join(here, "..");                  // .../mcp-server
export const repoRoot = join(serverRoot, "..");       // .../JobApp

const local = parseEnvFile(join(serverRoot, ".env"));
const app = parseEnvFile(join(repoRoot, ".env.local"));

export const env = {
  supabaseUrl:
    process.env.SUPABASE_URL ?? local.SUPABASE_URL ?? app.VITE_SUPABASE_URL ?? "",
  supabaseAnonKey:
    process.env.SUPABASE_ANON_KEY ?? local.SUPABASE_ANON_KEY ?? app.VITE_SUPABASE_ANON_KEY ?? "",
  email: process.env.JOBAPP_EMAIL ?? local.JOBAPP_EMAIL ?? "",
  password: process.env.JOBAPP_PASSWORD ?? local.JOBAPP_PASSWORD ?? "",
};

export function assertEnv(): void {
  const missing: string[] = [];
  if (!env.supabaseUrl) missing.push("SUPABASE_URL (or VITE_SUPABASE_URL in ../.env.local)");
  if (!env.supabaseAnonKey) missing.push("SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY in ../.env.local)");
  if (!env.email) missing.push("JOBAPP_EMAIL");
  if (!env.password) missing.push("JOBAPP_PASSWORD");
  if (missing.length) {
    throw new Error(
      `Missing configuration: ${missing.join(", ")}. ` +
        `Create mcp-server/.env (see mcp-server/.env.example).`
    );
  }
}

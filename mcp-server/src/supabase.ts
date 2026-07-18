import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertEnv, env } from "./env.js";

let client: SupabaseClient | null = null;
let signIn: Promise<void> | null = null;

export async function getClient(): Promise<SupabaseClient> {
  assertEnv();
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: true },
    });
  }
  if (!signIn) {
    signIn = client.auth
      .signInWithPassword({ email: env.email, password: env.password })
      .then(({ error }) => {
        if (error) {
          signIn = null;
          throw new Error(`Supabase sign-in failed: ${error.message}`);
        }
      });
  }
  await signIn;
  return client;
}

export async function getUserId(): Promise<string> {
  const supa = await getClient();
  const { data, error } = await supa.auth.getUser();
  if (error || !data.user) throw new Error("Not signed in to Supabase.");
  return data.user.id;
}

/** Call a Supabase Edge Function with the signed-in user's JWT. */
export async function callEdgeFunction<T>(name: string, body: unknown): Promise<T> {
  const supa = await getClient();
  const { data: sessionData } = await supa.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("No active Supabase session.");

  const res = await fetch(`${env.supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.supabaseAnonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok || json.error) {
    throw new Error(`${name} failed (${res.status}): ${json.error ?? JSON.stringify(json)}`);
  }
  return json;
}

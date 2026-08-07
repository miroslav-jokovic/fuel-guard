import type { Env } from "../env.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { compareVersions, getBuildInfo } from "./buildInfo.js";

/**
 * The database half of deploy truth (ship-pipeline plan D0). Reads `public.applied_schema_version()`
 * (migration 0140) and compares it with the highest migration file in this checkout.
 *
 *   current — code and schema agree; the boring case
 *   behind  — the database is missing migrations this code expects. This is the failure that
 *             produces "I deployed and nothing changed": the API is new, the tables are old, and
 *             the routes that need them fail in ways that look like app bugs.
 *   ahead   — the database has migrations this code does not know about. Normal for a few seconds
 *             mid-deploy; persistent means a rollback left the schema in front of the code.
 *   unknown — the ledger could not be read (Supabase unconfigured, or 0140 itself not applied).
 *             Treated as drift, because "I could not check" must never read as "all good".
 */
export type SchemaState = "current" | "behind" | "ahead" | "unknown";

export interface SchemaStatus {
  expected: string | null;
  applied: string | null;
  state: SchemaState;
  drift: boolean;
}

/** `/api/version` is public and unauthenticated; a short cache keeps it from becoming a DB pump. */
const CACHE_TTL_MS = 30_000;
let cache: { at: number; applied: string | null } | null = null;

export function resetSchemaVersionCache(): void {
  cache = null;
}

async function readAppliedVersion(env: Env, now: number): Promise<string | null> {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.applied;
  let applied: string | null;
  try {
    const admin = getSupabaseAdmin(env);
    const { data, error } = await admin.rpc("applied_schema_version");
    applied = error ? null : ((data as string | null) ?? null);
  } catch {
    applied = null; // Supabase unconfigured (local/test) — reported as unknown, never thrown
  }
  cache = { at: now, applied };
  return applied;
}

export async function getSchemaStatus(env: Env, now = Date.now()): Promise<SchemaStatus> {
  const expected = getBuildInfo().expectedSchemaVersion;
  const applied = await readAppliedVersion(env, now);
  if (!expected || !applied) return { expected, applied, state: "unknown", drift: true };
  const diff = compareVersions(applied, expected);
  const state: SchemaState = diff === 0 ? "current" : diff < 0 ? "behind" : "ahead";
  return { expected, applied, state, drift: state !== "current" };
}

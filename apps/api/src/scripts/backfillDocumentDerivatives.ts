/**
 * `pnpm --filter @silvicom/api doc:derive-backfill -- --org <uuid> [--limit <n>] [--apply]` — queue `document_derive`
 * for every original in one organization that is missing a derivative its content type is owed
 * (DQF-EXECUTION-PLAN B8; UNIT-FILES-PLAN UF3).
 *
 * B8 was planned as "a no-op today" and never written: the register route queues a derive on every
 * upload, so only a dropped enqueue needed catching. D-UF10 changed that — every PDF filed before
 * 2026-10-19 is now owed a page-1 thumb it was never given (96 in production on 2026-10-19, none with
 * one). So this is the catch-all the register route's comment points at, and the one-off for D-UF10.
 *
 * DRY RUN BY DEFAULT: it prints how many originals are owed what, and writes nothing. `--apply` queues
 * one job per document, deduped on the same key the register route uses, so a second run while the
 * first is still draining queues nothing new, and a run after it has drained finds nothing owed.
 * ⚠ Without `JOB_EXECUTION_MODE=queue`, `dispatchJob` runs each derive IN THIS PROCESS — against
 * whatever bucket `.env` points at. Point it at the environment you mean.
 *
 * One organization per run: the service role bypasses RLS, so every query carries the org itself.
 *
 * `--limit <n>` acts on the first n owed originals only (by id, so a re-run picks the same ones until
 * they are done): a pilot whose thumbnails a person looks at before the rest are queued. Production's
 * first run, 2026-10-20, was 3 then the remaining 98 (UNIT-FILES-PLAN progress log).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { derivativesFor, isRecordId, type DocumentContentType } from "@silvicom/shared";
import { loadEnv } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { dispatchJob } from "../queue/dispatch.js";
import { registerAllHandlers } from "../queue/handlers/index.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export interface OriginalDoc {
  id: string;
  content_type: string;
}
export interface DerivedDoc {
  derived_from: string;
  variant: string;
}

/**
 * The originals owed at least one derivative, with what each is owed. Pure — the selection the
 * script acts on, testable without a database. A derivative the rules no longer ask for (a PDF's
 * `normalized`, if one ever existed) owes nothing and is not counted against anything.
 */
export function owedDerivatives(
  originals: readonly OriginalDoc[],
  derived: readonly DerivedDoc[],
): Array<{ id: string; contentType: string; missing: string[] }> {
  const have = new Map<string, Set<string>>();
  for (const d of derived) {
    const set = have.get(d.derived_from) ?? new Set<string>();
    set.add(d.variant);
    have.set(d.derived_from, set);
  }
  return originals.flatMap((o) => {
    const owed = derivativesFor(o.content_type as DocumentContentType).map((s) => s.variant as string);
    const missing = owed.filter((v) => !have.get(o.id)?.has(v));
    return missing.length > 0 ? [{ id: o.id, contentType: o.content_type, missing }] : [];
  });
}

const PAGE = 1000; // PostgREST's response cap — every read below pages past it.

async function readAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function main(): Promise<void> {
  const org = arg("org");
  if (!org || !isRecordId(org)) throw new Error("--org <organization uuid> is required");
  const apply = process.argv.includes("--apply");
  const limitArg = arg("limit");
  const limit = limitArg === undefined ? Infinity : Number(limitArg);
  if (!(limit > 0) || (limit !== Infinity && !Number.isInteger(limit))) throw new Error("--limit must be a positive whole number");
  const env = loadEnv();
  const admin = getSupabaseAdmin(env);

  const originals = await readAll<OriginalDoc>((from, to) =>
    admin.from("documents").select("id, content_type").eq("org_id", org).eq("variant", "original").order("id").range(from, to));
  const derived = await readAll<DerivedDoc>((from, to) =>
    admin.from("documents").select("derived_from, variant").eq("org_id", org).neq("variant", "original").order("id").range(from, to));

  const owed = owedDerivatives(originals, derived);
  const byType = new Map<string, number>();
  for (const o of owed) byType.set(o.contentType, (byType.get(o.contentType) ?? 0) + 1);
  process.stderr.write(`${originals.length} originals, ${owed.length} owed a derivative\n`);
  for (const [type, n] of byType) process.stderr.write(`  ${type}: ${n}\n`);

  const chosen = owed.slice(0, limit);
  if (chosen.length < owed.length) process.stderr.write(`--limit ${limit}: acting on ${chosen.length} of ${owed.length}: ${chosen.map((o) => o.id).join(", ")}\n`);

  let queued = 0;
  if (apply) {
    // In-process mode (no JOB_EXECUTION_MODE=queue) runs the handler here, so it must be registered
    // here — the API and the worker register theirs at boot, and this script is neither. Its first
    // production run failed on exactly this, before writing anything (2026-10-20).
    registerAllHandlers();
    for (const o of chosen) {
      await dispatchJob(admin, env, "document_derive", {
        orgId: org,
        payload: { documentId: o.id },
        dedupKey: `document_derive:${o.id}`,
      });
      queued++;
    }
  }
  process.stdout.write(JSON.stringify({ org, originals: originals.length, owed: owed.length, queued, apply }) + "\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    process.stderr.write(`doc:derive-backfill failed: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}

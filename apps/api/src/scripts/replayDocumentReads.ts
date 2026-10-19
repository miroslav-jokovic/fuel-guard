/**
 * `pnpm --filter @silvicom/api doc:replay -- --org <uuid> [--since YYYY-MM-DD] [--json]` — judge every stored
 * read of one organization again with today's code, and print what moved (READER-CORRECTNESS-PLAN RC2, D-RC2).
 *
 * A reader, table, witness or audit PR runs this against staging (and, with the owner's go, production) and
 * puts the summary in its description: how many reads were judged, how many fields changed state, which
 * fields went from needing a person to not needing one — the direction that can hide a misread (D-RC3) — and
 * which audit findings appeared or went. No model is called and nothing is written: `replayRead` is pure, and
 * this file only reads `document_reads` and prints.
 *
 * One organization per run, named on the command line: the service role bypasses RLS, so the query carries
 * the org itself, as every service query here does.
 *
 * stdout: the per-read lines, then ONE line of JSON summary (with `--json`, only that line).
 * stderr: progress and refusals.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isRecordId } from "@silvicom/shared";
import { loadEnv } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { replayRead, type ReplayResult, type StoredRead } from "../modules/document-reading/read/replay.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export interface ReplaySummary {
  org: string;
  reads: number;
  replayed: number;
  notReplayable: number;
  readsWithChanges: number;
  fieldsChanged: number;
  /** Fields a person had to look at before and need nothing now — each one must be explained in the PR. */
  relaxed: number;
  findingsChanged: number;
}

/** Today's statuses: `check` and `not_read` ask a person; only `read` does not (FIELD_STATUSES). */
const asksAPerson = (status: string | undefined) => status !== undefined && status !== "read";

export function summarise(org: string, results: readonly ReplayResult[]): ReplaySummary {
  const replayed = results.filter((r): r is Extract<ReplayResult, { replayable: true }> => r.replayable);
  const fields = replayed.flatMap((r) => r.fields);
  return {
    org,
    reads: results.length,
    replayed: replayed.length,
    notReplayable: results.length - replayed.length,
    readsWithChanges: replayed.filter((r) => r.fields.length > 0 || r.findings.length > 0).length,
    fieldsChanged: fields.length,
    relaxed: fields.filter((f) => asksAPerson(f.before?.status) && f.after?.status === "read").length,
    findingsChanged: replayed.reduce((n, r) => n + r.findings.length, 0),
  };
}

export function describe(r: ReplayResult): string {
  if (!r.replayable) return `${r.id}  not replayable: ${r.why}`;
  if (r.fields.length === 0 && r.findings.length === 0) return `${r.id}  unchanged`;
  const f = r.fields.map((c) => `    field ${c.path}: ${c.before?.status ?? "absent"} → ${c.after?.status ?? "absent"}`);
  const a = r.findings.map((c) => `    finding ${c.ruleId}${c.lineIndex === null ? "" : `[${c.lineIndex}]`}: ${c.before ? `${c.before.outcome}/${c.before.reason}` : "absent"} → ${c.after ? `${c.after.outcome}/${c.after.reason}` : "absent"}`);
  return [`${r.id}  ${r.fields.length} field(s), ${r.findings.length} finding(s) moved`, ...f, ...a].join("\n");
}

async function main(): Promise<void> {
  const org = arg("org");
  if (!org || !isRecordId(org)) throw new Error("--org <organization uuid> is required");
  const since = arg("since");
  if (since !== undefined && Number.isNaN(Date.parse(since))) throw new Error("--since YYYY-MM-DD");
  const json = process.argv.includes("--json");

  const admin = getSupabaseAdmin(loadEnv());
  let q = admin.from("document_reads").select("id, profile, result, evidence, replay_inputs")
    .eq("org_id", org).eq("status", "done").order("created_at", { ascending: true });
  if (since) q = q.gte("created_at", since);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const results = ((data ?? []) as StoredRead[]).map((row) => {
    process.stderr.write(`replaying ${row.id}\n`);
    return replayRead(row);
  });
  if (!json) for (const r of results) process.stdout.write(describe(r) + "\n");
  process.stdout.write(JSON.stringify(summarise(org, results)) + "\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    process.stderr.write(`doc:replay failed: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}

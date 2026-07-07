import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";
import { ingestReport, type IngestResult } from "./efsIngest.js";
import { readEfsBuffer, fileSourceFor } from "../lib/readEfsFile.js";
import { StorageSource, supabaseObjectStore, type Artifact, type IngestSource } from "../lib/ingestSource.js";

/**
 * Automated EFS ingestion glue: takes reports delivered to a source (Supabase Storage today), reads +
 * ingests each one through the same idempotent write path the manual upload uses (efsIngest.ts), and
 * moves the artifact to processed/ on success or error/ on any problem. Designed for unattended runs:
 * a single bad file is quarantined and reported, never silently dropped and never able to halt the batch.
 */

export type ArtifactOutcome =
  | { name: string; status: "ingested"; result: IngestResult }
  | { name: string; status: "quarantined"; reason: string };

export interface EfsIngestRunStats extends Record<string, unknown> {
  found: number;
  ingested: number;
  quarantined: number;
  newFuel: number;
  newDeclined: number;
  shortfalls: number;
  outcomes: ArtifactOutcome[];
}

/** SHA-256 hex of the raw bytes — the file-level idempotency key stored on imports.file_hash. */
export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Injected so the glue is unit-testable without a live Supabase/Samsara. */
export interface AutoIngestDeps {
  read: (filename: string, buf: Buffer) => Promise<{ headers: string[]; rows: Record<string, string | number | null | undefined>[] }>;
  ingest: (admin: SupabaseClient, env: Env, input: Parameters<typeof ingestReport>[2]) => Promise<IngestResult>;
}

const defaultDeps: AutoIngestDeps = {
  read: readEfsBuffer,
  ingest: (admin, env, input) => ingestReport(admin, env, input),
};

/**
 * Process one delivered artifact end-to-end. Returns its outcome; NEVER throws for a per-file problem
 * (unreadable bytes, unsupported extension, unrecognized report) — those quarantine the file so the
 * batch continues. Infrastructure errors from the source itself (e.g. a failed move) propagate.
 */
export async function ingestArtifact(
  admin: SupabaseClient,
  env: Env,
  source: IngestSource,
  artifact: Artifact,
  deps: AutoIngestDeps = defaultDeps,
): Promise<ArtifactOutcome> {
  const fileSource = fileSourceFor(artifact.name);
  if (!fileSource) {
    const reason = `unsupported file type: ${artifact.name}`;
    await source.quarantine(artifact, reason);
    return { name: artifact.name, status: "quarantined", reason };
  }

  let buf: Buffer;
  let parsed: { headers: string[]; rows: Record<string, string | number | null | undefined>[] };
  try {
    buf = await source.fetch(artifact);
    parsed = await deps.read(artifact.name, buf);
  } catch (e) {
    const reason = `unreadable file: ${e instanceof Error ? e.message : String(e)}`;
    await source.quarantine(artifact, reason);
    return { name: artifact.name, status: "quarantined", reason };
  }

  const result = await deps.ingest(admin, env, {
    orgId: artifact.orgId,
    requestedBy: null,
    source: fileSource,
    filename: artifact.name,
    fileHash: sha256Hex(buf),
    headers: parsed.headers,
    rows: parsed.rows,
    channel: "auto",
  });

  if (result.kind === "unknown") {
    const reason = "unrecognized report (not an EFS Transaction or Reject export)";
    await source.quarantine(artifact, reason);
    return { name: artifact.name, status: "quarantined", reason };
  }

  await source.markDone(artifact);
  return { name: artifact.name, status: "ingested", result };
}

/**
 * Run one ingestion pass for an org: list every delivered artifact and process each. Aggregates counts
 * for the jobs ledger / digest. The scheduler (Chunk 3) wraps this in a per-org `efs_ingest` job.
 */
export async function runEfsIngest(
  admin: SupabaseClient,
  env: Env,
  source: IngestSource,
  deps: AutoIngestDeps = defaultDeps,
): Promise<EfsIngestRunStats> {
  const artifacts = await source.list();
  const stats: EfsIngestRunStats = {
    found: artifacts.length,
    ingested: 0,
    quarantined: 0,
    newFuel: 0,
    newDeclined: 0,
    shortfalls: 0,
    outcomes: [],
  };

  for (const artifact of artifacts) {
    const outcome = await ingestArtifact(admin, env, source, artifact, deps);
    stats.outcomes.push(outcome);
    if (outcome.status === "ingested") {
      stats.ingested += 1;
      stats.newFuel += outcome.result.newFuel;
      stats.newDeclined += outcome.result.newDeclined;
      if (outcome.result.shortfallRows && outcome.result.shortfallRows > 0) stats.shortfalls += 1;
    } else {
      stats.quarantined += 1;
    }
  }
  return stats;
}

/** Build the configured source for an org, or null when auto-ingestion is disabled. */
export function buildIngestSource(admin: SupabaseClient, env: Env, orgId: string): IngestSource | null {
  if (env.EFS_INGEST_SOURCE === "storage") {
    return new StorageSource(supabaseObjectStore(admin, env.EFS_INGEST_BUCKET), orgId);
  }
  return null;
}

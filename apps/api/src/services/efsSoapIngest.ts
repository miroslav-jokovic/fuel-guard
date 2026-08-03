import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";
import { ingestReport, type IngestResult } from "./efsIngest.js";
import {
  getEfsSoapCredentials,
  upsertEfsSoapCredentials,
  recordFeedFailure,
  recordFeedSuccess,
  type FeedName,
} from "./efsSoapCredentials.js";
import {
  EfsSoapError,
  fetchPostedTransactions,
  fetchRejectedTransactions,
  type EfsSoapFetchResult,
} from "../lib/efsSoap.js";

/**
 * Bridge between the EFS SOAP source and the existing (idempotent, well-tested) ingest write path.
 *
 * The goal of this file is DELIBERATELY THIN: everything from row shape → efs_transactions storage
 * → fuel_transactions derived events → declined_transactions → scoring → shortfall reconciliation
 * already exists in efsIngest.ts (Phase 4.5 + 8.6 + 8.7). We only:
 *   1. Load credentials for the org (or bail if not configured / not enabled).
 *   2. Call the SOAP operation for the requested feed.
 *   3. Hand the returned rows to ingestReport() with source='efs_feed'.
 *   4. Advance the delta cursor on success; stamp the error on failure.
 *
 * No parsing, no field mapping, no scoring — those live where they already live. The SOAP layer
 * returns normalized rows and this bridge remains unchanged if EFS adds response fields.
 *
 * Idempotency: the SOAP response's SHA-256 is used as the imports.file_hash (same slot the XLSX
 * SHA-256 uses). Re-fetching the same cursor produces the same bytes → same hash → efsIngest sees
 * it as an already-imported file and no-ops. Cursor advancement is only recorded AFTER ingestReport
 * finishes successfully, so a mid-way crash safely retries.
 */

export interface EfsSoapIngestResult extends Record<string, unknown> {
  feed: FeedName;
  status: "ingested" | "empty" | "skipped_disabled" | "skipped_no_config" | "not_implemented" | "failed";
  pagesFetched: number;
  rowsFetched: number;
  ingest?: IngestResult;
  error?: string;
  cursorAdvancedTo?: string | null;
}

const SOURCE_FOR_INGEST = "efs_feed" as const;

/**
 * Run ONE ingest pass for one org + one feed. Called by the poller (§efsSoapPoller.ts) for each
 * scheduled tick and by the admin "Sync now" button. Never throws — every failure lands on the
 * returned result AND is persisted onto efs_soap_credentials via recordFeedFailure.
 */
export async function runEfsSoapIngest(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  feed: FeedName,
  opts: { maxPages?: number } = {},
): Promise<EfsSoapIngestResult> {
  // Master kill switch — never call EFS even if credentials exist.
  if (!env.EFS_SOAP_ENABLED) {
    return { feed, status: "skipped_disabled", pagesFetched: 0, rowsFetched: 0 };
  }

  const creds = await getEfsSoapCredentials(admin, env, orgId);
  if (!creds) {
    return { feed, status: "skipped_no_config", pagesFetched: 0, rowsFetched: 0 };
  }
  if (!creds.enabled) {
    return { feed, status: "skipped_disabled", pagesFetched: 0, rowsFetched: 0 };
  }

  // Railway env fallback credentials have no durable cursor row. Seed the service-role-only table on
  // the first enabled pass so subsequent polls persist cursors and restart/backfill safely. If migration
  // 0091 is missing, fail loudly instead of repeatedly requesting the first seven-day window.
  if (creds.fromEnvFallback) {
    try {
      await upsertEfsSoapCredentials(admin, orgId, {
        environment: creds.environment,
        endpointUrl: creds.endpointUrl,
        soapUsername: creds.soapUsername,
        soapPassword: creds.soapPassword,
        accountId: creds.accountId,
        enabled: true,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await recordFeedFailure(admin, orgId, feed, `EFS SOAP state migration 0091 is unavailable: ${msg}`);
      return { feed, status: "failed", pagesFetched: 0, rowsFetched: 0, error: msg };
    }
  }

  const cursor = feed === "posted" ? creds.postedLastCursor : creds.rejectedLastCursor;
  const priority = feed === "posted" ? "backfill" : "live";

  let result: EfsSoapFetchResult;
  try {
    result =
      feed === "posted"
        ? await fetchPostedTransactions(env, creds, cursor, { priority, maxPages: opts.maxPages ?? 1 })
        : await fetchRejectedTransactions(env, creds, cursor, { priority, maxPages: opts.maxPages ?? 1 });
  } catch (e) {
    if (e instanceof EfsSoapError && e.code === "not_implemented") {
      // Retained for safe rollout/rollback if an older operation implementation is deployed.
      await recordFeedFailure(admin, orgId, feed, "not_yet_implemented");
      return {
        feed,
        status: "not_implemented",
        pagesFetched: 0,
        rowsFetched: 0,
        error: e.message,
      };
    }
    const msg = e instanceof Error ? e.message : String(e);
    await recordFeedFailure(admin, orgId, feed, msg);
    return { feed, status: "failed", pagesFetched: 0, rowsFetched: 0, error: msg };
  }

  if (result.rows.length === 0) {
    // No new rows since the last cursor — advance nothing (the SOAP layer's nextCursor may still
    // change), stamp success, and move on. Do NOT create an empty `imports` row.
    await recordFeedSuccess(admin, orgId, feed, result.nextCursor ?? cursor);
    return {
      feed,
      status: "empty",
      pagesFetched: result.pagesFetched,
      rowsFetched: 0,
      cursorAdvancedTo: result.nextCursor ?? cursor,
    };
  }

  // Feed the rows through the existing write path. The header list is synthesized from the row
  // keys so ingestReport's report-kind detector (detectReportKind) picks the right kind. If the
  // SOAP layer returns rows whose keys don't match EFS report headers, ingestReport will land in
  // its 'unknown' branch — a visible failure, not a silent bad-write.
  const headers = Array.from(
    new Set(result.rows.flatMap((r) => Object.keys(r))),
  );
  let ingest: IngestResult;
  try {
    ingest = await ingestReport(admin, env, {
      orgId,
      requestedBy: null,
      source: SOURCE_FOR_INGEST,
      filename: `efs-soap-${feed}-${new Date().toISOString()}.xml`,
      fileHash: result.responseHash,
      headers,
      rows: result.rows,
      channel: "auto",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordFeedFailure(admin, orgId, feed, msg);
    return { feed, status: "failed", pagesFetched: result.pagesFetched, rowsFetched: result.rows.length, error: msg };
  }

  if (ingest.kind === "unknown") {
    const msg = "EFS SOAP response did not match the expected transaction/reject field signature";
    await recordFeedFailure(admin, orgId, feed, msg);
    return { feed, status: "failed", pagesFetched: result.pagesFetched, rowsFetched: result.rows.length, error: msg };
  }

  await recordFeedSuccess(admin, orgId, feed, result.nextCursor);
  return {
    feed,
    status: "ingested",
    pagesFetched: result.pagesFetched,
    rowsFetched: result.rows.length,
    ingest,
    cursorAdvancedTo: result.nextCursor,
  };
}

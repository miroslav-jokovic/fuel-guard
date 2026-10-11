import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSamsaraDocument, type SamsaraDocumentRow } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { loadSamsaraToken } from "./lib/samsaraToken.js";
import { makeSamsaraDocumentsFetcher, type SamsaraDocumentsFetcher } from "./lib/samsaraDocuments.js";
import { NoSamsaraTokenError } from "./samsaraVehicleSync.js";
import { orgsToSync, runOrgTier, startTier } from "./lib/tierRunner.js";

/**
 * The Samsara documents collector (DOCUMENT-READER-PLAN Step 0.1, D-DR12). Stages every document a
 * driver submits from Samsara's app into `samsara_documents` (0445) — the BOL photos, the delivery
 * copies and the call forms that carry the load number. Read-only against Samsara; writes nothing but
 * its own staging table.
 *
 * ── THE WATERMARK IS THE TABLE, NOT A CURSOR ─────────────────────────────────────────────────────
 * Each run asks for documents UPDATED since the newest `samsara_updated_at` already stored, less an
 * overlap. Nothing remembers a position separately, so nothing can disagree with what was written: a
 * run that fails half-way leaves the watermark at the last day it finished, and the next run repeats
 * from there. That is why the walk goes OLDEST day first and writes each day before asking for the
 * next — a newest-first walk that failed would leave the watermark ahead of a day never stored.
 *
 * ── WHY A DAY AT A TIME ──────────────────────────────────────────────────────────────────────────
 * Samsara pages this endpoint at ~32 rows. This carrier submits ~120 documents a day (measured
 * 2026-10-08: 3,786 in 30 days across all types), so a day is four pages, and the fetcher's 200-page
 * guard is a 6,400-document day — far past any fleet this size, and a hard stop rather than a partial
 * write if it is ever reached.
 *
 * ── THE OVERLAP ──────────────────────────────────────────────────────────────────────────────────
 * One hour. A document edited a few seconds before the previous run's end may carry an
 * `updatedAtTime` Samsara had not indexed yet; re-reading the last hour costs a page and refreshes
 * in place (the primary key is the document id), so it cannot duplicate.
 */

export const DOCUMENTS_OVERLAP_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface DocumentsSyncOptions {
  /** Injected in tests; the real fetcher is built from the org's token. */
  fetcherOverride?: SamsaraDocumentsFetcher;
  /** The clock, as a parameter. Never read here. */
  now: Date;
  /** How far back the FIRST run of an org reaches, in days. */
  backfillDays: number;
}

export interface DocumentsSyncResult {
  /** Where this run started, ISO — the stored watermark less the overlap, or the backfill horizon. */
  from: string;
  days: number;
  fetched: number;
  written: number;
  /** Items Samsara returned that `parseSamsaraDocument` refused (no id, no type, no time). */
  refused: number;
}

/** The day windows from `fromMs` to `nowMs`, oldest first, the last one ending at `nowMs`. Pure. */
export function documentWindows(fromMs: number, nowMs: number): Array<{ startIso: string; endIso: string }> {
  const out: Array<{ startIso: string; endIso: string }> = [];
  for (let start = fromMs; start < nowMs; start += DAY_MS) {
    const end = Math.min(start + DAY_MS, nowMs);
    out.push({ startIso: new Date(start).toISOString(), endIso: new Date(end).toISOString() });
  }
  return out;
}

async function watermarkMs(admin: SupabaseClient, orgId: string): Promise<number | null> {
  const { data, error } = await admin
    .from("samsara_documents")
    .select("samsara_updated_at")
    .eq("org_id", orgId)
    .order("samsara_updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`samsara_documents watermark: ${error.message}`);
  const at = (data as { samsara_updated_at?: string } | null)?.samsara_updated_at;
  return at ? Date.parse(at) : null;
}

/** Every column, every time: `lint:upserts` forbids a partial payload, and this one is whole. */
function toRow(orgId: string, doc: SamsaraDocumentRow, seenAt: string) {
  return { org_id: orgId, ...doc, last_seen_at: seenAt };
}

export async function syncSamsaraDocuments(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  options: DocumentsSyncOptions,
): Promise<DocumentsSyncResult> {
  const token = options.fetcherOverride ? "test" : await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();
  const fetcher = options.fetcherOverride ?? makeSamsaraDocumentsFetcher(env, token);

  const nowMs = options.now.getTime();
  const stored = await watermarkMs(admin, orgId);
  const horizon = nowMs - options.backfillDays * DAY_MS;
  // A watermark older than the horizon (the tier was off for months) still resumes from the
  // watermark: the horizon bounds the FIRST run only, and skipping a gap silently is the one failure
  // this collector exists to prevent.
  const fromMs = stored !== null ? Math.min(stored - DOCUMENTS_OVERLAP_MS, nowMs) : horizon;
  const seenAt = options.now.toISOString();

  const result: DocumentsSyncResult = { from: new Date(fromMs).toISOString(), days: 0, fetched: 0, written: 0, refused: 0 };
  for (const window of documentWindows(fromMs, nowMs)) {
    const items = await fetcher(window);
    result.days += 1;
    result.fetched += items.length;
    const rows = [];
    for (const item of items) {
      const doc = parseSamsaraDocument(item);
      if (doc) rows.push(toRow(orgId, doc, seenAt));
      else result.refused += 1;
    }
    if (rows.length > 0) {
      const { error } = await admin
        .from("samsara_documents")
        .upsert(rows, { onConflict: "org_id,samsara_document_id" });
      if (error) throw new Error(`samsara_documents upsert: ${error.message}`);
      result.written += rows.length;
    }
  }
  return result;
}


/**
 * Tier 3d — DRIVER DOCUMENTS. Registered by `startSamsaraScheduler`, kept here beside its run so the
 * scheduler file stays under its budget. Its own job kind (`sync_documents`) for the ledger and the
 * (org, kind) mutex. First tick at four minutes: after the deploy window
 * (docs/MIGRATION-DISCIPLINE.md §the-deploy-window), since a tick that lands before 0445 is applied
 * fails its run and is simply repeated, but there is no reason to spend one.
 */
export function startDocumentsTier(env: Env): void {
  startTier(env, "documents", 240_000, env.SAMSARA_DOCUMENTS_SYNC_MINUTES * 60_000, async (admin) => {
    for (const orgId of await orgsToSync(admin, env)) {
      await runOrgTier(admin, env, orgId, "sync_documents", async () => {
        const r = await syncSamsaraDocuments(admin, env, orgId, {
          now: new Date(),
          backfillDays: env.SAMSARA_DOCUMENTS_BACKFILL_DAYS,
        });
        return { ...r };
      });
    }
  });
}

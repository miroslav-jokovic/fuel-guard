import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PilotPriceMail, PilotPriceMailState } from "@silvicom/shared";
import type { FolderMessage, GraphFolderReader } from "../../lib/graphFolder.js";
import { readXlsxGrid, type Cell } from "../../lib/xlsxGrid.js";
import { findPilotQuoteLink } from "./pilotQuoteLink.js";
import type { QuoteDownload } from "./pilotQuoteDownload.js";
import type { PilotIngestResult } from "./pilotPriceIngest.js";

/**
 * Pilot daily price emails → `fuel_prices`, without a person (PILOT-PRICE-MAIL-PLAN).
 *
 * Each run lists the folder's last week of mail, and for every email from Pilot's pricing sender decides from
 * its row in `pilot_price_mails` (0635) whether there is anything to do: follow the quote link, read the file,
 * load it through `ingestPilotPrices` — the SAME function a manual upload calls, so an emailed quote and an
 * uploaded one cannot load differently — and record what happened. The mailbox is never changed.
 *
 * ── WHEN AN EMAIL IS TRIED AGAIN ─────────────────────────────────────────────────────────────────────
 * Only while its link can still work (Pilot: "valid for up to 48 hours"; measured, an expired link redirects
 * to the customer portal's sign-in), and only for:
 *   - `failed` — a network error, a Pilot outage, a file that would not load: up to MAX_ATTEMPTS tries;
 *   - `loaded` with sites still waiting for a map position — `ingestPilotPrices` geocodes new sites within a
 *     time budget and prices only the placed ones, so a re-load inside the link's life fills in the rest
 *     (the same thing a person re-uploading the file would do; the re-load is a no-op for prices already in).
 * `expired` and `no_link` are final: nothing about the email will change.
 */

/** The owner's folder (2026-11-17), exact name. A rename in Outlook stops the feed; the run says so loudly. */
export const PILOT_PRICE_FOLDER = "Pilot Flying J Pricing";
/** Pilot's pricing sender, measured on every message in the folder since 11/11. Other mail there is ignored. */
export const PILOT_PRICE_SENDER = "daily.pricing@pilottravelcenters.com";
/** How far back each run looks: long enough that a week-long outage still leaves a row for every missed email. */
export const LOOKBACK_MS = 7 * 24 * 3_600_000;
/** Pilot's 48 hours, plus an hour for clock difference between their mail server and ours. */
export const LINK_LIFE_MS = 49 * 3_600_000;
export const MAX_ATTEMPTS = 12;

export interface PilotPriceMailDeps {
  reader: GraphFolderReader;
  download: (link: string) => Promise<QuoteDownload>;
  ingest: (grid: Cell[][]) => Promise<PilotIngestResult>;
  now: () => Date;
}

export interface PilotPriceMailRun {
  listed: number;
  /** Mail in the folder not from Pilot's pricing sender. */
  ignored: number;
  /** Emails with nothing left to do. */
  settled: number;
  loaded: number;
  failed: number;
  expired: number;
  noLink: number;
}

interface LedgerRow {
  id: string;
  internet_message_id: string;
  state: PilotPriceMailState;
  attempts: number;
  geocode_pending: number | null;
}

type Outcome = Record<string, unknown> & { state: LedgerRow["state"] };

/** Whether this email needs work now, given its row (or none) and the time. Pure; exported for the tests. */
export function needsWork(row: LedgerRow | undefined, receivedAt: string, now: Date): boolean {
  if (!row) return true; // never seen — even an old one gets its row, so a missed email is visible as `expired`
  const linkAlive = now.getTime() - new Date(receivedAt).getTime() <= LINK_LIFE_MS;
  if (!linkAlive) return false;
  if (row.state === "failed") return row.attempts < MAX_ATTEMPTS;
  if (row.state === "loaded") return (row.geocode_pending ?? 0) > 0 && row.attempts < MAX_ATTEMPTS;
  return false;
}

async function handle(msg: FolderMessage, deps: PilotPriceMailDeps): Promise<Outcome> {
  const link = findPilotQuoteLink(msg.body);
  if (!link) return { state: "no_link", error: "The email has no link to Pilot's document service." };
  let dl: QuoteDownload;
  try {
    dl = await deps.download(link);
  } catch (e) {
    return { state: "failed", error: `Download failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!dl.ok) return { state: dl.expired ? "expired" : "failed", error: dl.error };
  const meta = { file_name: dl.fileName, file_sha256: createHash("sha256").update(dl.bytes).digest("hex") };
  let grid: Cell[][];
  try {
    grid = await readXlsxGrid(dl.bytes);
  } catch (e) {
    return { state: "failed", ...meta, error: `The file would not open: ${e instanceof Error ? e.message : String(e)}` };
  }
  const r = await deps.ingest(grid);
  const counts = {
    effective_date: r.effectiveDate, sites: r.uniqueSites, skipped_rows: r.skipped, geocode_pending: r.geocodeFailed,
  };
  if (!r.ok) return { state: "failed", ...meta, ...counts, error: r.error ?? "The quote would not load." };
  return { state: "loaded", ...meta, ...counts, prices_loaded: r.pricesInserted, error: null };
}

export async function runPilotPriceMail(admin: SupabaseClient, orgId: string, deps: PilotPriceMailDeps): Promise<PilotPriceMailRun> {
  const now = deps.now();
  const listed = await deps.reader.listSince(PILOT_PRICE_FOLDER, new Date(now.getTime() - LOOKBACK_MS));
  const fromPilot = listed.filter((m) => m.from === PILOT_PRICE_SENDER);
  const run: PilotPriceMailRun = { listed: listed.length, ignored: listed.length - fromPilot.length, settled: 0, loaded: 0, failed: 0, expired: 0, noLink: 0 };
  if (fromPilot.length === 0) return run;

  const { data, error } = await admin
    .from("pilot_price_mails")
    .select("id, internet_message_id, state, attempts, geocode_pending")
    .eq("org_id", orgId)
    .in("internet_message_id", fromPilot.map((m) => m.internetMessageId));
  if (error) throw new Error(`pilot_price_mails read failed: ${error.message}`);
  const byMessage = new Map(((data ?? []) as LedgerRow[]).map((r) => [r.internet_message_id, r]));

  for (const msg of fromPilot) {
    const row = byMessage.get(msg.internetMessageId);
    if (!needsWork(row, msg.receivedAt, now)) {
      run.settled++;
      continue;
    }
    let outcome = await handle(msg, deps);
    // A loaded email stays loaded: its prices are in. A re-load for the remaining map positions that fails
    // only notes why, it never turns a delivered quote into "failed" or "expired".
    if (row?.state === "loaded" && outcome.state !== "loaded") {
      outcome = { state: "loaded", error: `Re-load for sites without a map position did not run: ${String(outcome.error)}` };
    }
    const stamp = { ...outcome, last_tried_at: now.toISOString() };
    const write = row
      ? admin.from("pilot_price_mails").update({ ...stamp, attempts: row.attempts + 1 }).eq("org_id", orgId).eq("id", row.id)
      : admin.from("pilot_price_mails").insert({
          ...stamp, org_id: orgId, internet_message_id: msg.internetMessageId, subject: msg.subject.slice(0, 500), received_at: msg.receivedAt,
        });
    const { error: writeError } = await write;
    if (writeError) throw new Error(`pilot_price_mails write failed: ${writeError.message}`);
    if (outcome.state === "loaded") run.loaded++;
    else if (outcome.state === "failed") run.failed++;
    else if (outcome.state === "expired") run.expired++;
    else run.noLink++;
  }
  return run;
}

/** An org's newest handled emails, for the price drawer (newest first). */
export async function readPilotPriceMails(admin: SupabaseClient, orgId: string, limit = 14): Promise<PilotPriceMail[]> {
  const { data, error } = await admin
    .from("pilot_price_mails")
    .select("subject, received_at, state, attempts, effective_date, prices_loaded, sites, geocode_pending, error, last_tried_at")
    .eq("org_id", orgId)
    .order("received_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`pilot_price_mails read failed: ${error.message}`);
  return (data ?? []) as PilotPriceMail[];
}

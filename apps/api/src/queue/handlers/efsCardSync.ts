import { getEfsSoapCredentials } from "../../modules/efs/services/efsSoapCredentials.js";
import { syncEfsCards } from "../../modules/efs/services/efsCardMirror.js";
import { pollEfsCardStatus } from "../../modules/efs/services/efsCardStatusPoll.js";
import { sendCardStatusSummary } from "../../modules/efs/services/cardStatusSummary.js";
import { resolveUnresolvedMutations } from "../../modules/efs/services/efsCardUnresolved.js";
import type { JobHandler } from "../types.js";

/**
 * Refresh one org's EFS card mirror.
 *
 * Idempotent by construction, which the queue requires: every write is an upsert on
 * `(org_id, card_ref_hmac)`, so running twice produces the same rows. There is no cursor to advance
 * and nothing to double-count — a re-run just re-reads the vendor.
 *
 * Capped at ONE in flight fleet-wide (`KIND_CAPS` in worker.ts), for the same reason the EFS feed
 * kinds are: this dials a rate-paced vendor on a shared service account, and the guide warns that
 * excessive polling can lead to account suspension by WEX IT (p11).
 */
export const efsCardSyncHandler: JobHandler = async (ctx, job) => {
  const creds = await getEfsSoapCredentials(ctx.admin, ctx.env, job.org_id);
  if (!creds || !creds.enabled) {
    // Not an error: an org can have card control off, or SOAP disabled, and the scheduler is
    // deliberately not the thing that decides. Returning cleanly keeps the job ledger honest.
    return { status: "skipped", reason: "efs_soap_disabled" };
  }

  const result = await syncEfsCards(ctx.admin, ctx.env, creds, {
    maxDetail: ctx.env.EFS_CARD_SYNC_MAX_DETAIL,
  });

  // A sweep that did ZERO work AND failed is a failed job, not a done one (audit P2). The
  // total-failure shapes — SECRETS_ENCRYPTION_KEY unset, or the mirror read that aborts the whole
  // sweep — return `upserted:0, failed>0` and, recorded as `done`, would suppress the retry cadence
  // for a full interval while nothing happened. Throw so the job ledger reflects reality and the
  // next run is scheduled. A PARTIAL failure (some cards upserted, some failed) is genuinely
  // done-with-warnings and stays non-fatal — one unreadable card must not abandon the other 399.
  if (result.upserted === 0 && result.failed > 0) {
    throw new Error(
      `[efs-cards] org ${job.org_id}: sweep did no work — ${result.errors.slice(0, 3).join("; ") || "no cards upserted"}`,
    );
  }
  if (result.failed > 0) {
    // Visible, but not fatal: one unreadable card must not abandon the other 399. The per-card
    // `sync_error` column carries the detail to the UI; this line is for the operator watching logs.
    console.error(
      `[efs-cards] org ${job.org_id}: ${result.failed} card(s) failed — ${result.errors.slice(0, 3).join("; ")}`,
    );
  } else {
    console.log(
      `[efs-cards] org ${job.org_id}: ${result.upserted} card(s), ${result.detailed} detailed, ${result.linked} linked`,
    );
  }
  // The sweep just refreshed the fleet's documents — the cheapest possible moment to also settle
  // ledger rows stuck in 'sent'/'pending' (audit P1-3): the evidence is one backfill-lane read away
  // and the 0179 unique index means a stale pending row is BLOCKING its card until someone does.
  const unresolved = await resolveUnresolvedMutations(ctx.admin, ctx.env, creds, { maxVendorReads: 10 });
  if (unresolved.errors.length > 0) {
    console.error(`[efs-cards] org ${job.org_id}: reconciler — ${unresolved.errors.slice(0, 3).join("; ")}`);
  }
  if (unresolved.reconciledSucceeded + unresolved.reconciledFailed + unresolved.abandonedPending > 0) {
    console.log(
      `[efs-cards] org ${job.org_id}: reconciled ${unresolved.reconciledSucceeded} landed, ` +
        `${unresolved.reconciledFailed} no_change, ${unresolved.abandonedPending} abandoned pending`,
    );
  }

  // Spread into a plain record: JobHandler's return type is the ledger's `stats` jsonb.
  return { ...result, unresolved: { ...unresolved, errors: unresolved.errors.slice(0, 5) } };
};

/**
 * The status poll (EFS audit, 2026-09-30) — see `efsCardStatusPoll.ts`. Idempotent for the same
 * reason the sweep is: every write is keyed on the card, and a re-run re-reads the vendor. Throws
 * only when the roster itself could not be read, so a vendor outage shows as failed runs rather than
 * as a clean ledger over a page that stopped updating.
 */
export const efsCardStatusHandler: JobHandler = async (ctx, job) => {
  const creds = await getEfsSoapCredentials(ctx.admin, ctx.env, job.org_id);
  if (!creds || !creds.enabled) return { status: "skipped", reason: "efs_soap_disabled" };
  const result = await pollEfsCardStatus(ctx.admin, ctx.env, creds);
  if (result.cardsSeen > 0 && result.failed >= result.cardsSeen) {
    throw new Error(`[efs-cards] org ${job.org_id}: status poll wrote nothing — ${result.errors.slice(0, 3).join("; ")}`);
  }
  if (result.statusChanges > 0 || result.newCards > 0 || result.failed > 0) {
    console.log(
      `[efs-cards] org ${job.org_id}: status poll — ${result.statusChanges} changed ` +
        `(${result.externalChanges} outside Silvicom 360${result.refused ? ", HELD by the ratio guard" : ""}), ` +
        `${result.newCards} new, ${result.failed} failed`,
    );
  }
  // The daily summary (Q-F3, chunk 3b) rides the poll rather than a scheduler of its own. Its own
  // failure must not mark a poll that worked as failed: the next poll, five minutes on, tries again.
  let summary: Record<string, unknown> | null = null;
  try {
    summary = { ...(await sendCardStatusSummary(ctx.admin, job.org_id, new Date())) };
  } catch (error) {
    console.error(`[efs-cards] org ${job.org_id}: card status summary — ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ...result, errors: result.errors.slice(0, 5), summary };
};


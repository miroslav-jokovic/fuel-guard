import { getEfsSoapCredentials } from "../../efsSoapCredentials.js";
import { syncEfsCards } from "../../efsCardMirror.js";
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
    maxDetail: ctx.env.EFS_CARD_SYNC_MAX_DETAIL ?? 200,
  });

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
  // Spread into a plain record: JobHandler's return type is the ledger's `stats` jsonb.
  return { ...result };
};

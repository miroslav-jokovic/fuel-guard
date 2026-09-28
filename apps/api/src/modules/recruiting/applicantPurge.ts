import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APPLICATION_CAPTURES_BUCKET,
  DOCUMENTS_BUCKET,
  purgeNameMatches,
  type ApplicantPurgeResult,
} from "@silvicom/shared";
import { writeAudit } from "../../lib/audit.js";

/**
 * Deleting an applicant outright (Q-AW40, P2) — the reader of migration 0380's `purge_applicant`.
 *
 * ── THE ORDER, AND WHY ────────────────────────────────────────────────────────────────────────────
 *  1. Read the row, org-scoped. It must be ARCHIVED: archiving is the reversible step and deleting the
 *     irreversible one, so the second is only offered once the first has been taken — the Recruitment
 *     board shows "Delete permanently…" on its Archived view and nowhere else, and this refusal is
 *     that same rule where it cannot be skipped.
 *  2. The typed name must be the applicant's (`purgeNameMatches`), checked HERE and not only in the
 *     browser, because a request can be sent without the screen.
 *  3. The RPC. Every other refusal is 0380's — ever hired, rows it does not own, a linked identity,
 *     another carrier, not an admin — and is mapped to a sentence below, never re-derived here.
 *  4. Storage, AFTER the commit. 0380 returns the paths it removed rows for, keyed by table, so
 *     nothing has to be read first (a read-then-purge would race a capture confirmed in between).
 *     A file that cannot be removed is NAMED in the result and the audit row: an orphaned object with
 *     no row is findable; the reverse, a row whose file was deleted first, is what the order prevents.
 *  5. `driver.purged`: ids and counts, never the name (Q-AW44 is about the rows that already carry it).
 *
 * ⚠ The bucket per table is the api's knowledge, not the schema's: `documents` and the adopted
 * signatures live in the evidence bucket (0376 registers an adoption's PNG there), captures in their
 * own. `drivers.photo_path` has no writer and no bucket anywhere in the product (0098 added the column
 * and nothing followed), so a path found there is reported as not removed rather than guessed at.
 */

const BUCKET_BY_TABLE: Record<string, string> = {
  documents: DOCUMENTS_BUCKET,
  signature_adoptions: DOCUMENTS_BUCKET,
  application_captures: APPLICATION_CAPTURES_BUCKET,
};

/** 0380's errcodes → the answer the screen shows. */
const REFUSALS: Record<string, { status: number; code: string; message: string }> = {
  PA010: {
    status: 409,
    code: "was_hired",
    message: "This person was hired. A driver's qualification file is kept for the length of employment plus three years, so it can't be deleted.",
  },
  PA011: {
    status: 409,
    code: "has_records",
    message: "This person has records outside their application (fuel, hours, loads or a DQ export), so they can't be deleted.",
  },
  PA012: {
    status: 409,
    code: "linked",
    message: "This person has a driver-app login or a McLeod, Samsara or EFS link, so they can't be deleted.",
  },
  PA020: { status: 404, code: "not_found", message: "Applicant not found" },
  PA030: { status: 403, code: "forbidden", message: "Only an admin can delete an applicant." },
};

export type PurgeOutcome =
  | { ok: true; result: ApplicantPurgeResult }
  | { ok: false; status: number; code: string; message: string };

interface PurgeRpcResult {
  counts: Record<string, number>;
  storage: Record<string, string[]>;
}

export async function purgeApplicant(
  admin: SupabaseClient,
  input: { orgId: string; actorId: string; driverId: string; confirmName: string },
): Promise<PurgeOutcome> {
  const { orgId, actorId, driverId } = input;

  const { data: row, error: readError } = await admin
    .from("drivers")
    .select("id, full_name, archived_at")
    .eq("id", driverId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (readError) return { ok: false, status: 500, code: "db_error", message: "Could not load the applicant." };
  const driver = row as { id: string; full_name: string | null; archived_at: string | null } | null;
  if (!driver) return { ok: false, ...REFUSALS.PA020! };
  if (driver.archived_at === null) {
    return { ok: false, status: 409, code: "not_archived", message: "Archive this applicant first. Deleting is offered only for an archived applicant." };
  }
  if (!purgeNameMatches(input.confirmName, driver.full_name)) {
    return { ok: false, status: 400, code: "name_mismatch", message: "The name you typed doesn't match this applicant's name." };
  }

  const { data, error } = await admin.rpc("purge_applicant", { p_org: orgId, p_driver: driverId, p_actor: actorId });
  if (error) {
    const refusal = REFUSALS[(error as { code?: string }).code ?? ""];
    if (refusal) return { ok: false, ...refusal };
    return { ok: false, status: 500, code: "purge_failed", message: "Could not delete the applicant. Nothing was deleted." };
  }
  const purged = data as PurgeRpcResult;

  let storageRemoved = 0;
  const storageNotRemoved: string[] = [];
  for (const [table, paths] of Object.entries(purged.storage ?? {})) {
    if (paths.length === 0) continue;
    const bucket = BUCKET_BY_TABLE[table];
    if (!bucket) {
      storageNotRemoved.push(...paths);
      continue;
    }
    const { error: removeError } = await admin.storage.from(bucket).remove(paths);
    if (removeError) storageNotRemoved.push(...paths);
    else storageRemoved += paths.length;
  }

  const audited = await writeAudit(admin, {
    orgId,
    actorId,
    action: "driver.purged",
    entity: "drivers",
    entityId: driverId,
    meta: { counts: purged.counts, storageRemoved, storageNotRemoved },
  });
  if (!audited) {
    // The delete has committed and cannot be undone; the log line is the record of last resort.
    console.error("[purge] driver.purged audit row not written", { orgId, actorId, driverId, counts: purged.counts });
  }

  return { ok: true, result: { counts: purged.counts, storageRemoved, storageNotRemoved, audited } };
}

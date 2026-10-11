import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  compareFleetParity,
  describeParityFinding,
  parityFindingKey,
  type DerivedMakeModel,
  type ParityOurRow,
  type TmsRosterCheckpoint,
} from "@silvicom/shared";
import { fetchAllPaged } from "../../lib/paging.js";
import { notify } from "../messaging/index.js";
import { usersWhoManage } from "../org/index.js";

/**
 * The fleet-parity check, run after every roster read (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md FL2,
 * D-FL2). The comparison itself is `compareFleetParity` in @silvicom/shared; this file gathers its
 * inputs, tells the fleet managers, and returns the summary the roster checkpoint stores.
 *
 * ── ONE NOTIFICATION PER CHANGE IN THE PICTURE, NOT PER SWEEP ───────────────────────────────────
 * The agent reads McLeod every two minutes. A disagreement that stands for a week must not buzz a
 * phone 5,040 times, and one that is fixed must not leave the others unannounced. So the dedupe key
 * is a hash of the whole set of findings (values included): the same set again is silent, any change
 * — a new disagreement, one fixed, a value moved — sends the current list once. Silence is the pass:
 * no findings, no notification, and the known sold trucks alone never send one.
 *
 * Recipients are whoever may MANAGE the equipment section — the section `vehicles_write` and
 * `trailers_write` are gated on — derived from the matrix by `usersWhoManage`, never listed here.
 */

/** What the roster checkpoint stores beside its counts (`org_integrations.config.parity`). */
export type ParitySummary =
  | { checked: false; reason: string }
  | { checked: true; at: string; findings: string[]; known: string[]; notified: boolean };

/** Lines in one notification before "and N more" — enough to act on, short enough to read. */
const MAX_LINES = 12;

async function deriveMcleodMakeModel(admin: SupabaseClient, rows: NonNullable<TmsRosterCheckpoint["tractors"]>): Promise<DerivedMakeModel> {
  // 0402's function — the one make/model rule, so McLeod's `FRHT`/`CA` is compared as what it means.
  const { data, error } = await admin.rpc("vehicle_make_model_derive", {
    p_rows: rows.map((r) => ({ key: r.external_id, vin: r.vin ?? null, make: r.make ?? null, model: r.model ?? null })),
  });
  if (error) throw new Error(`fleet parity: make/model derivation failed: ${error.message}`);
  return new Map(((data ?? []) as { key: string; make: string | null; model: string | null }[]).map((d) => [d.key, { make: d.make, model: d.model }]));
}

async function loadOurs(admin: SupabaseClient, orgId: string) {
  const [vehicles, trailers] = await Promise.all([
    fetchAllPaged<Omit<ParityOurRow, "link"> & { mcleod_tractor_id: string | null }>((a, b) =>
      admin
        .from("vehicles")
        .select("id, unit_number, mcleod_tractor_id, status, vin, year, purchased_at, make, model, samsara_name")
        .eq("org_id", orgId)
        .order("id")
        .range(a, b),
    ),
    fetchAllPaged<Omit<ParityOurRow, "link"> & { mcleod_trailer_id: string | null }>((a, b) =>
      admin
        .from("trailers")
        .select("id, unit_number, mcleod_trailer_id, status, vin, year, purchased_at")
        .eq("org_id", orgId)
        .order("id")
        .range(a, b),
    ),
  ]);
  return {
    vehicles: vehicles.map(({ mcleod_tractor_id, ...r }) => ({ ...r, link: mcleod_tractor_id })),
    trailers: trailers.map(({ mcleod_trailer_id, ...r }) => ({ ...r, link: mcleod_trailer_id })),
  };
}

export async function runFleetParity(
  admin: SupabaseClient,
  orgId: string,
  checkpoint: TmsRosterCheckpoint,
  now: Date = new Date(),
): Promise<ParitySummary> {
  if (!checkpoint.tractors || !checkpoint.trailers) {
    // An agent from before FL2. Absence is not an empty fleet — reading it as one would call every
    // truck we carry "not in McLeod".
    return { checked: false, reason: "The McLeod agent sent counts only; update it to send the lists." };
  }
  const [derived, ours] = await Promise.all([deriveMcleodMakeModel(admin, checkpoint.tractors), loadOurs(admin, orgId)]);
  const result = compareFleetParity({
    tractors: { mcleod: checkpoint.tractors, ours: ours.vehicles, derived },
    trailers: { mcleod: checkpoint.trailers, ours: ours.trailers },
  });
  const findings = result.findings.map(describeParityFinding);
  const known = result.known.map((k) => k.unit);
  if (findings.length === 0) return { checked: true, at: now.toISOString(), findings, known, notified: false };

  const hash = createHash("sha256")
    .update(result.findings.map(parityFindingKey).sort().join("\n"))
    .digest("hex")
    .slice(0, 16);
  const shown = findings.slice(0, MAX_LINES);
  const more = findings.length - shown.length;
  const body = [
    ...shown,
    ...(more > 0 ? [`…and ${more} more.`] : []),
    ...(known.length ? [`Sold, awaiting pickup (expected, not a problem): ${known.join(", ")}.`] : []),
  ].join("\n");

  const users = await usersWhoManage(admin, orgId, "equipment");
  let notified = false;
  for (const userId of users) {
    // emit_notification applies entitlement, mutes, quiet hours and the dedupe key; the same key to
    // every recipient, one row each.
    const id = await notify(admin, {
      orgId,
      userId,
      category: "system",
      title: findings.length === 1 ? "Fleet list differs from McLeod" : `Fleet list differs from McLeod in ${findings.length} places`,
      body,
      severity: "warning",
      entityType: "integration",
      entityId: null,
      dedupeKey: `fleet-parity:${orgId}:${hash}`,
    });
    notified ||= id !== null;
  }
  return { checked: true, at: now.toISOString(), findings, known, notified };
}

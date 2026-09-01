import type { SupabaseClient } from "@supabase/supabase-js";
import type { InspectionSubjectType } from "@silvicom/shared";

/**
 * The equipment side of the §396.17 annual inspection, as `roster` exposes it (D-AVI9, D-AVI10).
 *
 * `vehicles` and `trailers` belong to this module (docs/ARCHITECTURE.md §3), so `maintenance` reads
 * and projects through here rather than reaching for `.from("vehicles")`. Two functions, and the
 * second one is the interesting half.
 */

/**
 * Both tables are named as LITERALS in every query below, and the branch is written out twice
 * rather than indexed from a map.
 *
 * A `\`.from(TABLE[subjectType])\`` is shorter and `check-table-access.mjs` rejects it, correctly:
 * a dynamic table name is invisible to every gate this repo has for ownership, layering and write
 * sites, so the tidier version would have made these two tables silently unguarded. Duplication that
 * a gate can read beats indirection that it cannot.
 */
export interface EquipmentIdentity {
  id: string;
  unitNumber: string;
  vin: string | null;
  plate: string | null;
  /**
   * Trailers only; null for a tractor and for a trailer whose type nobody has recorded.
   *
   * The inspection seeds a different checklist for a reefer, because a reefer has an engine and a
   * fuel tank and a dry van does not — 46 of 211 trailers are reefers and 152 carry no type at all
   * (measured 2026-08-31), so this is the difference between a form that opens right and one that
   * pre-marks an inspection of parts that are not there.
   */
  isReefer: boolean | null;
}

export type EquipmentError = { error: string; code: string };

/** What the report's header needs to identify the vehicle — §396.21(a)(4). */
export async function getEquipmentIdentity(
  admin: SupabaseClient,
  orgId: string,
  subjectType: InspectionSubjectType,
  subjectId: string,
): Promise<EquipmentIdentity | null | EquipmentError> {
  const { data, error } =
    subjectType === "tractor"
      ? await admin.from("vehicles").select("id, unit_number, vin, plate").eq("org_id", orgId).eq("id", subjectId).maybeSingle()
      : await admin.from("trailers").select("id, unit_number, vin, plate, is_reefer").eq("org_id", orgId).eq("id", subjectId).maybeSingle();
  if (error) return { error: "Could not load the equipment record", code: "db_error" };
  if (!data) return null;
  const row = data as {
    id: string;
    unit_number: string;
    vin: string | null;
    plate: string | null;
    is_reefer?: boolean | null;
  };
  return {
    id: row.id,
    unitNumber: row.unit_number,
    vin: row.vin,
    plate: row.plate,
    isReefer: subjectType === "trailer" ? (row.is_reefer ?? null) : null,
  };
}

/**
 * The same identity for a page full of them.
 *
 * The inspection list shows a unit number per row and `subject_id` is a uuid, which is not something
 * anybody can read. PostgREST cannot join it — the subject is polymorphic across two tables (the
 * `documents` precedent) — so the caller reads the ids it has and maps them here, once, rather than
 * once per row.
 */
export async function getEquipmentIdentities(
  admin: SupabaseClient,
  orgId: string,
  subjectType: InspectionSubjectType,
  ids: readonly string[],
): Promise<Map<string, EquipmentIdentity> | EquipmentError> {
  if (ids.length === 0) return new Map();
  const unique = [...new Set(ids)];
  const { data, error } =
    subjectType === "tractor"
      ? await admin.from("vehicles").select("id, unit_number, vin, plate").eq("org_id", orgId).in("id", unique)
      : await admin.from("trailers").select("id, unit_number, vin, plate").eq("org_id", orgId).in("id", unique);
  if (error) return { error: "Could not load the equipment records", code: "db_error" };
  const rows = (data ?? []) as Array<{ id: string; unit_number: string; vin: string | null; plate: string | null }>;
  return new Map(
    rows.map(
      (r) => [r.id, { id: r.id, unitNumber: r.unit_number, vin: r.vin, plate: r.plate, isReefer: null }] as const,
    ),
  );
}

/**
 * Project a finalized inspection's expiry onto the equipment row, and CLAIM the row while doing it.
 *
 * ── THE CLAIM IS THE WHOLE POINT, AND IT IS EASY TO GET WRONG ──────────────────────────────────
 * `dot_annual_inspection_expires_at` has two would-be authors. The McLeod collector derives it on
 * every sweep from that system's `inspection_date` (`mcleod/rosterFields.ts:88-96`), and now so does
 * this. D-ARC3's sharpest finding was a compliance fact living in two unsynchronised places, so the
 * ruling (plan §1.1) is that Silvicom wins for a unit it has actually inspected.
 *
 * The mechanism already exists: `rosterIngest` skips any row whose `identity_source` is not in its
 * CLAIMABLE set, so a row marked 'manual' is left alone and counted as `skippedOwned`. What does NOT
 * work is relying on 0241's trigger to set that — the trigger exempts the SERVICE ROLE
 * (`auth_role() is null → return new`), and this runs as the service role like every other API path.
 * So the claim is written explicitly here, the way `resolveDriverUpdate` writes its own.
 *
 * Miss that line and everything still passes: the column gets its date, the tests go green, and the
 * next McLeod sweep that carries an inspection date silently replaces an office-entered expiry with
 * a TMS one. Measured 2026-08-31, production has 0 of 406 rows carrying either value, so this is
 * being fixed before the dual source exists rather than after — which is the only difference between
 * this and the CDL/medical finding D-ARC3 was written about.
 */
export async function recordEquipmentInspectionExpiry(
  admin: SupabaseClient,
  orgId: string,
  subjectType: InspectionSubjectType,
  subjectId: string,
  expiresAt: string,
): Promise<{ ok: true } | EquipmentError> {
  const patch = { dot_annual_inspection_expires_at: expiresAt, identity_source: "manual" };
  const { error } =
    subjectType === "tractor"
      ? await admin.from("vehicles").update(patch).eq("org_id", orgId).eq("id", subjectId)
      : await admin.from("trailers").update(patch).eq("org_id", orgId).eq("id", subjectId);
  if (error) return { error: "Could not record the inspection expiry", code: "update_failed" };
  return { ok: true };
}

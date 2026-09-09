import type { SupabaseClient } from "@supabase/supabase-js";
import type { InspectionSubjectType } from "@silvicom/shared";
import { fetchAllPaged } from "../../lib/paging.js";

/**
 * The equipment side of the §396.17 annual inspection, as `roster` exposes it (D-AVI9, D-AVI10).
 *
 * `vehicles` and `trailers` belong to this module (docs/ARCHITECTURE.md §3), so `maintenance` reads
 * and projects through here rather than reaching for `.from("vehicles")`.
 *
 * Three read shapes, by how the caller arrives: ONE row it can name, MANY rows whose ids it already
 * holds, and — since 2026-09-08 — the WHOLE fleet of a kind, which is what a screen listing units
 * needs and what nothing here could previously answer (INVENTORY-PLAN.md I9's stated prerequisite).
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
   * Trailers only; null for a TRACTOR, where the question does not apply.
   *
   * It is never null for a trailer, and the previous wording here ("a trailer whose type nobody has
   * recorded") was wrong about the database: `trailers.is_reefer` is `not null default false`, so an
   * unrecorded trailer reads `false`, not null. Re-measured 2026-09-08 against production: 46 of 234
   * active trailers are reefers, and the flag and `trailer_type` NEVER disagree — every `is_reefer`
   * row carries `trailer_type = 'reefer'`, and no false row does.
   *
   * The inspection seeds a different checklist for a reefer, because a reefer has an engine and a
   * fuel tank and a dry van does not — the difference between a form that opens right and one that
   * pre-marks an inspection of parts that are not there.
   */
  isReefer: boolean | null;
  /**
   * The trailer's declared type, or null. Null for a tractor, and null for the **175 of 234 active
   * trailers that carry no type at all** (measured 2026-09-08) — which is why anything deciding what
   * a unit IS should read `isReefer` and not this. Kept because it is the finer fact where it exists.
   *
   * Values are constrained by `trailers_trailer_type_check` to
   * `dry_van | reefer | flatbed | tanker | hopper | other`. Deliberately typed as a string rather
   * than a TypeScript union: the CHECK is the authority, and a hand-copied union is a second source
   * of truth that drifts the first time somebody adds a value in a migration.
   */
  trailerType: string | null;
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
      : await admin.from("trailers").select("id, unit_number, vin, plate, is_reefer, trailer_type").eq("org_id", orgId).eq("id", subjectId).maybeSingle();
  if (error) return { error: "Could not load the equipment record", code: "db_error" };
  if (!data) return null;
  const row = data as {
    id: string;
    unit_number: string;
    vin: string | null;
    plate: string | null;
    is_reefer?: boolean | null;
    trailer_type?: string | null;
  };
  return {
    id: row.id,
    unitNumber: row.unit_number,
    vin: row.vin,
    plate: row.plate,
    isReefer: subjectType === "trailer" ? (row.is_reefer ?? null) : null,
    trailerType: subjectType === "trailer" ? (row.trailer_type ?? null) : null,
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
      : await admin.from("trailers").select("id, unit_number, vin, plate, is_reefer, trailer_type").eq("org_id", orgId).in("id", unique);
  if (error) return { error: "Could not load the equipment records", code: "db_error" };
  const rows = (data ?? []) as Array<{
    id: string;
    unit_number: string;
    vin: string | null;
    plate: string | null;
    is_reefer?: boolean | null;
    trailer_type?: string | null;
  }>;
  return new Map(rows.map((r) => [r.id, toIdentity(subjectType, r)] as const));
}

/**
 * One row → one identity, shared by all three readers.
 *
 * It exists because the bulk reader used to hardcode `isReefer: null` while the single-row reader
 * derived it properly. Nothing was broken by that — `inspectionList` is its only caller and reads
 * unit numbers — but the two readers returned the same TYPE with different meanings for the same
 * field, and the next caller to trust it would have got "not a reefer" for all 46 of them. D-INV12
 * makes reefer kits a real consumer, so the divergence is closed here rather than met there.
 */
function toIdentity(
  subjectType: InspectionSubjectType,
  row: {
    id: string;
    unit_number: string;
    vin: string | null;
    plate: string | null;
    is_reefer?: boolean | null;
    trailer_type?: string | null;
  },
): EquipmentIdentity {
  const isTrailer = subjectType === "trailer";
  return {
    id: row.id,
    unitNumber: row.unit_number,
    vin: row.vin,
    plate: row.plate,
    isReefer: isTrailer ? (row.is_reefer ?? null) : null,
    trailerType: isTrailer ? (row.trailer_type ?? null) : null,
  };
}

export interface EquipmentListOptions {
  /**
   * Defaults to TRUE. A retired unit has no kit to be short of and no inspection to fall due, so
   * every caller so far wants the working fleet — and a caller that forgets the flag and silently
   * gets 11 retired trailers in a shortfall report has invented phantom work for the shop. Pass
   * `false` deliberately to see everything.
   */
  activeOnly?: boolean;
}

/**
 * Every tractor, or every trailer, in one org.
 *
 * The gap this fills: nothing in this module could list equipment. `getEquipmentIdentity` needs an
 * id and `getEquipmentIdentities` needs a set of them, so a screen that wants "all the trailers"
 * had no owner-sanctioned way to ask — and reaching for `.from("trailers")` from another module is
 * exactly what D-ARC3 forbids. Named as I9's prerequisite in INVENTORY-PLAN.md and built ahead of
 * it because it is roster's own work and depends on nothing inventory owns.
 *
 * ── IT PAGES, AND THE ORDER IS PART OF THAT ─────────────────────────────────────────────────────
 * PostgREST caps a response at ~1,000 rows whatever limit you ask for, so a full-table read is a
 * `.range()` loop; `fetchAllPaged` is the house helper for it. 234 trailers and 207 tractors are
 * comfortably inside one page today, which is exactly why this is written to page NOW — a fleet
 * that grows past 1,000 would otherwise start silently truncating, which is how nine filter menus
 * lost 30 % of their values.
 *
 * The `.order()` is not cosmetic: `.range()` without a stable sort lets Postgres return rows in a
 * different order per page, which duplicates some rows across page boundaries and drops others.
 * `unit_number` is what a person reads, and `id` breaks its ties.
 */
export async function listEquipmentIdentities(
  admin: SupabaseClient,
  orgId: string,
  kind: InspectionSubjectType,
  options: EquipmentListOptions = {},
): Promise<EquipmentIdentity[] | EquipmentError> {
  const activeOnly = options.activeOnly ?? true;
  type Row = {
    id: string;
    unit_number: string;
    vin: string | null;
    plate: string | null;
    is_reefer?: boolean | null;
    trailer_type?: string | null;
  };

  try {
    // Both tables named as literals and the branch written out twice — see the note at the top of
    // this file on why a `TABLE[kind]` lookup would make these reads invisible to the gates.
    const rows = await fetchAllPaged<Row>((from, to) =>
      kind === "tractor"
        ? (activeOnly
            ? admin.from("vehicles").select("id, unit_number, vin, plate").eq("org_id", orgId).eq("status", "active")
            : admin.from("vehicles").select("id, unit_number, vin, plate").eq("org_id", orgId)
          )
            .order("unit_number", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to)
        : (activeOnly
            ? admin.from("trailers").select("id, unit_number, vin, plate, is_reefer, trailer_type").eq("org_id", orgId).eq("status", "active")
            : admin.from("trailers").select("id, unit_number, vin, plate, is_reefer, trailer_type").eq("org_id", orgId)
          )
            .order("unit_number", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
    );
    return rows.map((r) => toIdentity(kind, r));
  } catch {
    // `fetchAllPaged` throws on a page error; this module answers in EquipmentError, not exceptions.
    return { error: "Could not list the equipment records", code: "db_error" };
  }
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
  // ── THE CLAIM IS THE SOURCE COLUMN, NOT `identity_source` (0286) ─────────────────────────────
  // It used to set `identity_source = 'manual'`, which stops the McLeod sweep overwriting this date
  // — and also stops it maintaining the row's VIN, plate, make, model, year and registration,
  // because `rosterIngest` answers a non-CLAIMABLE row by skipping the WHOLE patch. Measured
  // 2026-09-01: the first identity sweep filled 200 trailer VINs and reported `office-owned=1` — the
  // one trailer with a certified inspection, which ended the sweep still carrying `vin = null`. Its
  // own inspection locked it out of its own VIN.
  //
  // So the claim now names the column it actually protects. `identity_source` goes back to meaning
  // one thing: who owns the row's IDENTITY. An office that wants a vehicle outright still sets it.
  const patch = { dot_annual_inspection_expires_at: expiresAt, dot_annual_inspection_source: "inspection" };
  const { error } =
    subjectType === "tractor"
      ? await admin.from("vehicles").update(patch).eq("org_id", orgId).eq("id", subjectId)
      : await admin.from("trailers").update(patch).eq("org_id", orgId).eq("id", subjectId);
  if (error) return { error: "Could not record the inspection expiry", code: "update_failed" };
  return { ok: true };
}

/**
 * What owns this equipment row right now — read BEFORE finalize claims it (0285).
 *
 * Returned as the raw column value rather than a parsed enum: the point is to put back exactly what
 * was there, and a value this code does not recognise is still the right thing to restore.
 */
export async function readEquipmentIdentitySource(
  admin: SupabaseClient,
  orgId: string,
  subjectType: InspectionSubjectType,
  subjectId: string,
): Promise<string | null | EquipmentError> {
  const { data, error } =
    subjectType === "tractor"
      ? await admin.from("vehicles").select("identity_source").eq("org_id", orgId).eq("id", subjectId).maybeSingle()
      : await admin.from("trailers").select("identity_source").eq("org_id", orgId).eq("id", subjectId).maybeSingle();
  if (error) return { error: "Could not read the equipment's identity source", code: "db_error" };
  return data ? ((data as { identity_source: string | null }).identity_source ?? null) : null;
}

/**
 * Give back what a deleted report took (D-AVI29).
 *
 * ── BOTH HALVES, OR NEITHER IS RIGHT ───────────────────────────────────────────────────────────
 * Finalize writes two things onto the truck: the projected expiry, and `identity_source = 'manual'`
 * so the McLeod sweep's CLAIMABLE set ({'samsara','mcleod'}) leaves the office's date alone. Undoing
 * only the date leaves the row stranded as 'manual' — and that claim is not scoped to the inspection
 * column, so the sweep stops maintaining the vehicle's IDENTITY too. Measured on production
 * 2026-09-01: 197 vehicles 'samsara', exactly one 'manual', and that one was the inspected truck.
 *
 * ── `expiresAt` IS RECOMPUTED BY THE CALLER, NOT ASSUMED NULL ──────────────────────────────────
 * Deleting one report of several must leave the date the REMAINING reports justify. The caller reads
 * them; this function only writes what it is told, so "no inspections left" and "an older one is now
 * the newest" go down the same path.
 *
 * ── A NULL `restoreSource` MEANS "DO NOT TOUCH IT" ─────────────────────────────────────────────
 * Reports filed before 0285 never recorded what they displaced. Guessing — writing the column
 * default, or the value most of the fleet happens to carry — would be restating one fleet's plumbing
 * as if it were a fact about this row. Leaving the claim in place is the honest failure: it costs a
 * sweep that skips one vehicle, against a wrong write that hands the row to a sweep that never owned
 * it.
 */
export async function releaseEquipmentInspectionClaim(
  admin: SupabaseClient,
  orgId: string,
  subjectType: InspectionSubjectType,
  subjectId: string,
  expiresAt: string | null,
  restoreSource: string | null,
): Promise<{ ok: true } | EquipmentError> {
  const patch: Record<string, string | null> = {
    dot_annual_inspection_expires_at: expiresAt,
    // Handing the date back to the sweep is the whole release now (0286). Null rather than a value:
    // "nobody has claimed this" is the default every row carries until an inspection is certified.
    dot_annual_inspection_source: expiresAt === null ? null : "inspection",
  };
  // Legacy only. Reports filed between 0285 and 0286 DID take the identity claim, and those rows
  // still need it given back; reports after 0286 never took it, so `restoreSource` is null and this
  // does not fire. Kept until no report carries a recorded claim, not deleted on the day it stopped
  // being written.
  if (restoreSource !== null) patch.identity_source = restoreSource;
  const { error } =
    subjectType === "tractor"
      ? await admin.from("vehicles").update(patch).eq("org_id", orgId).eq("id", subjectId)
      : await admin.from("trailers").update(patch).eq("org_id", orgId).eq("id", subjectId);
  if (error) return { error: "Could not release the inspection claim", code: "update_failed" };
  return { ok: true };
}

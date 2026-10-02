import { deriveVehicleStatus, type TmsTrailerInput, type TmsVehicleInput } from "./tms.js";

/**
 * Fleet parity — does our truck and trailer list agree with McLeod's? (FUEL-SAVINGS-AND-IDLE-ENGINE-
 * PLAN.md FL2, D-FL2; owner ruling R12: "the truck AND trailer list must be 100% precise".)
 *
 * PURE. The API hands it McLeod's full list (the roster checkpoint carries it since Q-FL7) and our
 * rows, and it returns what disagrees. Silence is the pass. It decides nothing about McLeod's data
 * being right — McLeod is membership (D-FC0) — it only says where the two lists part.
 *
 * ── WHAT IS COMPARED ────────────────────────────────────────────────────────────────────────────
 * Rows are paired by McLeod's id (`mcleod_tractor_id` / `mcleod_trailer_id`), never by unit number or
 * VIN: the pairing the sweep already made is the thing being audited. Then, per pair, every field
 * McLeod supplied — a field McLeod leaves empty is no claim, exactly as `vehiclePatch` skips it.
 *   · status — McLeod's is DERIVED by `deriveVehicleStatus`, the rule the sweep writes with, so the
 *     two cannot disagree about what "in the shop" means. A truck's shop status is only compared when
 *     the agent read the sub-status at all (`in_shop` present).
 *   · make / model — on the DERIVED values (owner, 2026-10-01): McLeod's spelling goes through
 *     0402's `vehicle_make_model_derive` before it gets here, so `FRHT`/`CA` and
 *     `Freightliner`/`Cascadia` agree. Trailers carry no derivation and are not compared on make.
 *
 * ── WHAT IS NOT A DISAGREEMENT ──────────────────────────────────────────────────────────────────
 *   · An `ordered` row missing from the list. `ordered` is `deriveVehicleStatus`'s word for a unit
 *     with no purchase date and no model year, which is exactly what McLeod's P4 predicate excludes
 *     (a reserved unit number, not a truck). The list cannot contain it, so its absence says nothing.
 *   · A retired row missing from the list. Retired is the list's own verdict, already applied.
 *
 * ── THE KNOWN STATE: SOLD, AWAITING PICKUP ──────────────────────────────────────────────────────
 * A sold truck stays Active in McLeod until the buyer collects it (owner, 2026-09-22), and the carrier
 * renames its Samsara record `NNN - SOLD` (Q-FL2). Measured 2026-10-01: 506, 550, 557, 563, 568, 572,
 * 592, 594, 607 and 632–635. Every finding on such a truck is moved to `known`, and so is the truck
 * itself, so the report lists them without alarming on every sweep (Q-FL1, Q-FL4). The name is read
 * from `vehicles.samsara_name` (0401) — never from a list of units here, which the next sale would
 * make wrong.
 */

export type ParityEntity = "tractor" | "trailer";
export type ParityField = "status" | "vin" | "year" | "purchased_at" | "make" | "model";

export type ParityFinding =
  /** McLeod lists it; no row of ours carries its id. */
  | { entity: ParityEntity; kind: "missing_here"; unit: string; externalId: string }
  /** We carry it as live; McLeod's list does not contain it (or it carries no McLeod link at all). */
  | { entity: ParityEntity; kind: "not_in_mcleod"; unit: string; rowId: string; externalId: string | null }
  /** Two or more of our rows carry the same McLeod id — the `568 - OLD` ↔ 568 shape. */
  | { entity: ParityEntity; kind: "duplicate_link"; unit: string; externalId: string; rowIds: string[] }
  | {
      entity: ParityEntity;
      kind: "mismatch";
      unit: string;
      rowId: string;
      field: ParityField;
      mcleod: string;
      ours: string | null;
    };

export interface ParityKnown {
  entity: ParityEntity;
  unit: string;
  rowId: string;
  reason: "sold_awaiting_pickup";
  /** The findings this state explains — kept, so the report can still say what differs. */
  findings: ParityFinding[];
}

export interface ParityResult {
  findings: ParityFinding[];
  known: ParityKnown[];
}

/** Our row, as the parity check needs it. `link` is the McLeod id column for the entity. */
export interface ParityOurRow {
  id: string;
  unit_number: string;
  link: string | null;
  status: string;
  vin: string | null;
  year: number | null;
  purchased_at: string | null;
  make?: string | null;
  model?: string | null;
  samsara_name?: string | null;
}

/** McLeod's make/model after 0402's derivation, keyed by `external_id`. */
export type DerivedMakeModel = Map<string, { make: string | null; model: string | null }>;

/** `NNN - SOLD`, as the carrier types it; spacing and case are not information. */
export function isSoldAwaitingPickup(samsaraName: string | null | undefined): boolean {
  return /-\s*SOLD\s*$/i.test(samsaraName ?? "");
}

const vinKey = (v: string | null | undefined): string => (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const LIVE_EXEMPT_FROM_LIST = new Set(["retired", "ordered"]);

function compareEntity(
  entity: ParityEntity,
  mcleod: Array<TmsVehicleInput | TmsTrailerInput>,
  ours: ParityOurRow[],
  derived: DerivedMakeModel,
): ParityFinding[] {
  const out: ParityFinding[] = [];
  const byLink = new Map<string, ParityOurRow[]>();
  for (const r of ours) {
    if (!r.link) continue;
    byLink.set(r.link, [...(byLink.get(r.link) ?? []), r]);
  }
  for (const [link, rows] of byLink) {
    if (rows.length > 1) {
      out.push({ entity, kind: "duplicate_link", unit: link, externalId: link, rowIds: rows.map((r) => r.id).sort() });
    }
  }

  const listed = new Set(mcleod.map((m) => m.external_id));
  for (const m of mcleod) {
    const unit = m.unit_number ?? m.external_id;
    const rows = byLink.get(m.external_id) ?? [];
    if (rows.length === 0) {
      out.push({ entity, kind: "missing_here", unit, externalId: m.external_id });
      continue;
    }
    if (rows.length > 1) continue; // reported as a duplicate; a field-by-field verdict would be a guess
    const ours = rows[0]!;
    const differs = (field: ParityField, theirs: string | null | undefined, mine: string | null | undefined) => {
      if (theirs == null || theirs === "") return;
      if (theirs !== (mine ?? null)) {
        out.push({ entity, kind: "mismatch", unit, rowId: ours.id, field, mcleod: theirs, ours: mine ?? null });
      }
    };

    if (entity === "tractor") {
      const t = m as TmsVehicleInput;
      const expected = deriveVehicleStatus(t);
      // Without the sub-status the agent cannot say a truck is NOT in the shop.
      const comparable = !(t.in_shop == null && expected === "active" && ours.status === "maintenance");
      if (comparable) differs("status", expected, ours.status);
      const d = derived.get(m.external_id);
      differs("make", d?.make, ours.make);
      differs("model", d?.model, ours.model);
    } else {
      differs("status", "active", ours.status);
    }
    if (m.vin && vinKey(m.vin) !== vinKey(ours.vin)) differs("vin", m.vin, ours.vin);
    differs("year", m.year == null ? null : String(m.year), ours.year == null ? null : String(ours.year));
    differs("purchased_at", m.purchased_at, ours.purchased_at?.slice(0, 10));
  }

  for (const r of ours) {
    if (LIVE_EXEMPT_FROM_LIST.has(r.status)) continue;
    if (r.link && listed.has(r.link)) continue;
    out.push({ entity, kind: "not_in_mcleod", unit: r.unit_number, rowId: r.id, externalId: r.link });
  }
  return out;
}

/** The row a finding is about, when it is about exactly one of ours. */
function rowOf(f: ParityFinding): string | null {
  return f.kind === "mismatch" || f.kind === "not_in_mcleod" ? f.rowId : null;
}

export function compareFleetParity(input: {
  tractors: { mcleod: TmsVehicleInput[]; ours: ParityOurRow[]; derived: DerivedMakeModel };
  trailers: { mcleod: TmsTrailerInput[]; ours: ParityOurRow[] };
}): ParityResult {
  const all = [
    ...compareEntity("tractor", input.tractors.mcleod, input.tractors.ours, input.tractors.derived),
    ...compareEntity("trailer", input.trailers.mcleod, input.trailers.ours, new Map()),
  ];
  const listed = new Set(input.tractors.mcleod.map((m) => m.external_id));
  const known: ParityKnown[] = input.tractors.ours
    .filter((r) => r.link && listed.has(r.link) && isSoldAwaitingPickup(r.samsara_name))
    .map((r) => ({ entity: "tractor" as const, unit: r.unit_number, rowId: r.id, reason: "sold_awaiting_pickup" as const, findings: [] }));
  const knownByRow = new Map(known.map((k) => [k.rowId, k]));
  const findings: ParityFinding[] = [];
  for (const f of all) {
    const k = f.entity === "tractor" ? knownByRow.get(rowOf(f) ?? "") : undefined;
    if (k) k.findings.push(f);
    else findings.push(f);
  }
  return { findings, known: known.sort((a, b) => a.unit.localeCompare(b.unit, "en", { numeric: true })) };
}

/** A stable identity for a finding, values included — a changed value is a new finding. */
export function parityFindingKey(f: ParityFinding): string {
  switch (f.kind) {
    case "missing_here":
      return `${f.entity}:missing_here:${f.externalId}`;
    case "not_in_mcleod":
      return `${f.entity}:not_in_mcleod:${f.rowId}`;
    case "duplicate_link":
      return `${f.entity}:duplicate_link:${f.externalId}:${f.rowIds.join(",")}`;
    case "mismatch":
      return `${f.entity}:mismatch:${f.rowId}:${f.field}:${f.mcleod}:${f.ours ?? ""}`;
  }
}

const FIELD_WORDS: Record<ParityField, string> = {
  status: "status",
  vin: "VIN",
  year: "model year",
  purchased_at: "purchase date",
  make: "make",
  model: "model",
};

/** One plain line per finding, for the notification a fleet manager reads (D-FSV7's register). */
export function describeParityFinding(f: ParityFinding): string {
  const what = f.entity === "tractor" ? "Truck" : "Trailer";
  switch (f.kind) {
    case "missing_here":
      return `${what} ${f.unit} is in McLeod but not in Silvicom 360.`;
    case "not_in_mcleod":
      return f.externalId
        ? `${what} ${f.unit} is in Silvicom 360 but no longer on McLeod's active list.`
        : `${what} ${f.unit} is in Silvicom 360 but not linked to any McLeod ${f.entity}.`;
    case "duplicate_link":
      return `${f.rowIds.length} ${what.toLowerCase()} records in Silvicom 360 point at McLeod ${f.entity} ${f.unit}.`;
    case "mismatch":
      return `${what} ${f.unit}: ${FIELD_WORDS[f.field]} is ${f.mcleod} in McLeod, ${f.ours ?? "empty"} here.`;
  }
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AssetDto,
  KitExpectationSource,
  UnitKind,
  UnitKitDto,
  UnitKitLineDto,
} from "@silvicom/shared";
import { deriveKitStatus, unitKindOf, type KitLine } from "@silvicom/shared";
import { listEquipmentIdentities, type EquipmentIdentity } from "../../roster/index.js";
import { fetchAllPaged } from "../../../lib/paging.js";
import { traced } from "../inspections/serviceError.js";
import { listAssets } from "./assets.js";
import type { ServiceError } from "./types.js";

/**
 * What a unit is expected to hold, against what it does (INVENTORY-PLAN.md step I9, D-INV12).
 *
 * ── THE COMPARISON IS `deriveKitStatus`, RUN ONCE, HERE ───────────────────────────────────────
 * I9's done-when is that kit status comes from ONE shared function on api and web, and this file is
 * the api half of that: it gathers the two lists, calls `deriveKitStatus`, and puts the answer on
 * the wire. The web renders what it is given. A second comparison on either side is how "short by
 * one" and "complete" end up on two screens about the same trailer.
 *
 * ── THE EXPECTATION RESOLVES IN THREE LAYERS, IN `move_asset`'s OWN ORDER ─────────────────────
 * Per-unit override, then the fleet default for the unit's kind, then the asset type's
 * `default_kit_quantity`. That order is not this file's invention — it is what 0333 uses to decide
 * `IV020`, so a kit screen resolving it differently would tell a technician a truck may hold two of
 * something the database will refuse to give it a second of. `source` on each line reports which
 * layer won, because "reset to the fleet default" is unsayable without it.
 *
 * ── AND A TYPE WITH NO EXPECTATION ANYWHERE IS NOT A LINE ─────────────────────────────────────
 * `default_kit_quantity` is zero for a type nobody has said anything about, and a kit line reading
 * "0 expected, 0 held" is furniture. A type only appears because somebody expects it here, or
 * because the unit is actually carrying one — which is the `extra` bucket, and is the one thing a
 * kit check finds that no expectation predicted.
 */

/** A trailer read carries `isReefer`; a tractor's is null. `unitKindOf` is the one place that matters. */
const kindOf = (identity: EquipmentIdentity, kind: "tractor" | "trailer"): UnitKind =>
  unitKindOf({ kind, isReefer: identity.isReefer });

/** Exported because `resolveExpected` is: a public function's parameter type should be nameable. */
export interface ExpectationRow {
  asset_type_id: string;
  unit_kind: UnitKind;
  vehicle_id: string | null;
  trailer_id: string | null;
  quantity: number;
  asset_types: { name: string; default_kit_quantity: number } | null;
}

/**
 * Every expectation row this org has, in one read.
 *
 * One call for the whole page rather than one per unit: a fleet of 440 units against a handful of
 * kit rules is the shape, and asking per unit would be 440 round trips to answer one screen. The
 * same shape `memberLabels` exists to enforce for names.
 */
async function loadExpectations(
  admin: SupabaseClient,
  orgId: string,
): Promise<ExpectationRow[] | ServiceError> {
  const { data, error } = await admin
    .from("kit_expectations")
    .select("asset_type_id, unit_kind, vehicle_id, trailer_id, quantity, asset_types(name, default_kit_quantity)")
    .eq("org_id", orgId);
  if (error) return traced("loadExpectations", "db_error", "Could not load the kit rules", error);
  return (data ?? []) as unknown as ExpectationRow[];
}

/** The types an org has at all — so a `default_kit_quantity` can be honoured without an expectation row. */
async function loadTypeDefaults(
  admin: SupabaseClient,
  orgId: string,
): Promise<Map<string, { name: string; quantity: number }> | ServiceError> {
  const { data, error } = await admin
    .from("asset_types")
    .select("id, name, default_kit_quantity")
    .eq("org_id", orgId);
  if (error) return traced("loadTypeDefaults", "db_error", "Could not load the asset types", error);
  return new Map(
    ((data ?? []) as Array<{ id: string; name: string; default_kit_quantity: number }>).map((t) => [
      t.id,
      { name: t.name, quantity: Number(t.default_kit_quantity) },
    ]),
  );
}

/**
 * The expected kit for ONE unit, with the layer each number came from.
 *
 * Pure: it takes the rows already read and decides nothing about the database. That is what lets the
 * list build 440 units' kits from one pair of reads.
 */
export function resolveExpected(
  unit: { kind: UnitKind; unitId: string },
  rows: ExpectationRow[],
  typeDefaults: Map<string, { name: string; quantity: number }>,
): Array<{ assetTypeId: string; assetTypeName: string; quantity: number; source: KitExpectationSource }> {
  const out = new Map<string, { assetTypeName: string; quantity: number; source: KitExpectationSource }>();

  // Weakest first, strongest last — each layer overwrites what the one before it put down, so the
  // per-unit override always wins and the order is stated once rather than asked three times.
  for (const [id, def] of typeDefaults) {
    if (def.quantity > 0) out.set(id, { assetTypeName: def.name, quantity: def.quantity, source: "type" });
  }
  for (const r of rows) {
    if (r.vehicle_id || r.trailer_id) continue;
    if (r.unit_kind !== unit.kind) continue;
    out.set(r.asset_type_id, {
      assetTypeName: r.asset_types?.name ?? typeDefaults.get(r.asset_type_id)?.name ?? "",
      quantity: Number(r.quantity),
      source: "fleet",
    });
  }
  for (const r of rows) {
    if (r.vehicle_id !== unit.unitId && r.trailer_id !== unit.unitId) continue;
    out.set(r.asset_type_id, {
      assetTypeName: r.asset_types?.name ?? typeDefaults.get(r.asset_type_id)?.name ?? "",
      quantity: Number(r.quantity),
      source: "unit",
    });
  }

  return [...out].map(([assetTypeId, v]) => ({ assetTypeId, ...v }));
}

/** Assemble one unit's DTO from what it expects and what it holds. */
function toUnitKitDto(
  unit: { kind: UnitKind; unitId: string; unitNumber: string; inferredDriverName: string | null },
  expected: ReturnType<typeof resolveExpected>,
  // Only the type and its name are read, so the parameter says only that: an `AssetDto[]` satisfies
  // it structurally, and the list — which never builds a whole DTO per asset — is not made to cast.
  held: Array<{ assetTypeId: string; assetTypeName: string }>,
): UnitKitDto {
  const expectedLines: KitLine[] = expected.map((e) => ({ assetTypeId: e.assetTypeId, quantity: e.quantity }));
  const heldLines: KitLine[] = held.map((a) => ({ assetTypeId: a.assetTypeId, quantity: 1 }));
  const status = deriveKitStatus(expectedLines, heldLines);

  const bySource = new Map(expected.map((e) => [e.assetTypeId, e]));
  const heldNames = new Map(held.map((a) => [a.assetTypeId, a.assetTypeName]));

  const lines: UnitKitLineDto[] = status.lines.map((l) => ({
    assetTypeId: l.assetTypeId,
    assetTypeName: bySource.get(l.assetTypeId)?.assetTypeName || heldNames.get(l.assetTypeId) || "",
    expected: l.expected,
    held: l.held,
    delta: l.delta,
    // A line the unit carries but nothing expects came from no layer at all. It is reported as the
    // type's own, which is where its zero came from — and its `expected: 0` is what says the rest.
    source: bySource.get(l.assetTypeId)?.source ?? "type",
  }));

  return {
    kind: unit.kind,
    unitId: unit.unitId,
    unitNumber: unit.unitNumber,
    inferredDriverName: unit.inferredDriverName,
    state: status.state,
    shortBy: status.shortBy,
    extraBy: status.extraBy,
    lines,
  };
}

/**
 * Every asset this org holds on a unit, in one paged read.
 *
 * ⚠ `fetchAllPaged`, not `.limit(10_000)`. PostgREST caps a response at 1,000 rows whatever the
 * limit says — a fiction that once cost nine filter menus 30 % of their values in silence — and a
 * kit screen that stopped at row 1,000 would report every unit after it as completely empty, which
 * is the most alarming way a list can be wrong.
 *
 * The filter is "held by a vehicle OR a trailer", written as `.not(...is.null)` on each column
 * rather than `.or(...)`: two straightforward negations beat a string PostgREST has to parse, and
 * `listParts`' unescaped `.or()` interpolation is the house's standing warning about that syntax.
 */
async function loadHeldAssets(
  admin: SupabaseClient,
  orgId: string,
  column: "vehicle_id" | "trailer_id",
): Promise<Array<{ id: string; asset_type_id: string; unit_id: string }> | ServiceError> {
  try {
    // No `asset_types(name)` embed: the name comes from `loadTypeDefaults`' map, which this file
    // reads anyway. One join fewer, and — the reason it matters — one place a type's name is spelled.
    const rows = await fetchAllPaged<{
      id: string;
      asset_type_id: string;
      vehicle_id: string | null;
      trailer_id: string | null;
    }>((from, to) =>
      admin
        .from("inventory_assets")
        .select("id, asset_type_id, vehicle_id, trailer_id")
        .eq("org_id", orgId)
        .not(column, "is", null)
        // A retired asset is off the fleet and is not part of anybody's kit; `move_asset` clears its
        // holder, so this is belt to that trigger's braces rather than a second rule.
        .neq("status", "retired")
        .order("id", { ascending: true })
        .range(from, to),
    );
    return rows.map((r) => ({
      id: r.id,
      asset_type_id: r.asset_type_id,
      unit_id: (column === "vehicle_id" ? r.vehicle_id : r.trailer_id) as string,
    }));
  } catch (e) {
    return traced("loadHeldAssets", "db_error", "Could not load what the units are carrying", e);
  }
}

export interface ListUnitsOptions {
  /** `tractor` or `trailer` — the ROSTER's two tables, not the three kit kinds. */
  kind?: "tractor" | "trailer";
  /** Only units whose kit is short. What the shop home's shortfall card links to. */
  shortOnly?: boolean;
}

/**
 * Every active tractor and trailer with its kit status.
 *
 * Four reads for the whole fleet — the roster's two tables, the expectations, the types, and the
 * held assets — and then arithmetic. Not one read per unit: 440 units is the measured fleet, and a
 * per-unit query would be 440 round trips to paint one screen.
 */
export async function listUnitKits(
  admin: SupabaseClient,
  orgId: string,
  opts: ListUnitsOptions = {},
): Promise<{ units: UnitKitDto[]; total: number } | ServiceError> {
  const rows = await loadExpectations(admin, orgId);
  if (isError(rows)) return rows;
  const typeDefaults = await loadTypeDefaults(admin, orgId);
  if (isError(typeDefaults)) return typeDefaults;

  const units: UnitKitDto[] = [];

  for (const kind of ["tractor", "trailer"] as const) {
    if (opts.kind && opts.kind !== kind) continue;
    const identities = await listEquipmentIdentities(admin, orgId, kind, { activeOnly: true });
    if ("error" in identities) {
      return traced("listUnitKits", "db_error", "Could not list the fleet", identities);
    }
    const held = await loadHeldAssets(admin, orgId, kind === "tractor" ? "vehicle_id" : "trailer_id");
    if (isError(held)) return held;

    const byUnit = new Map<string, Array<{ assetTypeId: string; assetTypeName: string }>>();
    for (const a of held) {
      const list = byUnit.get(a.unit_id) ?? [];
      list.push({
        assetTypeId: a.asset_type_id,
        assetTypeName: typeDefaults.get(a.asset_type_id)?.name ?? "",
      });
      byUnit.set(a.unit_id, list);
    }

    for (const identity of identities) {
      const unitKind = kindOf(identity, kind);
      const expected = resolveExpected({ kind: unitKind, unitId: identity.id }, rows, typeDefaults);
      const holds = byUnit.get(identity.id) ?? [];
      units.push(
        toUnitKitDto(
          {
            kind: unitKind,
            unitId: identity.id,
            unitNumber: identity.unitNumber,
            // Resolved for the DETAIL only — see `getUnitKit`. A list of 440 trucks would be 440
            // driver lookups for a name the list does not show.
            inferredDriverName: null,
          },
          expected,
          holds,
        ),
      );
    }
  }

  const filtered = opts.shortOnly ? units.filter((u) => u.state === "short") : units;
  return { units: filtered, total: filtered.length };
}

/** Narrow a service result, so the four reads above read as four lines rather than four blocks. */
function isError<T>(v: T | ServiceError): v is ServiceError {
  return typeof v === "object" && v !== null && "error" in v && "code" in v;
}

/**
 * One unit: its kit, and the assets it is actually carrying.
 *
 * The driver's name is resolved HERE and is null in the list, the same split `getAsset` draws for
 * "since when": one bounded lookup for one truck is honest, and 440 of them to paint a list that
 * does not show the name is not.
 */
export async function getUnitKit(
  admin: SupabaseClient,
  orgId: string,
  kind: "tractor" | "trailer",
  unitId: string,
): Promise<{ unit: UnitKitDto; assets: AssetDto[] } | null | ServiceError> {
  const identities = await listEquipmentIdentities(admin, orgId, kind, { activeOnly: false });
  if ("error" in identities) {
    return traced("getUnitKit", "db_error", "Could not read the unit", identities);
  }
  const identity = identities.find((i) => i.id === unitId);
  if (!identity) return null;

  const rows = await loadExpectations(admin, orgId);
  if (isError(rows)) return rows;
  const typeDefaults = await loadTypeDefaults(admin, orgId);
  if (isError(typeDefaults)) return typeDefaults;

  const holding = await listAssets(admin, orgId, {
    ...(kind === "tractor" ? { vehicleId: unitId } : { trailerId: unitId }),
    limit: 200,
  });
  if (isError(holding)) return holding;

  const unitKind = kindOf(identity, kind);
  const expected = resolveExpected({ kind: unitKind, unitId }, rows, typeDefaults);
  // `listAssets` already resolved the driver off the holding vehicle — the same inference D-INV3
  // allows and the same one the asset detail shows. Reading it back off an asset the unit holds
  // avoids a second lookup for a fact the page has already paid for; a unit carrying nothing has no
  // asset to read it from, which is why the fallback is null rather than an extra query.
  const inferredDriverName =
    kind === "tractor" ? (holding.assets.find((a) => a.holder.inferredDriverName)?.holder.inferredDriverName ?? null) : null;

  return {
    unit: toUnitKitDto(
      { kind: unitKind, unitId, unitNumber: identity.unitNumber, inferredDriverName },
      expected,
      holding.assets,
    ),
    assets: holding.assets,
  };
}

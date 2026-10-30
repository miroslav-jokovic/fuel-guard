import type { SupabaseClient } from "@supabase/supabase-js";
import { KIT_RULES_SHOWN, sortAttentionReasons, type UnitAttentionDto, type UnitAttentionReason, type UnitRosterKind } from "@silvicom/shared";
import { readPmDueFleet, readOpenWorkOrders, readUnresolvedDefects } from "../fleetpal/index.js";
import { readFleetIdentities } from "../roster/index.js";
import { listUnitKits } from "./inventory/units.js";
import { listCountSessions } from "./inventory/countSessions.js";
import { readAnnualDue } from "./inspections/annualDue.js";

/**
 * Every truck and trailer with a row on the Shop worklist, and why (MAINTENANCE-SECTION-REDESIGN-
 * PROPOSAL.md §4.3, M3; D-MX2). The Trucks & trailers list opens on this, and the truck's page says
 * the same sentence in its first section — ONE derivation for both, on the server, so the list and
 * the page cannot name different reasons for one truck.
 *
 * Six of the worklist's seven groups are here, each from the reader that owns its list on the home:
 * FleetPal's open defects and work orders (matched to our rows by the F5 mapping, never by the number
 * string), the annual due within 30 days (our record, `readAnnualDue`), PM schedules due or overdue
 * (`readPmDueFleet`, the shared `pmStatus`), checked units short of equipment (R10), and checks left
 * open (R9). The seventh — roadside repairs due — is matched by the unit the officer WROTE (D-IC7),
 * which the browser already does for the roadside card; the page merges it the same way.
 */
export async function readUnitsAttention(admin: SupabaseClient, orgId: string, now: Date = new Date()): Promise<UnitAttentionDto[] | { error: { message: string } }> {
  const [identities, orders, defects, annual, short, walks] = await Promise.all([
    readFleetIdentities(admin, orgId),
    readOpenWorkOrders(admin, orgId),
    readUnresolvedDefects(admin, orgId),
    readAnnualDue(admin, orgId, now),
    // EA2: "missing equipment" is a kit-rule shortfall, and the kit layer is hidden (`KIT_RULES_SHOWN`).
    // Not read at all while it is, so no truck is listed for a reason the screens never show.
    KIT_RULES_SHOWN ? listUnitKits(admin, orgId, { shortOnly: true, checkedOnly: true }) : { units: [] },
    listCountSessions(admin, orgId, { status: "open", kind: "unit", limit: 500 }),
  ]);
  if ("error" in orders) return { error: orders.error };
  if ("error" in defects) return { error: defects.error };
  if ("error" in annual) return annual;
  if ("error" in short) return { error: { message: short.error } };
  if ("error" in walks) return { error: { message: walks.error } };

  const odometers = new Map([...identities.byVehicleId.values()].map((i) => [i.vehicleId, i.odometerMiles]));
  const pm = await readPmDueFleet(admin, orgId, odometers, now);

  const units = new Map<string, UnitAttentionDto>();
  const add = (kind: UnitRosterKind, unitId: string, unitNumber: string | null, reason: UnitAttentionReason) => {
    const key = `${kind}:${unitId}`;
    const u = units.get(key) ?? { kind, unitId, unitNumber: unitNumber ?? "", reasons: [] };
    if (!u.unitNumber && unitNumber) u.unitNumber = unitNumber;
    u.reasons.push(reason);
    units.set(key, u);
  };
  const ours = (r: { vehicleId: string | null; trailerId: string | null }): [UnitRosterKind, string] | null =>
    r.vehicleId ? ["tractor", r.vehicleId] : r.trailerId ? ["trailer", r.trailerId] : null;

  // Counted per unit: "3 defects found on inspections" is one row, not three.
  const defectsOf = new Map<string, { count: number; oldest: string | null; number: string | null }>();
  for (const d of defects) {
    const o = ours(d);
    if (!o) continue;
    const key = `${o[0]}:${o[1]}`;
    const e = defectsOf.get(key) ?? { count: 0, oldest: null, number: d.unitNumber };
    e.count += 1;
    if (d.detectedAt && (e.oldest === null || d.detectedAt < e.oldest)) e.oldest = d.detectedAt;
    defectsOf.set(key, e);
  }
  for (const [key, e] of defectsOf) {
    const [kind, unitId] = key.split(":") as [UnitRosterKind, string];
    add(kind, unitId, e.number, { kind: "defect", count: e.count, oldestDetectedAt: e.oldest });
  }
  const ordersOf = new Map<string, { count: number; oldest: string | null; number: string | null }>();
  for (const w of orders) {
    const o = ours(w);
    if (!o) continue;
    const key = `${o[0]}:${o[1]}`;
    const e = ordersOf.get(key) ?? { count: 0, oldest: null, number: w.unitNumber };
    e.count += 1;
    if (w.openedAt && (e.oldest === null || w.openedAt < e.oldest)) e.oldest = w.openedAt;
    ordersOf.set(key, e);
  }
  for (const [key, e] of ordersOf) {
    const [kind, unitId] = key.split(":") as [UnitRosterKind, string];
    add(kind, unitId, e.number, { kind: "work_order", count: e.count, oldestOpenedAt: e.oldest });
  }
  for (const a of annual) add(a.subjectType, a.unitId, a.unitNumber, { kind: "annual", expiresOn: a.expiresOn, daysRemaining: a.daysRemaining });
  for (const u of pm) {
    const o = ours({ vehicleId: u.unit.vehicle_id, trailerId: u.unit.trailer_id });
    if (!o) continue;
    for (const s of u.schedules) {
      if (s.verdict !== "due" && s.verdict !== "overdue") continue;
      // The interval that made the verdict: the overdue one, else the due one.
      const i = s.intervals.find((x) => x.verdict === s.verdict)!;
      add(o[0], o[1], null, { kind: "pm", name: s.name, pmKind: s.kind, verdict: s.verdict, dueOn: i.dueOn, milesLeft: i.milesLeft });
    }
  }
  for (const u of short.units) {
    add(u.kind === "tractor" ? "tractor" : "trailer", u.unitId, u.unitNumber, { kind: "short", shortBy: u.shortBy, lastCheckedAt: u.lastCheckedAt });
  }
  for (const w of walks.sessions) {
    const o = ours(w);
    if (o) add(o[0], o[1], w.holderLabel, { kind: "open_check", openedAt: w.openedAt });
  }

  // The roster's number wins over FleetPal's where both are known: it is the one on the door.
  for (const u of units.values()) {
    if (u.kind === "tractor") u.unitNumber = identities.byVehicleId.get(u.unitId)?.unitNumber ?? u.unitNumber;
    u.reasons = sortAttentionReasons(u.reasons);
  }
  return [...units.values()].sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, "en", { numeric: true }));
}

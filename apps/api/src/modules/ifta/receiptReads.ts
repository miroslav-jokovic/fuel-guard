import type { SupabaseClient } from "@supabase/supabase-js";
import {
  foldReceiptSources, summarizePeriodReceipts,
  type IftaCardFillKey, type IftaPeriodReceipts, type IftaReceiptRaw, type ReceiptDuplicateSplit,
} from "@silvicom/shared";
import { readFuelTaxReceipts } from "../mcleod/index.js";
import { readVehicleTractorFillKeys } from "../fuel/index.js";
import { readUploadedReceipts } from "./uploadedReceipts.js";

/**
 * McLeod's hand-keyed fuel receipts, as the IFTA reads need them (IFTA-PRECISION-PLAN IP6).
 *
 * The receipts come through the collector's own `readFuelTaxReceipts` (D-SEP1: nothing outside
 * mcleod touches `mcleod_fuel_tax_receipts`); this module maps McLeod's tractor unit to our truck
 * and hands both pages the SAME duplicate rule from `@silvicom/shared`, so the state page's gallons
 * and the ledger row it opened from cannot drift apart.
 *
 * An empty table is the normal state on a fresh environment: receipts arrive only with the nightly
 * `--financial` sweep, and a quarter's receipts are keyed in the week after it closes. Zero receipts
 * reads as "card fills only", never as an error.
 */

/** `[fromDay, toDayExclusive)` for a calendar quarter, as YYYY-MM-DD. */
export function quarterWindow(year: number, quarter: number): { fromDay: string; toDayExclusive: string } {
  const pad = (m: number) => String(m).padStart(2, "0");
  const first = (quarter - 1) * 3 + 1;
  return {
    fromDay: `${year}-${pad(first)}-01`,
    toDayExclusive: quarter === 4 ? `${year + 1}-01-01` : `${year}-${pad(first + 3)}-01`,
  };
}

/**
 * McLeod unit → our vehicle id (also the unit an uploaded file names, IP8). A receipt's `tractor_unit` is McLeod's tractor id, which the roster
 * sweep stores as `vehicles.mcleod_tractor_id` and which is also the unit number painted on the
 * truck; the link column wins, the unit number covers a truck the sweep never linked. Retired trucks
 * are included on purpose: a truck sold in November still owns the fuel it bought in August.
 */
export async function matchTractorUnits(admin: SupabaseClient, orgId: string, units: string[]): Promise<Map<string, string>> {
  const byLink = new Map<string, string>();
  const byUnit = new Map<string, string>();
  for (let i = 0; i < units.length; i += 200) {
    const chunk = units.slice(i, i + 200);
    const [linked, numbered] = await Promise.all([
      admin.from("vehicles").select("id, mcleod_tractor_id").eq("org_id", orgId).in("mcleod_tractor_id", chunk),
      admin.from("vehicles").select("id, unit_number").eq("org_id", orgId).in("unit_number", chunk),
    ]);
    if (linked.error) throw new Error(`vehicles read failed: ${linked.error.message}`);
    if (numbered.error) throw new Error(`vehicles read failed: ${numbered.error.message}`);
    for (const v of (linked.data ?? []) as Array<{ id: string; mcleod_tractor_id: string }>) byLink.set(v.mcleod_tractor_id, v.id);
    for (const v of (numbered.data ?? []) as Array<{ id: string; unit_number: string }>) byUnit.set(v.unit_number, v.id);
  }
  return new Map(units.flatMap((u) => {
    const id = byLink.get(u) ?? byUnit.get(u);
    return id ? [[u, id] as [string, string]] : [];
  }));
}

/** McLeod's live receipts for the window (optionally one jurisdiction), each mapped to a truck where one matches. */
async function readMappedMcleodReceipts(
  admin: SupabaseClient,
  orgId: string,
  fromDay: string,
  toDayExclusive: string,
  jurisdiction?: string,
): Promise<IftaReceiptRaw[]> {
  const rows = await readFuelTaxReceipts(admin, orgId, fromDay, toDayExclusive, jurisdiction);
  if (rows.length === 0) return [];
  const units = [...new Set(rows.map((r) => r.tractorUnit.trim()))];
  const vehicleOf = await matchTractorUnits(admin, orgId, units);
  return rows.map((r) => ({
    externalId: r.externalId,
    source: "mcleod" as const,
    vehicleId: vehicleOf.get(r.tractorUnit.trim()) ?? null,
    unitAsFiled: r.tractorUnit.trim(),
    jurisdiction: r.jurisdiction.trim().toUpperCase(),
    receiptDate: r.receiptDate,
    gallons: r.gallons,
  }));
}

/**
 * Every receipt source for the window: McLeod's hand-keyed receipts and the office's uploads (IP8).
 * Which copy of a fill counts is `foldReceiptSources`' rule, applied by both callers below.
 */
async function readAllReceipts(
  admin: SupabaseClient,
  orgId: string,
  fromDay: string,
  toDayExclusive: string,
  jurisdiction?: string,
): Promise<IftaReceiptRaw[]> {
  const [mcleod, uploaded] = await Promise.all([
    readMappedMcleodReceipts(admin, orgId, fromDay, toDayExclusive, jurisdiction),
    readUploadedReceipts(admin, orgId, fromDay, toDayExclusive, jurisdiction),
  ]);
  return [...uploaded, ...mcleod];
}

/**
 * The ledger's receipts: every state, duplicates dropped (card fills first, then source order), summed per jurisdiction. The duplicate
 * candidates are only the fills of trucks that HAVE a receipt this quarter — a match needs the same
 * truck, so no other fill can matter.
 */
export async function readIftaPeriodReceipts(
  admin: SupabaseClient,
  orgId: string,
  year: number,
  quarter: number,
): Promise<IftaPeriodReceipts> {
  const { fromDay, toDayExclusive } = quarterWindow(year, quarter);
  const receipts = await readAllReceipts(admin, orgId, fromDay, toDayExclusive);
  const vehicleIds = [...new Set(receipts.flatMap((r) => (r.vehicleId ? [r.vehicleId] : [])))];
  const fills = vehicleIds.length
    ? await readVehicleTractorFillKeys(admin, orgId, vehicleIds, fromDay, toDayExclusive)
    : [];
  return summarizePeriodReceipts(foldReceiptSources(receipts, fills));
}

/**
 * One jurisdiction's receipts for the drill-down, deduplicated against the card fills the drill-down
 * already read for that jurisdiction — every one of which is in that state, by its own predicate.
 */
export async function readIftaJurisdictionReceipts(
  admin: SupabaseClient,
  orgId: string,
  fromDay: string,
  toDayExclusive: string,
  jurisdiction: string,
  jurisdictionFills: Array<Omit<IftaCardFillKey, "state">>,
): Promise<ReceiptDuplicateSplit<IftaReceiptRaw>> {
  const receipts = await readAllReceipts(admin, orgId, fromDay, toDayExclusive, jurisdiction);
  if (receipts.length === 0) return { kept: [], duplicates: [] };
  return foldReceiptSources(receipts, jurisdictionFills.map((f) => ({ ...f, state: jurisdiction })));
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildIftaReturnReport, ledgerPosition, type IftaReturnReport } from "@silvicom/shared";
import { readQuarterTruckStateMiles } from "../samsara/index.js";
import { readQuarterTractorFills } from "../fuel/index.js";
import { quarterWindow, readAllReceipts } from "./receiptReads.js";
import { readIftaPeriod, readUnitNumbers } from "./periodReads.js";

/**
 * One quarter's IFTA return, read for the export (IFTA-PRECISION-PLAN IP9).
 *
 * The truck rows come through their owners' read interfaces (D-SEP1, D-ARC3): miles per truck per
 * state from samsara's, every tractor fill of the quarter from fuel's, the receipts from this
 * module's own two sources. `buildIftaReturnReport` in `@silvicom/shared` does every sum and the
 * duplicate rule. Beside them, the IFTA page's own read (`readIftaPeriod`), so the file can say where
 * it and the page disagree rather than leave somebody to find out by comparing them.
 *
 * Every read is org-scoped by hand: the service role bypasses RLS.
 */
/** What a rendered file says about itself, beside the figures. */
export interface IftaReturnMeta {
  orgName: string | null;
  generatedAt: string;
}

export interface IftaReturnRead {
  report: IftaReturnReport;
  orgName: string | null;
}

export async function readIftaReturn(
  admin: SupabaseClient,
  orgId: string,
  year: number,
  quarter: number,
): Promise<IftaReturnRead> {
  const months = [1, 2, 3].map((i) => (quarter - 1) * 3 + i);
  const { fromDay, toDayExclusive } = quarterWindow(year, quarter);
  const [truckMiles, cardFills, receipts, period, org] = await Promise.all([
    readQuarterTruckStateMiles(admin, orgId, year, months),
    readQuarterTractorFills(admin, orgId, fromDay, toDayExclusive),
    readAllReceipts(admin, orgId, fromDay, toDayExclusive),
    readIftaPeriod(admin, orgId, year, quarter),
    admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
  ]);
  if (org.error) throw new Error(`organizations read failed: ${org.error.message}`);

  const units = await readUnitNumbers(admin, orgId, [
    ...truckMiles.map((m) => m.vehicleId),
    ...[...cardFills, ...receipts].flatMap((f) => (f.vehicleId ? [f.vehicleId] : [])),
  ]);
  const report = buildIftaReturnReport({
    year,
    quarter,
    truckMiles,
    cardFills,
    receipts,
    units: Object.fromEntries(units),
    ledger: ledgerPosition(period.jurisdictions, period.receipts, { year, quarter }).position,
  });
  return { report, orgName: (org.data as { name: string | null } | null)?.name ?? null };
}

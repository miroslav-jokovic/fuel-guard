/**
 * Pilot's daily quote per station and day — the second READ this collector exposes, for the weekly bill's
 * rebuilt old columns (PILOT-INVOICE-FORMAT-ANALYSIS-2026-11-24 §3).
 *
 * `fuel_prices` is raw-layer and sealed to this module (`check-table-access.mjs`), so `fuel-spend` asks here
 * rather than reading the table itself. Diesel only: Pilot's price file quotes Truck Diesel, and the quote a
 * line is compared with is picked by `pickPilotQuote`, the same rule `fuel_spend_lines` applies in SQL (D-FC4).
 *
 * Org-filtered explicitly: `admin` is the service role and bypasses RLS, so `.eq("org_id", …)` is the only
 * tenant boundary this read has.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PilotQuote } from "@silvicom/shared";
import { eachPage } from "../../lib/paging.js";

const STATION_CHUNK = 200;

/** Quotes for these stations between `from − 1 day` and `to`, grouped by station id. */
export async function readPilotQuotes(
  admin: SupabaseClient,
  orgId: string,
  stationIds: readonly string[],
  from: string,
  to: string,
): Promise<Map<string, PilotQuote[]>> {
  const out = new Map<string, PilotQuote[]>();
  const ids = [...new Set(stationIds)];
  if (ids.length === 0) return out;
  const start = new Date(`${from}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(`${to}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);

  for (let i = 0; i < ids.length; i += STATION_CHUNK) {
    const chunk = ids.slice(i, i + STATION_CHUNK);
    await eachPage<{ station_id: string; posted_price: number | string | null; net_price: number | string | null; observed_at: string }>(
      (a, b) =>
        admin
          .from("fuel_prices")
          .select("station_id, posted_price, net_price, observed_at")
          .eq("org_id", orgId)
          .eq("product", "diesel")
          .in("station_id", chunk)
          .gte("observed_at", start.toISOString())
          .lt("observed_at", end.toISOString())
          .order("observed_at", { ascending: true })
          .range(a, b),
      (rows) => {
        for (const r of rows) {
          const list = out.get(r.station_id) ?? [];
          list.push({
            posted: r.posted_price == null ? null : Number(r.posted_price),
            net: r.net_price == null ? null : Number(r.net_price),
            // The quote's day in UTC, as `fuel_spend_lines` reads it (`observed_at at time zone 'UTC'`).
            date: new Date(r.observed_at).toISOString().slice(0, 10),
          });
          out.set(r.station_id, list);
        }
      },
    );
  }
  return out;
}

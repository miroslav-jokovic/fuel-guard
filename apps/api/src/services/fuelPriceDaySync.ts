import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildFuelPriceDays,
  dayInTz,
  type FuelFill,
  type FuelPriceDay,
  type PostedPriceDay,
} from "@fuelguard/shared";
import { organizationTimezone } from "./idleCapabilitySync.js";

/**
 * Materialize one diesel price per (org, day) from the fleet's own purchases — the history the idle cost
 * model prices against.
 *
 * The idle page used to charge a single price for a whole range: the median of the last 14 days of posted
 * truck-stop quotes. That could not vary by day (the posted table keeps no history), it was not this
 * fleet's cost (posted $5.109 against $4.811 actually paid — 6.2% high), and it was flat across a window
 * whose real prices spanned $4.223–$5.123. `fuel_transactions` already carries `price_per_gal` against
 * `fueled_at`, so this history is materialized from purchases we hold rather than invented, and backfills
 * as far back as the transactions go.
 *
 * Days are bucketed on the ORG's operating timezone — the clock `vehicle_engine_days`, `idle_rollup_days`
 * and this table must all share, or a price day would not line up with the idle day it prices.
 */

export interface FuelPriceDaySyncResult {
  days: number;
  fills: number;
  bySource: Record<FuelPriceDay["priceSource"], number>;
  rowsWritten: number;
}

const PAGE_SIZE = 1000;
const WRITE_CHUNK = 500;
/** Default history depth, matching the deep idle backfill so cost can be recomputed over the same span. */
export const FUEL_PRICE_BACKFILL_DAYS = 400;

interface TransactionRow {
  fueled_at: string;
  price_per_gal: number | string | null;
  gallons: number | string | null;
}

interface PostedRow {
  observed_at: string;
  posted_price: number | string | null;
  net_price: number | string | null;
}

function requireDatabaseSuccess(error: { message: string } | null, operation: string): void {
  if (error) throw new Error(`Fuel price day ${operation} failed: ${error.message}`);
}

const num = (value: number | string | null | undefined): number => {
  const parsed = typeof value === "number" ? value : value == null ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
};

async function readAll<T>(
  table: string,
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await build(offset, offset + PAGE_SIZE - 1);
    requireDatabaseSuccess(error, `${table} read`);
    const batch = (data ?? []) as T[];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) return out;
  }
}

/** Median posted/net diesel per day — the market reference for days the fleet bought nothing. */
function postedByDay(rows: PostedRow[], tz: string): PostedPriceDay[] {
  const byDay = new Map<string, number[]>();
  for (const row of rows) {
    const price = num(row.net_price ?? row.posted_price);
    if (!(price > 0)) continue;
    const day = dayInTz(row.observed_at, tz);
    const list = byDay.get(day) ?? [];
    list.push(price);
    byDay.set(day, list);
  }
  return [...byDay.entries()].map(([day, prices]) => {
    prices.sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    return {
      day,
      pricePerGal: prices.length % 2 ? prices[mid]! : (prices[mid - 1]! + prices[mid]!) / 2,
      sampleCount: prices.length,
    };
  });
}

/**
 * The most recent priced day BEFORE the window, so a window opening on a no-purchase day resolves from the
 * real last known price instead of dropping to the configured rate.
 */
async function readPriorPrice(
  admin: SupabaseClient,
  orgId: string,
  fromDay: string,
): Promise<{ day: string; pricePerGal: number } | null> {
  const { data } = await admin
    .from("fuel_price_days")
    .select("day, actual_price_per_gal")
    .eq("org_id", orgId)
    .lt("day", fromDay)
    .not("actual_price_per_gal", "is", null)
    .order("day", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as { day: string; actual_price_per_gal: number | string } | null;
  if (!row) return null;
  const price = num(row.actual_price_per_gal);
  return price > 0 ? { day: row.day, pricePerGal: price } : null;
}

export async function syncFuelPriceDays(
  admin: SupabaseClient,
  orgId: string,
  opts: { sinceDays?: number; endIso?: string } = {},
): Promise<FuelPriceDaySyncResult> {
  const days = opts.sinceDays ?? FUEL_PRICE_BACKFILL_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > 1200)
    throw new RangeError("Fuel price day sinceDays must be an integer from 1 to 1200");
  const endIso = opts.endIso ?? new Date().toISOString();
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(endMs))
    throw new RangeError("Fuel price day endIso must be a valid ISO timestamp");
  const fromIso = new Date(endMs - days * 86_400_000).toISOString();

  const { data: orgRow } = await admin
    .from("organizations")
    .select("operating_hours")
    .eq("id", orgId)
    .maybeSingle();
  const tz = organizationTimezone(orgRow?.operating_hours);
  const fromDay = dayInTz(fromIso, tz);
  const toDay = dayInTz(endIso, tz);

  const [transactions, posted, settings] = await Promise.all([
    readAll<TransactionRow>("fuel_transactions", (from, to) =>
      admin
        .from("fuel_transactions")
        .select("fueled_at, price_per_gal, gallons")
        .eq("org_id", orgId)
        .not("price_per_gal", "is", null)
        .gt("price_per_gal", 0)
        .gte("fueled_at", fromIso)
        .lte("fueled_at", endIso)
        .order("fueled_at", { ascending: true })
        .range(from, to),
    ),
    readAll<PostedRow>("fuel_prices", (from, to) =>
      admin
        .from("fuel_prices")
        .select("observed_at, posted_price, net_price")
        .eq("org_id", orgId)
        .eq("product", "diesel")
        .gte("observed_at", fromIso)
        .lte("observed_at", endIso)
        .order("observed_at", { ascending: true })
        .range(from, to),
    ),
    admin.from("idle_settings").select("fuel_price_per_gal").eq("org_id", orgId).maybeSingle(),
  ]);

  const fills: FuelFill[] = [];
  for (const row of transactions) {
    const pricePerGal = num(row.price_per_gal);
    if (!(pricePerGal > 0)) continue;
    fills.push({
      day: dayInTz(row.fueled_at, tz),
      pricePerGal,
      gallons: Math.max(0, num(row.gallons) || 0),
    });
  }

  const settingsPrice = num(
    (settings.data as { fuel_price_per_gal: number | string | null } | null)?.fuel_price_per_gal,
  );
  const rows = buildFuelPriceDays(
    {
      fromDay,
      toDay,
      fills,
      posted: postedByDay(posted, tz),
      priorPrice: await readPriorPrice(admin, orgId, fromDay),
    },
    { settingsPricePerGal: Number.isFinite(settingsPrice) ? settingsPrice : null },
  );

  const bySource: FuelPriceDaySyncResult["bySource"] = {
    actual: 0,
    posted: 0,
    carried_forward: 0,
    settings: 0,
    default: 0,
  };
  for (const row of rows) bySource[row.priceSource] += 1;

  let rowsWritten = 0;
  const nowIso = new Date().toISOString();
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const chunk = rows.slice(i, i + WRITE_CHUNK).map((r) => ({
      org_id: orgId,
      day: r.day,
      actual_price_per_gal: r.actualPricePerGal,
      actual_gallons: r.actualGallons,
      actual_fill_count: r.actualFillCount,
      posted_price_per_gal: r.postedPricePerGal,
      posted_sample_count: r.postedSampleCount,
      effective_price_per_gal: r.effectivePricePerGal,
      price_source: r.priceSource,
      carried_from_day: r.carriedFromDay,
      synced_at: nowIso,
    }));
    const { error } = await admin
      .from("fuel_price_days")
      .upsert(chunk, { onConflict: "org_id,day" });
    requireDatabaseSuccess(error, "upsert");
    rowsWritten += chunk.length;
  }

  return { days: rows.length, fills: fills.length, bySource, rowsWritten };
}

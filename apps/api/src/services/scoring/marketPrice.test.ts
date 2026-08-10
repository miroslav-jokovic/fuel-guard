import { describe, it, expect, afterEach, vi } from "vitest";
import { loadMarketPricePerGal } from "./marketPrice.js";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";

/**
 * Regression test for audit 2026-08-09 finding D — the market-price memo cached NULL forever.
 *
 * The memo was keyed `state|day` with no TTL and no invalidation, and it stored the negative result. A
 * fill scored before that day's posted-price ingest landed therefore cached "no market" for the whole
 * state-day, and every later fill in that state on that date skipped the market branch of
 * `cost_outlier`. Since `costMinPerGal` / `costMaxPerGal` default to null, the absolute branch is
 * normally dead as well — so the rule had nothing left to fire on, silently, for the rest of the day.
 *
 * Scoring order is not something an operator controls (imports, backfills and the live queue interleave),
 * so "the first fill of the day happened to run early" is the ordinary case, not an edge case.
 *
 * The memo is module state shared by every test in this file, so each test uses its own state|day key.
 */
const stations = (n: number, price: number) =>
  Array.from({ length: n }, (_, i) => ({ price, station_id: `s${i}` }));

afterEach(() => {
  vi.useRealTimers();
});

describe("loadMarketPricePerGal — a miss must not poison the day", () => {
  it("sees the market once the day's price ingest lands", async () => {
    const empty = createSupabaseRecorder({ tables: { fuel_prices_posted: [] } });
    // First fill of the day, scored before ingest: no market, and the rule stays silent. Correct.
    expect(await loadMarketPricePerGal(empty.client, "TX", "2026-06-10T12:00:00Z")).toBeNull();

    // Ingest lands. Advance past the miss window and re-ask for the SAME state-day.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    const ingested = createSupabaseRecorder({ tables: { fuel_prices_posted: stations(6, 3.85) } });
    // This returned null before the fix — cached from the pre-ingest lookup, for the rest of the day.
    expect(await loadMarketPricePerGal(ingested.client, "TX", "2026-06-10T12:00:00Z")).toBe(3.85);
    expect(ingested.forTable("fuel_prices_posted")).toHaveLength(1); // it really did re-query
  });

  it("does not re-query per fill while the state-day is still genuinely empty", async () => {
    const rec = createSupabaseRecorder({ tables: { fuel_prices_posted: [] } });
    for (let i = 0; i < 5; i++) {
      expect(await loadMarketPricePerGal(rec.client, "OK", "2026-06-11T12:00:00Z")).toBeNull();
    }
    // Bounded staleness, not a per-fill query storm: one lookup covers the miss window.
    expect(rec.forTable("fuel_prices_posted")).toHaveLength(1);
  });

  it("memoizes a RESOLVED median for the rest of the run", async () => {
    const rec = createSupabaseRecorder({ tables: { fuel_prices_posted: stations(6, 4.1) } });
    expect(await loadMarketPricePerGal(rec.client, "NM", "2026-06-12T12:00:00Z")).toBe(4.1);
    const other = createSupabaseRecorder({ tables: { fuel_prices_posted: stations(6, 9.99) } });
    expect(await loadMarketPricePerGal(other.client, "NM", "2026-06-12T12:00:00Z")).toBe(4.1);
    expect(other.forTable("fuel_prices_posted")).toHaveLength(0); // served from the memo
  });

  it("keeps the ≥5-station floor — a thin market is a miss, not a median", async () => {
    const rec = createSupabaseRecorder({ tables: { fuel_prices_posted: stations(4, 3.5) } });
    expect(await loadMarketPricePerGal(rec.client, "WY", "2026-06-13T12:00:00Z")).toBeNull();
  });
});

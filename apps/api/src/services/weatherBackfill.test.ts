import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { backfillTemperatures } from "./weatherBackfill.js";
import type { OpenMeteoFetcher } from "../lib/openMeteo.js";

function makeAdmin(cacheRows: { hour_utc: string; temp_f: number | null }[]) {
  const upserts: Record<string, unknown>[] = [];
  const admin = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    gte() {
                      return { lte: async () => ({ data: cacheRows }) };
                    },
                  };
                },
              };
            },
          };
        },
        upsert(rows: Record<string, unknown>[]) {
          upserts.push(...rows);
          return Promise.resolve({ error: null });
        },
      };
    },
  } as unknown as SupabaseClient;
  return { admin, upserts };
}

const dayFor = (): { time: string[]; temperatureF: (number | null)[] } => ({
  time: Array.from({ length: 24 }, (_, h) => `2026-07-08T${String(h).padStart(2, "0")}:00`),
  temperatureF: Array.from({ length: 24 }, (_, h) => 50 + h),
});

describe("backfillTemperatures", () => {
  it("fetches + caches when the cell is not cached, and fills the event's hour", async () => {
    const { admin, upserts } = makeAdmin([]); // empty cache → fetch path
    let calls = 0;
    const fetcher: OpenMeteoFetcher = async () => {
      calls++;
      return dayFor();
    };
    const out = await backfillTemperatures(
      admin,
      [{ eventUuid: "e1", lat: 41.88, lng: -87.63, startTime: "2026-07-08T04:10:00Z" }],
      fetcher,
    );
    expect(calls).toBe(1);
    expect(out.get("e1")).toBe(54); // hour 04 → 50 + 4
    expect(upserts.length).toBe(24); // whole day persisted
  });

  it("uses the cache and does NOT fetch when the cell is already cached", async () => {
    const { admin } = makeAdmin([{ hour_utc: "2026-07-08T04:00:00Z", temp_f: 71 }]);
    let calls = 0;
    const fetcher: OpenMeteoFetcher = async () => {
      calls++;
      return dayFor();
    };
    const out = await backfillTemperatures(
      admin,
      [{ eventUuid: "e1", lat: 41.88, lng: -87.63, startTime: "2026-07-08T04:05:00Z" }],
      fetcher,
    );
    expect(calls).toBe(0);
    expect(out.get("e1")).toBe(71);
  });

  it("skips events without coordinates", async () => {
    const { admin } = makeAdmin([]);
    const fetcher: OpenMeteoFetcher = async () => dayFor();
    const out = await backfillTemperatures(
      admin,
      [{ eventUuid: "e1", lat: null, lng: null, startTime: "2026-07-08T04:00:00Z" }],
      fetcher,
    );
    expect(out.size).toBe(0);
  });
});

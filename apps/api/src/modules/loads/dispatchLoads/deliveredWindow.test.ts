import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { loadsHistoryFrom } from "./deliveredWindow.js";

/**
 * The floor the Loads page names beside its Delivered window (D-DLC6, D-DLC10). After the backfill an
 * April delivery sits in core with an October `created_at`, so the floor must come from the delivery
 * stop's departure, with the earliest row only as the fallback for an org that has delivered nothing.
 *
 * Fixtures are functions of the query: the recorder applies no filters, so a flat list would answer a
 * query that forgot the org or the stop kind.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const FIRST_ROW = "2026-09-17T14:02:11.000Z";
const APRIL = "2026-04-03T19:30:00.000Z";

const has = (q: RecordedQuery, col: string, val: unknown) => q.filters().some((f) => f.col === col && f.val === val);
const scoped = (q: RecordedQuery) => has(q, "org_id", ORG);

const org = (stops: { actual_departure_at: string }[]) =>
  createSupabaseRecorder({
    tables: {
      loads: (q: RecordedQuery) => (scoped(q) ? [{ created_at: FIRST_ROW }] : []),
      load_stops: (q: RecordedQuery) => (scoped(q) && has(q, "kind", "dropoff") ? stops : []),
    },
  });

describe("loadsHistoryFrom", () => {
  it("is the earliest delivery held, not the earliest row, once the backfill has brought older deliveries", async () => {
    const rec = org([{ actual_departure_at: APRIL }]);
    expect(await loadsHistoryFrom(rec.client, ORG)).toBe(APRIL);
    expectOrgScoped(rec, ORG);
  });

  it("falls back to the earliest row for an org whose stops carry no departure yet", async () => {
    const rec = org([]);
    expect(await loadsHistoryFrom(rec.client, ORG)).toBe(FIRST_ROW);
  });

  it("never names a delivery later than the first row — the floor is the earlier of the two", async () => {
    const rec = org([{ actual_departure_at: "2026-10-01T00:00:00.000Z" }]);
    expect(await loadsHistoryFrom(rec.client, ORG)).toBe(FIRST_ROW);
  });

  it("is null for an org with no loads", async () => {
    const rec = createSupabaseRecorder({ tables: { loads: [], load_stops: [] } });
    expect(await loadsHistoryFrom(rec.client, ORG)).toBeNull();
  });
});

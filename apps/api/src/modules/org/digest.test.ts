import { describe, it, expect } from "vitest";
import { buildDigestData } from "./digest.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { FUEL_EVENT_DROP, FUEL_EVENT_DROP_UNVERIFIED } from "../fuel/index.js";

const ORG = "org-1";

/**
 * WHY THIS SUITE EXISTS. The weekly digest reports `fuel_events` to the carrier under the heading
 * "Siphoning", and until 2026-09-06 it selected every row of the table for the org — which was
 * harmless only because exactly one kind of row existed. The webhook's sensor-reliability gate
 * introduced a second kind (`fuel/fuelEventTypes.ts`), stored precisely so it is NOT believed, and
 * the digest is the surface where believing it would have cost the most: an email to the operator
 * naming a truck as a theft suspect on the strength of a sensor this product has already judged
 * untrustworthy.
 */
describe("the weekly digest's siphoning section", () => {
  // The recorder does not filter, so the fixture answers according to the filter the code applied.
  // A digest that forgot `event_type` gets BOTH rows back and reports two thefts instead of one.
  const fuelEvents = (q: RecordedQuery) => {
    const believed = { vehicle_id: "veh-1", drop_pct: 22, happened_at: "2026-09-05T08:00:00Z" };
    const unverified = { vehicle_id: "veh-2", drop_pct: 31, happened_at: "2026-09-05T09:00:00Z" };
    const type = q.filters().find((f) => f.col === "event_type")?.val;
    if (type === FUEL_EVENT_DROP) return { data: [believed] };
    if (type === FUEL_EVENT_DROP_UNVERIFIED) return { data: [unverified] };
    return { data: [unverified, believed] };
  };

  it("counts only drops the fuel-sensor gate believed, and stays org-scoped", async () => {
    const rec = createSupabaseRecorder({ tables: { fuel_events: fuelEvents } });

    const digest = await buildDigestData(rec.client, ORG);

    expect(digest.siphons).toHaveLength(1);
    expect(digest.siphons[0]!.dropPct).toBe(22);
    expectOrgScoped(rec, ORG);
  });
});

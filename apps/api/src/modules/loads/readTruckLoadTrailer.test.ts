import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { readTruckLoadTrailer } from "./liveLoadReads.js";

/**
 * The fuel planner's "what does this truck pull" (TRAILER-LINK-PLAN TL3): the trailer on the load the truck
 * is hauling now, chosen by the map's rule. The recorder returns every fixture row, so the choice among them
 * is this function's.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const read = (loads: unknown[]) => {
  const rec = createSupabaseRecorder({ tables: { loads: { data: loads } } });
  return { rec, answer: readTruckLoadTrailer(rec.client, ORG, "veh-1") };
};

describe("readTruckLoadTrailer", () => {
  it("answers from the load under way, not a finished one listed first", async () => {
    const { rec, answer } = read([
      { id: "done", ref: "100", status: "delivered", source: "tms", trailers: { is_reefer: false } },
      { id: "now", ref: "101", status: "in_transit", source: "tms", trailers: { is_reefer: true } },
    ]);
    expect(await answer).toEqual({ loadId: "now", trailerIsReefer: true });
    expectOrgScoped(rec, ORG);
  });

  it("a load with no trailer is not a reefer", async () => {
    const { answer } = read([{ id: "now", ref: "101", status: "in_transit", source: "tms", trailers: null }]);
    expect(await answer).toEqual({ loadId: "now", trailerIsReefer: false });
  });

  it("is null when the truck is on no load", async () => {
    const { answer } = read([{ id: "done", ref: "100", status: "delivered", source: "tms", trailers: { is_reefer: true } }]);
    expect(await answer).toBeNull();
  });
});

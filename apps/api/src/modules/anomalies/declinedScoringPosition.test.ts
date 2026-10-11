import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { testEnv } from "../../testing/testEnv.js";

// The scorer's two collaborators outside this module: the Samsara probe and the card-assignment
// lookup. Everything else it reads goes through the recorder, so the QUERY is asserted too.
const recon = vi.fn();
vi.mock("../samsara/index.js", () => ({ reconcileWithSamsara: (...a: unknown[]) => recon(...a) }));
vi.mock("../fuel/index.js", () => ({
  lookupCardAssignment: async () => null,
  syncCardAssignments: async () => undefined,
  resolveDeclineDrivers: async () => 0,
}));

const { scoreDeclinedAttempt } = await import("./declinedScoring.js");

const ORG = "org-real";
const DECLINE = "decl-1";
const env = testEnv();

// The 2026-09-23 00:16Z South Bend attempt on card …27564 (CARD-FRAUD-ALERTS-PLAN.md §1).
const declineRow = {
  id: DECLINE,
  org_id: ORG,
  vehicle_id: "veh-729",
  driver_id: null,
  driver_ext_id: null,
  declined_at: "2026-09-23T00:16:00Z",
  card_ref: "7083050030727564",
  city: "SOUTH BEND",
  state: "IN",
  location_text: "PILOT SOUTH BEND",
  error_code: "3",
  error_description: "INACTIVE CARD IN0851565240|Non-Active Card|",
};
const MEMPHIS = { at: "2026-09-23T00:10:00Z", lat: 35.1495, lng: -90.049, city: "Memphis", state: "TN", address: "Memphis, TN, 38103", milesToStation: 495.5 };
const reconWith = (truckAtReportedTime: unknown) => ({
  locationMatched: false,
  locationConfidence: "mismatch",
  stationLat: 41.6764,
  stationLng: -86.252,
  truckAtReportedTime,
});

const recorder = (opts: { scoresWriteError?: unknown } = {}) =>
  createSupabaseRecorder({
    tables: {
      // Function fixtures: a read answers only when the filters it applied name this decline and org
      // (`supabase-recorder-does-not-filter`).
      declined_transactions: (q: RecordedQuery) => {
        const f = q.filters();
        const scoped = f.some((x) => x.col === "org_id" && x.val === ORG);
        const byId = f.some((x) => x.col === "id" && x.val === DECLINE);
        return scoped && byId ? [declineRow] : [];
      },
      vehicles: (q: RecordedQuery) => (q.filters().some((x) => x.col === "id" && x.val === "veh-729") && q.filters().some((x) => x.col === "org_id" && x.val === ORG) ? [{ id: "veh-729", samsara_vehicle_id: "sv-729", unit_number: "729" }] : []),
      declined_txn_scores: { data: [], error: null, writeError: opts.scoresWriteError },
    },
  });

const scoresWrite = (rec: ReturnType<typeof createSupabaseRecorder>) => rec.forTable("declined_txn_scores").filter((q) => q.write);

describe("scoreDeclinedAttempt — stores where the truck was (CF1, migration 0408)", () => {
  beforeEach(() => recon.mockReset());

  it("writes the truck's position to the satellite, scoped to the decline and the org", async () => {
    recon.mockResolvedValue(reconWith(MEMPHIS));
    const rec = recorder();
    await scoreDeclinedAttempt(rec.client as SupabaseClient, env, ORG, DECLINE);

    const writes = scoresWrite(rec);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.write!.method).toBe("update");
    expect(writes[0]!.write!.payload).toEqual({
      truck_position_at: "2026-09-23T00:10:00Z",
      truck_lat: 35.1495,
      truck_lng: -90.049,
      truck_city: "Memphis",
      truck_state: "TN",
      truck_address: "Memphis, TN, 38103",
      truck_station_miles: 495.5,
    });
    expect(writes[0]!.filters()).toEqual(expect.arrayContaining([{ col: "declined_id", val: DECLINE }, { col: "org_id", val: ORG }]));
    expectOrgScoped(rec, ORG);
  });

  it("clears an old position when the re-score cannot measure the truck — all seven null, never left standing", async () => {
    recon.mockResolvedValue(reconWith(null));
    const rec = recorder();
    await scoreDeclinedAttempt(rec.client as SupabaseClient, env, ORG, DECLINE);
    const payload = scoresWrite(rec)[0]!.write!.payload as Record<string, unknown>;
    expect(Object.keys(payload)).toHaveLength(7);
    expect(Object.values(payload).every((v) => v === null)).toBe(true);
  });

  it("a failed position write does not fail the score — the verdict is still stored", async () => {
    recon.mockResolvedValue(reconWith(MEMPHIS));
    const rec = recorder({ scoresWriteError: { message: "column truck_position_at does not exist" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(scoreDeclinedAttempt(rec.client as SupabaseClient, env, ORG, DECLINE)).resolves.toBeUndefined();
    const verdict = rec.writtenRows("declined_transactions")[0]!;
    expect(verdict.samsara_location_matched).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("truck position not stored"));
    warn.mockRestore();
  });
});

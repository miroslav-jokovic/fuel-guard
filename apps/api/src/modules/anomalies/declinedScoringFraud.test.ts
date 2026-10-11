import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyDeclineReason, failedPromptOf, foldFraudAttempts, type FraudAttempt } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { createCardFraudStore } from "../../testing/cardFraudStore.js";
import { testEnv } from "../../testing/testEnv.js";

// The decline scorer records card fraud incidents (CF2, chunk 5c). Samsara and the card-assignment
// lookup are mocked; every other read goes through the recorder, so the QUERY is asserted too, and the
// incident store is `cardFraudStore` (0438's contract; the SQL itself is proven in PGlite).
const recon = vi.fn();
vi.mock("../samsara/index.js", () => ({ reconcileWithSamsara: (...a: unknown[]) => recon(...a) }));
vi.mock("../fuel/index.js", () => ({
  lookupCardAssignment: async () => null,
  syncCardAssignments: async () => undefined,
  resolveDeclineDrivers: async () => 0,
}));

const { scoreDeclinedAttempt } = await import("./declinedScoring.js");

const ORG = "org-real";
const env = testEnv();

// The 13 declines of 2026-09-02..10-02 that kept `location_mismatch`, and the four proximity declines a
// good fill followed, verbatim from production (read-only, 2026-10-07; the same rows as chunk 5a's test
// and the 0438 matrix). [declined_at, card tail, unit, city, state, Samsara at station, EFS text]
const ROWS: Array<[string, string, string, string, string, boolean, string]> = [
  ["2026-09-07T09:18:00Z", "27975", "589", "AVOCA", "IA", true, "INVALID TRUCKSTOP IN0904907240|Merchant Position Too Far|"],
  ["2026-09-11T10:01:00Z", "07967", "555", "JACKSONVILLE", "FL", false, "INVALID TRUCKSTOP|Merchant Position Too Far|"],
  ["2026-09-11T10:01:00Z", "07967", "555", "JACKSONVILLE", "FL", false, "INVALID TRUCKSTOP|Failed restrictions|"],
  ["2026-09-11T21:04:00Z", "07967", "555", "JACKSONVILLE", "FL", false, "INACTIVE CARD|Non-Active Card|"],
  ["2026-09-12T12:57:00Z", "37550", "506", "VANDALIA", "IL", true, "INVALID TRUCKSTOP IN0524630858|Merchant Position Too Far|"],
  ["2026-09-22T13:13:00Z", "07977", "768", "BOWMAN", "SC", true, "INVALID TRUCKSTOP IN0894710933|Merchant Position Too Far|"],
  ["2026-09-22T16:48:00Z", "57972", "649", "CORBIN", "KY", true, "INVALID TRUCKSTOP IN0914018844|Merchant Position Too Far|"],
  ["2026-09-22T19:24:00Z", "27564", "729", "SOUTH BEND", "IN", false, "INVALID INFORMATION|ODOMETER|171662 IN0851404194||"],
  ["2026-09-22T19:24:00Z", "27564", "729", "SOUTH BEND", "IN", false, "INVALID INFORMATION|ODOMETER|171662 IN0851404457||"],
  ["2026-09-22T20:45:00Z", "77960", "739", "WAYLAND", "MO", false, "INACTIVE CARD IN0845001699|Non-Active Card|"],
  ["2026-09-23T00:16:00Z", "27564", "729", "SOUTH BEND", "IN", false, "INACTIVE CARD IN0851565240|Non-Active Card|"],
  ["2026-09-23T13:36:00Z", "87149", "735", "HARRISONBURG", "VA", false, "INACTIVE CARD|Non-Active Card|"],
  ["2026-09-26T03:47:00Z", "37977", "799", "FRANKLIN", "KY", false, "INVALID INFORMATION|DRIVER ID|ODOMETER IN0532460506||"],
  ["2026-09-26T03:47:00Z", "37977", "799", "FRANKLIN", "KY", false, "INVALID INFORMATION|DRIVER ID|ODOMETER IN0532460568||"],
  ["2026-09-26T22:42:00Z", "37977", "799", "FRANKLIN", "KY", false, "INACTIVE CARD IN0532837915|Non-Active Card|"],
  ["2026-09-27T12:46:00Z", "27564", "729", "SOUTH BEND", "IN", false, "INACTIVE CARD IN0854141423|Non-Active Card|"],
  ["2026-10-01T22:50:00Z", "07967", "555", "JACKSONVILLE", "FL", false, "INACTIVE CARD IN0535688009|Non-Active Card|"],
];
const declines = ROWS.map(([at, tail, unit, city, state, matched, desc], i) => ({
  row: {
    id: `decl-${String(i).padStart(2, "0")}`, org_id: ORG, vehicle_id: `veh-${unit}`, driver_id: null, driver_ext_id: null,
    declined_at: at, card_ref: `70830500000003${tail}`, city, state, location_text: null, error_code: null, error_description: desc,
  },
  unit,
  matched,
}));
const byId = new Map(declines.map((d) => [d.row.id, d]));

const MEMPHIS = { at: "2026-09-23T00:10:00Z", lat: 35.1495, lng: -90.049, city: "Memphis", state: "TN", address: "Memphis, TN, 38103", milesToStation: 495.5 };
const reconWith = (matched: boolean | null, truck: unknown = null) => ({
  locationMatched: matched, locationConfidence: matched === false ? "mismatch" : "match", stationLat: 41.6, stationLng: -86.2, truckAtReportedTime: truck,
});

const has = (q: RecordedQuery, col: string, val: unknown) => q.filters().some((f) => f.col === col && f.val === val);

function setup(opts: { fills?: unknown[]; rpcError?: boolean } = {}) {
  const store = createCardFraudStore();
  const rec = createSupabaseRecorder({
    tables: {
      ...store.tables,
      // Function fixtures: a read answers only when its filters name the org (`supabase-recorder-does-not-filter`).
      declined_transactions: (q) => {
        const d = declines.find((x) => has(q, "id", x.row.id));
        return has(q, "org_id", ORG) && d ? [d.row] : [];
      },
      vehicles: (q) => {
        if (!has(q, "org_id", ORG)) return [];
        const d = declines.find((x) => has(q, "id", `veh-${x.unit}`));
        return d ? [{ id: `veh-${d.unit}`, samsara_vehicle_id: `sv-${d.unit}`, unit_number: d.unit }] : [];
      },
      fuel_transactions: (q) => (has(q, "org_id", ORG) ? (opts.fills ?? []) : []),
    },
    rpc: opts.rpcError ? { card_fraud_record: { error: { message: "permission denied for function card_fraud_record" } } } : store.rpc,
  });
  const score = async (id: string) => {
    recon.mockResolvedValue(reconWith(byId.get(id)!.matched, MEMPHIS));
    await scoreDeclinedAttempt(rec.client as SupabaseClient, env, ORG, id);
  };
  const fraudWrites = () => rec.rpcs().filter((c) => c.fn === "card_fraud_record").map((c) => c.args as Record<string, unknown>);
  return { store, rec, score, fraudWrites };
}

const SOUTH_BEND_0016 = "decl-10";

describe("scoreDeclinedAttempt records card fraud incidents (CF2, chunk 5c)", () => {
  beforeEach(() => recon.mockReset());

  it("a decline where Samsara has the truck away, unexplained, is recorded: the card, the reason, the truck, scoped to the org", async () => {
    const { store, rec, score, fraudWrites } = setup();
    await score(SOUTH_BEND_0016);
    expect(fraudWrites()).toHaveLength(1);
    expect(fraudWrites()[0]).toMatchObject({
      p_org: ORG, p_card_key: "7083050000000327564", p_attempt_source: "decline", p_attempt_id: SOUTH_BEND_0016,
      p_attempted_at: "2026-09-23T00:16:00.000Z", p_level: "escalated", p_step: "opened",
      p_last_truck: { at: "2026-09-23T00:10:00Z", city: "Memphis", state: "TN", milesToStation: 495.5 },
      p_places: [expect.objectContaining({ city: "SOUTH BEND", state: "IN" })],
    });
    expect(store.incidents).toHaveLength(1);
    expectOrgScoped(rec, ORG);
  });

  it("the scorer's corrective fill explains it (wrong_unit_number): nothing is recorded", async () => {
    const corrective = { vehicle_id: "veh-other", driver_id: null, card_ref: "7083050000000327564", city: "SOUTH BEND", state: "IN", location_text: null, fueled_at: "2026-09-23T00:30:00Z" };
    const { rec, score, fraudWrites } = setup({ fills: [corrective] });
    await score(SOUTH_BEND_0016);
    const verdict = rec.writtenRows("declined_transactions")[0]!;
    expect((verdict.suspicion_reasons as Array<{ key: string }>).map((r) => r.key)).toContain("wrong_unit_number");
    expect(fraudWrites()).toHaveLength(0);
    expect(rec.forTable("card_fraud_incidents")).toHaveLength(0);
  });

  it("Samsara has the truck at the station, or cannot tell: no incident read or written", async () => {
    const { rec, score } = setup();
    await score("decl-00"); // Avoca, a proximity decline Samsara placed at the station
    recon.mockResolvedValue(reconWith(null));
    await scoreDeclinedAttempt(rec.client as SupabaseClient, env, ORG, SOUTH_BEND_0016);
    expect(rec.writtenRows("declined_transactions")).toHaveLength(2);
    expect(rec.rpcs().filter((c) => c.fn === "card_fraud_record")).toHaveLength(0);
    expect(rec.forTable("card_fraud_incidents")).toHaveLength(0);
  });

  it("a failed incident write never fails the score: the verdict is stored and the failure logged", async () => {
    const { rec, score } = setup({ rpcError: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(score(SOUTH_BEND_0016)).resolves.toBeUndefined();
    expect(rec.writtenRows("declined_transactions")[0]!.samsara_location_matched).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`decline ${SOUTH_BEND_0016} not recorded`));
    warn.mockRestore();
  });

  it("CF2 check: scoring production's 17 declines leaves 7 incidents, 13 attempts and 8 steps, as the fold says; re-scoring changes nothing", async () => {
    const { store, rec, score } = setup();
    const ordered = [...declines].sort((x, y) => x.row.declined_at.localeCompare(y.row.declined_at) || x.row.id.localeCompare(y.row.id));
    for (const d of ordered) await score(d.row.id);

    expect(store.incidents).toHaveLength(7);
    expect(store.attempts).toHaveLength(13);
    expect(store.attempts.filter((a) => a.step != null)).toHaveLength(8);
    expect(store.attempts.filter((a) => a.step === "opened")).toHaveLength(7);
    const proximity = declines.filter((d) => d.matched).map((d) => d.row.id);
    expect(store.attempts.some((a) => proximity.includes(a.source_id))).toBe(false);

    // The same attempts folded in one pass, built from the rows rather than by the code under test.
    const folded = foldFraudAttempts(declines.map((d): FraudAttempt => ({
      id: d.row.id, source: "decline", at: new Date(d.row.declined_at).toISOString(), cardRef: d.row.card_ref,
      vehicleId: d.row.vehicle_id, city: d.row.city, state: d.row.state, samsaraAtStation: d.matched, explainedByFill: false,
      reason: classifyDeclineReason(null, d.row.error_description).category, failedPrompt: failedPromptOf(d.row.error_description), truck: null,
    })));
    const shape = (key: string, level: string, count: number, steps: unknown) => JSON.stringify([key, level, count, steps]);
    expect(store.incidents.map((i) => shape(i.incident_key, i.level, i.attempt_count, i.steps)).sort())
      .toEqual(folded.map((i) => shape(i.key, i.level, i.attemptIds.length, i.steps)).sort());

    const before = JSON.stringify(store.incidents);
    for (const d of ordered) await score(d.row.id);
    expect(store.attempts).toHaveLength(13);
    expect(JSON.stringify(store.incidents)).toBe(before);
    expectOrgScoped(rec, ORG);
  });
});

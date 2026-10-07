import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { createCardFraudStore } from "../../testing/cardFraudStore.js";
import { fillFraudAttempt, recordCardFraud } from "./cardFraudIncidents.js";

// The fill scorer's hook (CF2, chunk 5c): `scoreTransaction` calls
// `recordCardFraud(admin, orgId, fillFraudAttempt(r, recon))` once the score is stored; the wiring itself
// is asserted in scoring/scoreTransaction.test.ts. The store is `cardFraudStore` (0438's contract).

const ORG = "org-real";

// Production, read-only 2026-10-07: card …67559 (truck 604) bought 136.63 gal in Bellemont, AZ at 17:34
// on 06-06 while Samsara had the truck in Stratford, TX; the same card filled in Stratford at 20:27.
const bellemont = {
  id: "5cfca745-9ac1-4cd3-a99a-c9244949d014", fueled_at: "2026-06-06 17:34:00+00", card_ref: "7083050000000367559",
  vehicle_id: "veh-604", city: "BELLEMONT", state: "AZ",
};
const away = {
  samsaraLocationMatched: false, reconAt: "2026-06-06T19:58:00Z", observedCity: "Stratford", observedState: "TX", nearestStationMiles: 225.5,
};

function setup() {
  const store = createCardFraudStore();
  const rec = createSupabaseRecorder({ tables: store.tables, rpc: store.rpc });
  const writes = () => rec.rpcs().filter((c) => c.fn === "card_fraud_record").map((c) => c.args as Record<string, unknown>);
  return { store, rec, admin: rec.client as SupabaseClient, writes };
}

describe("the fill scorer's card fraud hook (CF2, chunk 5c)", () => {
  it("an approved fill where Samsara has the truck away opens an escalated incident with fuel taken, scoped to the org", async () => {
    const { store, rec, admin, writes } = setup();
    await recordCardFraud(admin, ORG, fillFraudAttempt(bellemont, away));
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({
      p_org: ORG, p_card_key: "7083050000000367559", p_attempt_source: "fill", p_attempt_id: bellemont.id,
      p_attempted_at: "2026-06-06T17:34:00.000Z", p_level: "escalated", p_fuel_taken: true, p_step: "opened",
      p_failed_prompts: [],
      p_last_truck: { at: "2026-06-06T19:58:00.000Z", city: "Stratford", state: "TX", milesToStation: 225.5 },
    });
    expect(store.incidents).toHaveLength(1);
    expectOrgScoped(rec, ORG);
  });

  it("a fill Samsara placed at the station, or could not place, touches nothing", async () => {
    const { rec, admin } = setup();
    await recordCardFraud(admin, ORG, fillFraudAttempt(bellemont, { ...away, samsaraLocationMatched: true }));
    await recordCardFraud(admin, ORG, fillFraudAttempt(bellemont, { ...away, samsaraLocationMatched: null }));
    expect(rec.queries).toHaveLength(0);
  });

  it("a fill with no card has no card to hold an incident", () => {
    expect(fillFraudAttempt({ ...bellemont, card_ref: null }, away)).toBeNull();
  });

  it("no position measured: the truck is unknown, not a position at the fill's time", () => {
    const a = fillFraudAttempt(bellemont, { ...away, observedCity: null, observedState: null, nearestStationMiles: null });
    expect(a!.truck).toBeNull();
  });

  it("a re-score of the same fill records nothing more", async () => {
    const { store, admin, writes } = setup();
    await recordCardFraud(admin, ORG, fillFraudAttempt(bellemont, away));
    await recordCardFraud(admin, ORG, fillFraudAttempt(bellemont, away));
    expect(writes()).toHaveLength(1);
    expect(store.attempts).toHaveLength(1);
  });
});

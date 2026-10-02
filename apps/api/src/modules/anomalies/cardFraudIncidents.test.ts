import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyFraudAttempt, type FraudAttempt } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { recordFraudAttempt } from "./cardFraudIncidents.js";

const ORG = "org-real";
const CARD = "7083050030727564";
// The 2026-09-22 19:24Z South Bend attempt on card …27564, and the 00:16Z one after it.
const first: FraudAttempt = {
  id: "d04",
  source: "decline",
  at: "2026-09-22T19:24:00Z",
  cardRef: CARD,
  vehicleId: "veh-729",
  unit: "729",
  city: "SOUTH BEND",
  state: "IN",
  reason: "invalid_info",
  failedPrompt: "odometer",
  truck: null,
};
const later: FraudAttempt = { ...first, id: "d06", at: "2026-09-23T00:16:00Z", reason: "card_not_active", failedPrompt: null };
const openRow = (status = "open") => {
  const { closed: _c, ...state } = applyFraudAttempt(null, first).incident;
  return { id: "inc-1", incident_key: state.key, version: 4, status, state };
};

/** A scripted RPC: answers each call in turn with the next reply (`[]` = refused). */
const replies = (...rs: unknown[]) => {
  let n = 0;
  return (fn: string) => (fn === "card_fraud_record" ? rs[Math.min(n++, rs.length - 1)] : null);
};

const recorder = (o: { incident?: unknown; recorded?: boolean | ((n: number) => boolean); rpc: (fn: string, args: unknown) => unknown }) => {
  let reads = 0;
  return createSupabaseRecorder({
    tables: {
      // Function fixtures answer only a query scoped to this org (`supabase-recorder-does-not-filter`).
      card_fraud_incidents: (q: RecordedQuery) =>
        q.filters().some((f) => f.col === "org_id" && f.val === ORG) && q.filters().some((f) => f.col === "card_ref" && f.val === CARD) && o.incident
          ? [o.incident]
          : [],
      card_fraud_incident_attempts: (q: RecordedQuery) => {
        const scoped = q.filters().some((f) => f.col === "org_id" && f.val === ORG);
        const seen = typeof o.recorded === "function" ? o.recorded(reads++) : !!o.recorded;
        return scoped && seen ? [{ incident_id: "inc-1" }] : [];
      },
    },
    rpc: o.rpc,
  });
};
const args = (rec: ReturnType<typeof createSupabaseRecorder>) => rec.rpcs().map((r) => r.args as Record<string, unknown>);

describe("recordFraudAttempt (CF2)", () => {
  it("opens an incident when the card has none, and every read is scoped to the org", async () => {
    const rec = recorder({ rpc: replies([{ incident_id: "inc-new", version: 1 }]) });
    const r = await recordFraudAttempt(rec.client as SupabaseClient, ORG, first);
    expect(r).toMatchObject({ incidentId: "inc-new", step: "opened" });
    const [call] = args(rec);
    expect(call).toMatchObject({ p_org: ORG, p_expected_version: null, p_incident_key: `${CARD}@d04`, p_attempt_id: "d04", p_step: "opened", p_attempt_count: 1 });
    expect(call!.p_state).not.toHaveProperty("closed");
    expectOrgScoped(rec, ORG);
  });

  it("joins the open incident at the version it read", async () => {
    const rec = recorder({ incident: openRow(), rpc: replies([{ incident_id: "inc-1", version: 5 }]) });
    const r = await recordFraudAttempt(rec.client as SupabaseClient, ORG, later);
    expect(r!.step).toBe("inactive_card");
    expect(args(rec)[0]).toMatchObject({ p_expected_version: 4, p_incident_key: openRow().incident_key, p_attempt_count: 2 });
  });

  it("a closed incident is never joined — the attempt opens a new one", async () => {
    const rec = recorder({ incident: openRow("dismissed"), rpc: replies([{ incident_id: "inc-2", version: 1 }]) });
    const r = await recordFraudAttempt(rec.client as SupabaseClient, ORG, later);
    expect(r!.step).toBe("opened");
    expect(args(rec)[0]).toMatchObject({ p_expected_version: null, p_incident_key: `${CARD}@d06` });
  });

  it("an attempt already recorded is a no-op — no read of the incident, no write", async () => {
    const rec = recorder({ recorded: true, rpc: replies([{ incident_id: "x", version: 9 }]) });
    expect(await recordFraudAttempt(rec.client as SupabaseClient, ORG, first)).toBeNull();
    expect(rec.rpcs()).toHaveLength(0);
    expect(rec.forTable("card_fraud_incidents")).toHaveLength(0);
  });

  it("a refused write re-reads and re-applies, and lands on the next try", async () => {
    const rec = recorder({ incident: openRow(), rpc: replies([], [{ incident_id: "inc-1", version: 6 }]) });
    const r = await recordFraudAttempt(rec.client as SupabaseClient, ORG, later);
    expect(r!.incidentId).toBe("inc-1");
    expect(rec.rpcs()).toHaveLength(2);
    expect(rec.forTable("card_fraud_incidents")).toHaveLength(2);
  });

  it("a refusal because another worker recorded this attempt first is a quiet no-op", async () => {
    // Not recorded at the first look, recorded by the time the refusal is checked.
    const rec = recorder({ incident: openRow(), recorded: (n) => n > 0, rpc: replies([]) });
    expect(await recordFraudAttempt(rec.client as SupabaseClient, ORG, later)).toBeNull();
    expect(rec.rpcs()).toHaveLength(1);
  });

  it("three refusals in a row is not a race, and says so", async () => {
    const rec = recorder({ incident: openRow(), rpc: replies([]) });
    await expect(recordFraudAttempt(rec.client as SupabaseClient, ORG, later)).rejects.toThrow(/refused 3 times/);
    expect(rec.rpcs()).toHaveLength(3);
  });

  it("a masked card ref is looked up together with its truck", async () => {
    const masked = { ...first, cardRef: "XXXXXXXXXXXX7564" };
    const rec = recorder({ rpc: replies([{ incident_id: "inc-m", version: 1 }]) });
    await recordFraudAttempt(rec.client as SupabaseClient, ORG, masked);
    const read = rec.forTable("card_fraud_incidents")[0]!;
    expect(read.filters()).toEqual(expect.arrayContaining([{ col: "vehicle_id", val: "veh-729" }]));
  });
});

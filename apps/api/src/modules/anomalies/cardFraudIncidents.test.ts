import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyFraudAttempt, type FraudAttempt } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { createCardFraudStore } from "../../testing/cardFraudStore.js";
import { recordCardFraud, recordFraudAttempt } from "./cardFraudIncidents.js";

// The service's loop: read the card's latest incident, apply the attempt, write through
// `card_fraud_record`, re-read on a refusal. The writer's SQL is proven in PGlite
// (supabase/tests/card-fraud-incidents.test.mjs); here the store is `cardFraudStore`, which restates
// 0438's contract, so these tests prove what the service does with each of its answers.

const ORG = "org-real";
const CARD = "7083050000000327564"; // card …27564, the South Bend card (CARD-FRAUD-ALERTS-PLAN.md §1)

const attempt = (id: string, at: string, over: Partial<FraudAttempt> = {}): FraudAttempt => ({
  id, source: "decline", at, cardRef: CARD, vehicleId: "veh-729", city: "SOUTH BEND", state: "IN",
  samsaraAtStation: false, explainedByFill: false, reason: "invalid_info", failedPrompt: "odometer", truck: null,
  ...over,
});
const first = attempt("d-1924", "2026-09-22T19:24:00.000Z");
const second = attempt("d-0016", "2026-09-23T00:16:00.000Z", { reason: "card_not_active", failedPrompt: null });
const fourDaysOn = attempt("d-1246", "2026-09-27T12:46:00.000Z", { reason: "card_not_active", failedPrompt: null });

function setup() {
  const store = createCardFraudStore();
  const rec = createSupabaseRecorder({ tables: store.tables, rpc: store.rpc });
  const admin = rec.client as SupabaseClient;
  const writes = () => rec.rpcs().filter((c) => c.fn === "card_fraud_record").map((c) => c.args as Record<string, unknown>);
  return { store, rec, admin, writes };
}

/** What another worker leaves behind when it opens an incident for `a` first. */
function openedElsewhere(store: ReturnType<typeof createCardFraudStore>, a: FraudAttempt, key: string) {
  const inc = applyFraudAttempt(null, a).incident!;
  store.incidents.push({
    id: "inc-other", org_id: ORG, card_key: key, incident_key: inc.key, card_ref: a.cardRef, vehicle_id: a.vehicleId,
    opened_at: a.at, last_attempt_at: a.at, level: inc.level, attempt_count: 1, fuel_taken: false,
    failed_prompts: inc.failedPrompts, places: inc.places, steps: inc.steps, last_truck: null, version: 1,
    status: "open", created_seq: 99,
  });
  store.attempts.push({ source: a.source, source_id: a.id, org_id: ORG, incident_id: "inc-other", attempted_at: a.at, step: "opened" });
}

describe("recordFraudAttempt — the read, apply, write, retry loop (CF2, chunk 5c)", () => {
  it("an attempt D-CF1 does not qualify touches nothing: the truck at the station, unknown, or explained by a fill", async () => {
    const { rec, admin } = setup();
    for (const over of [{ samsaraAtStation: true }, { samsaraAtStation: null }, { explainedByFill: true }]) {
      expect(await recordFraudAttempt(admin, ORG, attempt("d-x", "2026-09-22T19:24:00.000Z", over))).toBe("not_fraud");
    }
    expect(rec.queries).toHaveLength(0);
  });

  it("opens an incident when the card has none: nothing read, a new incident, the step 'opened'", async () => {
    const { store, rec, admin, writes } = setup();
    expect(await recordFraudAttempt(admin, ORG, first)).toBe("recorded");
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({
      p_org: ORG, p_card_key: CARD, p_read_id: null, p_read_version: null, p_incident_id: null,
      p_incident_key: `${CARD}@d-1924`, p_attempt_source: "decline", p_attempt_id: "d-1924", p_step: "opened",
      p_level: "escalated", p_failed_prompts: ["odometer"], p_attempt_count: 1,
    });
    expect(store.incidents).toHaveLength(1);
    expectOrgScoped(rec, ORG);
  });

  it("joins the card's incident within 72 h, naming the incident and the version it read", async () => {
    const { store, rec, admin, writes } = setup();
    await recordFraudAttempt(admin, ORG, first);
    expect(await recordFraudAttempt(admin, ORG, second)).toBe("recorded");
    expect(writes()[1]).toMatchObject({ p_read_id: "inc-1", p_read_version: 1, p_incident_id: "inc-1", p_attempt_count: 2 });
    expect(store.incidents).toHaveLength(1);
    expect(store.incidents[0]!.version).toBe(2);
    expectOrgScoped(rec, ORG);
    // "Latest" must be the writer's own order, or every write meets a 'moved'. The fake orders for
    // itself, so the query is asserted.
    const read = rec.forTable("card_fraud_incidents")[0]!.ops.filter((o) => o.method === "order").map((o) => o.args);
    expect(read).toEqual([["opened_at", { ascending: false }], ["created_at", { ascending: false }]]);
  });

  it("moved: another worker opened the card's incident after the read; the retry joins it instead of opening a second", async () => {
    const { store, admin, writes } = setup();
    store.race(() => openedElsewhere(store, first, CARD));
    expect(await recordFraudAttempt(admin, ORG, second)).toBe("recorded");
    expect(writes()).toHaveLength(2);
    expect(writes()[0]).toMatchObject({ p_read_id: null, p_incident_id: null });
    expect(writes()[1]).toMatchObject({ p_read_id: "inc-other", p_read_version: 1, p_incident_id: "inc-other", p_attempt_count: 2 });
    expect(store.incidents).toHaveLength(1);
    expect(store.attempts.map((a) => a.incident_id)).toEqual(["inc-other", "inc-other"]);
  });

  it.each(["resolved", "dismissed"])("closed (%s): a person closed the incident after the read; the retry opens a new one and leaves theirs as it was", async (status) => {
    const { store, admin, writes } = setup();
    await recordFraudAttempt(admin, ORG, first);
    store.race(() => {
      store.incidents[0]!.status = status;
    });
    expect(await recordFraudAttempt(admin, ORG, second)).toBe("recorded");
    expect(writes()[1]).toMatchObject({ p_incident_id: "inc-1" });
    expect(writes()[2]).toMatchObject({ p_read_id: "inc-1", p_incident_id: null, p_step: "opened" });
    expect(store.incidents).toHaveLength(2);
    expect(store.incidents[0]).toMatchObject({ status, version: 1, attempt_count: 1 });
    expect(store.attempts.find((a) => a.source_id === "d-0016")!.incident_id).toBe("inc-2");
  });

  it("duplicate: an attempt held by an OLDER incident is refused once and not retried", async () => {
    const { store, admin, writes } = setup();
    await recordFraudAttempt(admin, ORG, first);
    await recordFraudAttempt(admin, ORG, fourDaysOn); // more than 72 h on: a second incident
    expect(store.incidents).toHaveLength(2);
    const before = JSON.stringify(store.incidents);
    expect(await recordFraudAttempt(admin, ORG, first)).toBe("duplicate");
    expect(writes()).toHaveLength(3);
    expect(JSON.stringify(store.incidents)).toBe(before);
  });

  it("an attempt already in the latest incident is a re-score: read, never written", async () => {
    const { admin, writes } = setup();
    await recordFraudAttempt(admin, ORG, first);
    expect(await recordFraudAttempt(admin, ORG, first)).toBe("already_recorded");
    expect(writes()).toHaveLength(1);
  });

  it("three refusals in a row are not a race: it throws, and recordCardFraud logs it without the card number", async () => {
    const rec = createSupabaseRecorder({ rpc: { card_fraud_record: [{ outcome: "moved", incident_id: null, version: null }] } });
    const admin = rec.client as SupabaseClient;
    await expect(recordFraudAttempt(admin, ORG, first)).rejects.toThrow("refused 3 times");
    expect(rec.rpcs()).toHaveLength(3);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(recordCardFraud(admin, ORG, first)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("decline d-1924 not recorded"));
    expect(String(warn.mock.calls[0]![0])).not.toContain("327564");
    warn.mockRestore();
  });

  it("an answer outside the writer's four is an error, not a retry", async () => {
    const rec = createSupabaseRecorder({ rpc: { card_fraud_record: [] } });
    await expect(recordFraudAttempt(rec.client as SupabaseClient, ORG, first)).rejects.toThrow("answered undefined");
    expect(rec.rpcs()).toHaveLength(1);
  });
});

import { describe, it, expect } from "vitest";
import { transitionCardFraudIncident } from "./transitionCardFraudIncident.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";

/**
 * Closing a card-fraud incident (chunk 8c2). It mirrors `transition_anomaly` (0158); every assertion is
 * about a field that function sets, or a move it refuses.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ID = "44444444-4444-4444-8444-444444444444";
const ME = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-10-09T12:00:00Z");

/** The read answers the row; the version-guarded write answers what it updated (none on a lost race). */
const seed = (status: string, version = 3, { lostRace = false } = {}) =>
  createSupabaseRecorder({
    tables: {
      card_fraud_incidents: (q: RecordedQuery) =>
        q.write ? (lostRace ? [] : [{ id: ID, version: version + 1 }]) : [{ id: ID, status, version }],
    },
  });
const close = { status: "dismissed" as const, note: "Driver was in the truck", disposition: "false_positive" as const, version: 3 };

describe("moving a card-fraud incident", () => {
  it("closes with the disposition, who and when, takes it, bumps the version, and stays org-scoped", async () => {
    const rec = seed("open");
    const r = await transitionCardFraudIncident(rec.client, ORG, ID, ME, close, NOW);
    expect(r).toEqual({ ok: true, from: "open", to: "dismissed", version: 4 });
    expect(rec.writtenRows("card_fraud_incidents")[0]).toEqual({
      status: "dismissed", version: 4, resolution_note: "Driver was in the truck", assigned_to: ME,
      disposition: "false_positive", disposition_by: ME, disposition_at: NOW.toISOString(), updated_at: NOW.toISOString(),
    });
    const write = rec.forTable("card_fraud_incidents").find((q) => q.write)!;
    expect(write.filters()).toContainEqual({ col: "version", val: 3 });
    expectOrgScoped(rec, ORG);
  });

  it("reopens a closed incident and clears the outcome, as a fill case reopens", async () => {
    const rec = seed("resolved");
    const r = await transitionCardFraudIncident(rec.client, ORG, ID, ME, { status: "investigating", version: 3 }, NOW);
    expect(r).toMatchObject({ ok: true, to: "investigating" });
    expect(rec.writtenRows("card_fraud_incidents")[0]).toMatchObject({ disposition: null, disposition_by: null, disposition_at: null });
  });

  it("refuses a version the person did not read, and writes nothing", async () => {
    const rec = seed("open", 5);
    const r = await transitionCardFraudIncident(rec.client, ORG, ID, ME, close, NOW);
    expect(r).toMatchObject({ ok: false, code: "conflict" });
    expect(rec.writtenRows("card_fraud_incidents")).toHaveLength(0);
  });

  it("reports a conflict when the recorder or another person moved it between the read and the write", async () => {
    const rec = seed("open", 3, { lostRace: true });
    expect(await transitionCardFraudIncident(rec.client, ORG, ID, ME, close, NOW)).toMatchObject({ ok: false, code: "conflict" });
  });

  it("refuses a move the workflow does not allow", async () => {
    const rec = seed("dismissed");
    const r = await transitionCardFraudIncident(rec.client, ORG, ID, ME, { ...close, status: "resolved", disposition: "confirmed" }, NOW);
    expect(r).toMatchObject({ ok: false, code: "invalid_transition" });
    expect(rec.writtenRows("card_fraud_incidents")).toHaveLength(0);
  });

  it("answers not found for an incident outside the caller's org", async () => {
    const rec = createSupabaseRecorder({ tables: { card_fraud_incidents: [] } });
    expect(await transitionCardFraudIncident(rec.client, ORG, ID, ME, close, NOW)).toMatchObject({ ok: false, code: "not_found" });
  });
});

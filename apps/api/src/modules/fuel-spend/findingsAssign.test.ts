import { describe, it, expect } from "vitest";
import { assignFindings, findingRefsFrom, MAX_ASSIGN_BATCH } from "./findingsAssign.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";

/**
 * Giving a finding an owner across two case tables (C7b merge 3).
 *
 * Almost every assertion here is a REFUSAL, and that is the shape of the risk: a write route serving
 * two sections with no static gate is only as safe as the checks inside it, and each of those checks
 * fails silently if it is wrong — a finding assigned to somebody who cannot close it just sits there.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const E1 = "11111111-1111-4111-8111-111111111111";
const A1 = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

const I1 = "44444444-4444-4444-8444-444444444444";
const seed = (o: { exceptions?: unknown[]; anomalies?: unknown[]; incidents?: unknown[]; role?: string | null } = {}) =>
  createSupabaseRecorder({
    tables: {
      fuel_exceptions: o.exceptions ?? [{ id: E1, kind: "off_network_premium" }],
      anomalies: o.anomalies ?? [{ id: A1 }],
      card_fraud_incidents: o.incidents ?? [{ id: I1 }],
      memberships: o.role === null ? [] : [{ role: o.role ?? "admin" }],
    },
  });

const money = { source: "exception" as const, id: E1 };
const theft = { source: "anomaly" as const, id: A1 };
const card = { source: "incident" as const, id: I1 };

describe("assigning findings", () => {
  it("assigns across both tables in one act, and stays org-scoped", async () => {
    const rec = seed();
    const r = await assignFindings(rec.client, ORG, "actor", "admin", USER, [money, theft]);
    expect(r).toEqual({ ok: true, assigned: 2 });
    expect(rec.writtenRows("fuel_exceptions")[0]).toEqual({ assigned_to: USER });
    expect(rec.writtenRows("anomalies")[0]).toEqual({ assigned_to: USER });
    expectOrgScoped(rec, ORG);
  });

  // Chunk 8c1, Q-F11 (a): an incident is a fuel finding, written through the anomalies module.
  it("assigns a card-fraud incident with a money finding, both fuel, and stays org-scoped", async () => {
    const rec = seed({ role: "fleet_manager" });
    const r = await assignFindings(rec.client, ORG, "actor", "admin", USER, [money, card]);
    expect(r).toEqual({ ok: true, assigned: 2 });
    expect(rec.writtenRows("card_fraud_incidents")[0]).toEqual({ assigned_to: USER });
    expectOrgScoped(rec, ORG);
  });

  it("refuses a safety manager assigning an incident, which is fuel's", async () => {
    const rec = seed();
    const r = await assignFindings(rec.client, ORG, "actor", "safety_manager", USER, [card]);
    expect(r.ok).toBe(false);
    expect(rec.writtenRows("card_fraud_incidents")).toHaveLength(0);
  });

  it("refuses an incident id that is not in the caller's org", async () => {
    const rec = seed({ incidents: [] });
    const r = await assignFindings(rec.client, ORG, "actor", "admin", USER, [card]);
    expect(r).toMatchObject({ ok: false, code: "not_found" });
    expect(rec.writtenRows("card_fraud_incidents")).toHaveLength(0);
  });

  it("unassigns when handed nothing, rather than refusing", async () => {
    const rec = seed();
    const r = await assignFindings(rec.client, ORG, "actor", "admin", null, [money]);
    expect(r).toEqual({ ok: true, assigned: 1 });
    expect(rec.writtenRows("fuel_exceptions")[0]).toEqual({ assigned_to: null });
  });

  // Q-FUI4's ruling, enforced: the safety manager works theft cases and holds `fuel: "view"`, so a
  // policy premium is not theirs to hand out.
  it("lets a safety manager assign a theft case", async () => {
    const rec = seed();
    const r = await assignFindings(rec.client, ORG, "actor", "safety_manager", USER, [theft]);
    expect(r.ok).toBe(true);
  });

  it("refuses the whole batch when one finding is outside the caller's sections", async () => {
    const rec = seed();
    const r = await assignFindings(rec.client, ORG, "actor", "safety_manager", USER, [money, theft]);
    expect(r).toMatchObject({ ok: false, code: "forbidden" });
    // ⚠ Nothing is written. A partial success is the shape where somebody believes they cleared a
    // queue and two findings sit unowned with nothing on screen saying which.
    expect(rec.writes()).toHaveLength(0);
  });

  it("refuses a reader who can see the queue but not work it", async () => {
    const rec = seed();
    // `dispatcher` holds `fuel: "view"` — the ledger is on their nav and none of it is theirs to move.
    const r = await assignFindings(rec.client, ORG, "actor", "dispatcher", USER, [money]);
    expect(r).toMatchObject({ ok: false, code: "forbidden" });
  });

  // The caller's claim about which table a row lives in is not trusted: the kind comes from the row.
  it("refuses an id that is not in the caller's org, rather than writing on trust", async () => {
    const rec = seed({ exceptions: [] });
    const r = await assignFindings(rec.client, ORG, "actor", "admin", USER, [money]);
    expect(r).toMatchObject({ ok: false, code: "not_found" });
    expect(rec.writes()).toHaveLength(0);
  });

  /**
   * The identity the picker was built on (Q-FUI15), enforced where it is a contract rather than a
   * convenience: offering — or accepting — somebody who could not then close it is a menu whose only
   * product is a stuck finding.
   */
  it("refuses an assignee who could not close what they are being given", async () => {
    const rec = seed({ role: "dispatcher" });
    const r = await assignFindings(rec.client, ORG, "actor", "admin", USER, [money]);
    expect(r).toMatchObject({ ok: false, code: "bad_assignee" });
    expect(rec.writes()).toHaveLength(0);
  });

  it("refuses somebody who is not in this org at all", async () => {
    const rec = seed({ role: null });
    const r = await assignFindings(rec.client, ORG, "actor", "admin", USER, [money]);
    expect(r).toMatchObject({ ok: false, code: "bad_assignee" });
  });

  // A mixed selection needs an assignee who can close BOTH sections, not either.
  it("refuses a safety-only assignee for a selection spanning both sections", async () => {
    const rec = seed({ role: "safety_manager" });
    const r = await assignFindings(rec.client, ORG, "actor", "admin", USER, [money, theft]);
    expect(r).toMatchObject({ ok: false, code: "bad_assignee" });
  });

  it("takes an empty selection as nothing to do", async () => {
    const rec = seed();
    expect(await assignFindings(rec.client, ORG, "actor", "admin", USER, [])).toEqual({ ok: true, assigned: 0 });
    expect(rec.writes()).toHaveLength(0);
  });

  it("bounds the batch, so one request cannot walk a whole ledger", async () => {
    const rec = seed();
    const many = Array.from({ length: MAX_ASSIGN_BATCH + 1 }, () => money);
    const r = await assignFindings(rec.client, ORG, "actor", "admin", USER, many);
    expect(r).toMatchObject({ ok: false, code: "too_many" });
    expect(rec.writes()).toHaveLength(0);
  });
});

describe("the refs an assign request may name", () => {
  it("keeps the three sources, incidents included (chunk 8c1)", () => {
    expect(findingRefsFrom([money, theft, card])).toEqual([money, theft, card]);
  });
  it("drops an unknown source, an inherited key, a bad id and a non-list", () => {
    expect(findingRefsFrom([{ source: "toString", id: E1 }, { source: "vehicle", id: E1 }, { source: "incident", id: "x" }, null])).toEqual([]);
    expect(findingRefsFrom("nope")).toEqual([]);
  });
});

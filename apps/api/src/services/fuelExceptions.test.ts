import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../testing/supabaseRecorder.js";
import { exceptionTotals, listExceptions, moveException } from "./fuelExceptions.js";

/**
 * The ledger's server side. Its lifecycle RULES are in the PGlite matrix (`fuel-exceptions`), which is
 * where a trigger and an RPC can actually run; what is only testable here is the pairing this service
 * exists to guarantee — that a move and its act-log row happen together — and the org scoping, because
 * `admin` is the service role and bypasses RLS.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ID = "11111111-2222-4333-8444-555555555555";
const USER = "99999999-8888-4777-8666-555555555555";

const seed = (status = "open") =>
  createSupabaseRecorder({
    tables: {
      fuel_exceptions: { data: { id: ID, status } },
      fuel_exception_events: [],
    },
  });

describe("moveException", () => {
  it("records who moved a finding, in the same breath as moving it", async () => {
    const rec = seed();
    const r = await moveException(rec.client, ORG, ID, USER, { status: "disputed", note: "Raised with Pilot" });
    expect(r.ok).toBe(true);
    const [patch] = rec.writtenRows("fuel_exceptions");
    expect(patch).toMatchObject({ status: "disputed", resolution_note: "Raised with Pilot" });
    const [event] = rec.writtenRows("fuel_exception_events");
    expect(event).toMatchObject({
      exception_id: ID, kind: "status_changed", from_status: "open", to_status: "disputed", actor_id: USER,
    });
  });

  it("stamps who resolved it only when the move actually closes it", async () => {
    const rec = seed();
    await moveException(rec.client, ORG, ID, USER, { status: "credited", creditedAmount: 242.11, creditedOn: "2026-09-01" });
    const [patch] = rec.writtenRows("fuel_exceptions");
    expect(patch).toMatchObject({ status: "credited", resolved_by: USER, credited_amount: 242.11, credited_on: "2026-09-01" });
    expect(rec.writtenRows("fuel_exception_events")[0]).toMatchObject({ kind: "credited" });
  });

  it("clears a stale resolution when a finding is reopened", async () => {
    // Otherwise a reopened finding keeps the name of whoever closed it last time, and a ledger that
    // says "resolved by" about an open row is worse than one that says nothing.
    const rec = seed("dismissed");
    await moveException(rec.client, ORG, ID, USER, { status: "investigating" });
    expect(rec.writtenRows("fuel_exceptions")[0]).toMatchObject({ resolved_at: null, resolved_by: null });
  });

  it("treats a bare comment as an act worth logging", async () => {
    const rec = seed();
    await moveException(rec.client, ORG, ID, USER, { note: "Left a message with the account manager." });
    expect(rec.writtenRows("fuel_exception_events")[0]).toMatchObject({ kind: "note", actor_id: USER });
  });

  it("refuses a credited amount on a finding that is not credited", async () => {
    // The CHECK constraint agrees; answering here gives the caller a sentence rather than a violation.
    const rec = seed();
    const r = await moveException(rec.client, ORG, ID, USER, { status: "dismissed", creditedAmount: 100 });
    expect(r.ok).toBe(false);
    expect(rec.writtenRows("fuel_exceptions")).toHaveLength(0);
    expect(rec.writtenRows("fuel_exception_events")).toHaveLength(0);
  });

  it("scopes its reads and writes to one organization", async () => {
    const rec = seed();
    await moveException(rec.client, ORG, ID, USER, { status: "investigating" });
    expectOrgScoped(rec, ORG);
  });
});

describe("exceptionTotals", () => {
  it("reports identified, claimed and recovered apart — never one number", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        fuel_exceptions: [
          { status: "open", amount_kind: "unrecorded", amount: 242.11, credited_amount: null },
          { status: "disputed", amount_kind: "overbilled", amount: 500, credited_amount: null },
          { status: "credited", amount_kind: "overbilled", amount: 300, credited_amount: 275 },
          { status: "dismissed", amount_kind: "unbilled", amount: 900, credited_amount: null },
        ],
      },
    });
    const t = await exceptionTotals(rec.client, ORG);
    expect(t.identified).toBe(1942.11);
    // Claimed is what was taken to the vendor: disputed plus credited.
    expect(t.claimed).toBe(800);
    // Recovered is what came BACK, which is not what was claimed.
    expect(t.recovered).toBe(275);
    expect(t.openLines).toBe(2); // open + disputed; dismissed and credited are settled
  });

  it("keeps the kinds of money apart, because they must not be added", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        fuel_exceptions: [
          { status: "open", amount_kind: "overbilled", amount: 100, credited_amount: null },
          { status: "open", amount_kind: "unbilled", amount: 900, credited_amount: null },
        ],
      },
    });
    const t = await exceptionTotals(rec.client, ORG) as { byKind: Record<string, { identified: number }> };
    expect(t.byKind.overbilled!.identified).toBe(100);
    expect(t.byKind.unbilled!.identified).toBe(900);
  });

  it("scopes to one organization", async () => {
    const rec = createSupabaseRecorder({ tables: { fuel_exceptions: [] } });
    await exceptionTotals(rec.client, ORG);
    expectOrgScoped(rec, ORG);
  });
});

describe("listExceptions", () => {
  it("scopes and bounds what it returns", async () => {
    const rec = createSupabaseRecorder({ tables: { fuel_exceptions: [] } });
    await listExceptions(rec.client, ORG, { status: ["open"], limit: 5000 });
    expectOrgScoped(rec, ORG);
    // A caller asking for five thousand rows gets the cap, not five thousand rows.
    const q = rec.forTable("fuel_exceptions")[0];
    expect(JSON.stringify(q)).toContain("199"); // range(0, 199) — the 200 cap
  });
});

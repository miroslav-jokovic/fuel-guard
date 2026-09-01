import { describe, expect, it, beforeEach, vi } from "vitest";
import { defaultInspectionItems } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * Finalizing an inspection (plan step A6).
 *
 * ── WHAT THIS FILE IS ACTUALLY GUARDING ────────────────────────────────────────────────────────
 * Four writes across three modules, in an order chosen so that everything which can REFUSE runs
 * before anything that WRITES. A finalize that failed halfway would leave a certification with no
 * document, or a claimed equipment row behind a report still marked draft — states no reader could
 * interpret. So the refusals are asserted to write NOTHING, and the happy path is asserted to write
 * all four in dependency order.
 *
 * The claim on the equipment row is the assertion that matters most, and it is the one that would
 * pass just as happily if it were missing: the column would still get its date, and the next McLeod
 * sweep carrying an inspection date would silently replace it.
 */

const ORG = "org-1";
const USER = "user-1";
const REPORT = "11111111-1111-4111-8111-111111111111";
const VEHICLE = "22222222-2222-4222-8222-222222222222";
const INSPECTOR = "33333333-3333-4333-8333-333333333333";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));

const { finalizeInspection } = await import("./finalize.js");

const CARRIER = {
  name: "SILVICOM INC",
  dot_number: "1234567",
  address_line1: "1301 ARMITAGE AVE",
  city: "MELROSE PARK",
  state: "IL",
  postal_code: "60160",
};
const QUALIFIED = {
  id: INSPECTOR,
  full_name: "GEORGE GACEV",
  address: null,
  user_id: null,
  qualification_basis: "training_and_experience",
  brake_qualified: true,
  evidence_document_id: null,
  effective_from: "2024-01-01",
  effective_to: null,
  notes: null,
  created_at: "2024-01-01T00:00:00Z",
};
const draft = (over: Record<string, unknown> = {}) => ({
  id: REPORT,
  org_id: ORG,
  subject_type: "tractor",
  subject_id: VEHICLE,
  inspector_id: INSPECTOR,
  inspected_on: "2026-06-16",
  catalogue_version: "1.0.0",
  vehicle_identification_method: "vin",
  vehicle_identification_value: "3AKJHHDR7RSUX1186",
  decal_serial: "610641628",
  other_conditions: null,
  inspection_agency_location: null,
  status: "draft",
  outcome: null,
  next_due_on: null,
  document_id: null,
  certification_id: null,
  ...over,
});
const items = (over: Record<string, string> = {}) =>
  defaultInspectionItems("tractor").map((i) => ({
    item_key: i.key,
    result: over[i.key] ?? i.result,
    source: "default",
    repaired_at: null,
    note: null,
  }));

const seed = (over: Record<string, unknown[]> = {}) =>
  createSupabaseRecorder({
    tables: {
      vehicle_inspections: [draft()],
      vehicle_inspection_items: items(),
      maintenance_inspectors: [QUALIFIED],
      organizations: [CARRIER],
      vehicles: [{ id: VEHICLE, unit_number: "654", vin: "3AKJHHDR7RSUX1186", plate: "IL 1234" }],
      documents: [],
      ...over,
    },
  });

beforeEach(() => {
  rec = seed();
});

describe("the happy path writes four rows across three modules", () => {
  it("passes a clean inspection and reports what it filed", async () => {
    const result = await finalizeInspection(rec.client, ORG, REPORT, USER);
    expect("outcome" in result && result.outcome).toBe("pass");
    expect("nextDueOn" in result && result.nextDueOn).toBe("2027-06-16");
    expect("finalized" in result && result.finalized).toBe(true);
  });

  it("CLAIMS the equipment row, which is what stops the McLeod sweep reverting it (D-AVI9)", async () => {
    await finalizeInspection(rec.client, ORG, REPORT, USER);
    const [projection] = rec.writtenRows("vehicles");
    expect(projection).toMatchObject({
      dot_annual_inspection_expires_at: "2027-06-16",
      // Without this the column still gets its date and everything still passes — and the next
      // McLeod sweep carrying an inspection date replaces it. `rosterIngest` skips a row whose
      // identity_source is outside its CLAIMABLE set; 'manual' is how a row leaves that set. The
      // 0241 trigger cannot do it for us because it exempts the service role, which is what this is.
      identity_source: "manual",
    });
  });

  it("files the PDF as equipment evidence — the first caller of that half of `documents`", async () => {
    await finalizeInspection(rec.client, ORG, REPORT, USER);
    const [doc] = rec.writtenRows("documents");
    expect(doc).toMatchObject({
      org_id: ORG,
      subject_type: "tractor",
      subject_id: VEHICLE,
      kind: "annual_inspection",
      content_type: "application/pdf",
    });
    expect(String(doc!.sha256)).toHaveLength(64);
    expect(Number(doc!.bytes)).toBeGreaterThan(100_000);
  });

  it("records the expiry as a certification, through evidence's own RPC", async () => {
    await finalizeInspection(rec.client, ORG, REPORT, USER);
    const rpc = rec.rpcs().find((r) => r.fn === "insert_certification");
    expect(rpc).toBeTruthy();
    expect(rpc!.args).toMatchObject({
      p_org_id: ORG,
      p_kind: "annual_inspection",
      p_subject_type: "tractor",
      p_expires_at: "2027-06-16",
      p_issued_at: "2026-06-16",
    });
  });

  it("stamps the report final only while it is still a draft", async () => {
    await finalizeInspection(rec.client, ORG, REPORT, USER);
    const update = rec.forTable("vehicle_inspections").find((q) => q.write?.method === "update");
    expect(update!.write!.payload).toMatchObject({ status: "final", outcome: "pass", next_due_on: "2027-06-16" });
    // The guard against two concurrent finalizes: the second one matches no rows.
    expect(update!.filters()).toContainEqual({ col: "status", val: "draft" });
  });

  it("org-scopes every query it makes, across all three modules", async () => {
    await finalizeInspection(rec.client, ORG, REPORT, USER);
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });
});

describe("a failed inspection is a real outcome, not an error", () => {
  beforeEach(() => {
    rec = seed({ vehicle_inspection_items: items({ "brake.hose": "needs_repair" }) });
  });

  it("finalizes as fail on an unrepaired defect (D-AVI3)", async () => {
    const result = await finalizeInspection(rec.client, ORG, REPORT, USER);
    expect("outcome" in result && result.outcome).toBe("fail");
  });

  it("does NOT project an expiry for a failure — the truck is not good until next year", async () => {
    await finalizeInspection(rec.client, ORG, REPORT, USER);
    expect(rec.writtenRows("vehicles")).toHaveLength(0);
  });

  it("still files the report, because a failed inspection is evidence too", async () => {
    await finalizeInspection(rec.client, ORG, REPORT, USER);
    expect(rec.writtenRows("documents")).toHaveLength(1);
    const rpc = rec.rpcs().find((r) => r.fn === "insert_certification");
    // The certification exists and expires the day it was issued, so nothing reads it as cover.
    expect(rpc!.args).toMatchObject({ p_expires_at: "2026-06-16" });
  });
});

describe("what it refuses, and that it writes nothing when it does", () => {
  const expectRefusal = async (code: string) => {
    const result = await finalizeInspection(rec.client, ORG, REPORT, USER);
    expect("code" in result && result.code).toBe(code);
    expect(rec.writes(), "a refusal must not have written anything").toHaveLength(0);
    expect(rec.storageCalls()).toHaveLength(0);
  };

  it("refuses an unanswered component, and names it (D-AVI5)", async () => {
    rec = seed({ vehicle_inspection_items: items().slice(0, 40) });
    await expectRefusal("incomplete_components");
  });

  it("refuses an inspector whose §396.19 qualification has lapsed since the draft (D-AVI6)", async () => {
    rec = seed({ maintenance_inspectors: [{ ...QUALIFIED, effective_to: "2025-12-31" }] });
    await expectRefusal("inspector_not_qualified");
  });

  it("refuses an incomplete carrier record — §396.21(a)(2) is not optional", async () => {
    rec = seed({ organizations: [{ ...CARRIER, address_line1: null, postal_code: null }] });
    const result = await finalizeInspection(rec.client, ORG, REPORT, USER);
    expect("code" in result && result.code).toBe("carrier_incomplete");
    // The message has to be actionable, not "validation failed".
    expect("error" in result && result.error).toContain("street address");
    expect(rec.writes()).toHaveLength(0);
  });

  it("refuses when the equipment has left the roster", async () => {
    rec = seed({ vehicles: [] });
    await expectRefusal("equipment_missing");
  });

  it("refuses a draft started against an older checklist, rather than deriving it against today's", async () => {
    // A component added since the draft was seeded would come back as "no result" for a row the
    // form never showed — an error nobody can act on. Refusing names the real situation.
    rec = seed({ vehicle_inspections: [draft({ catalogue_version: "0.9.0" })] });
    const result = await finalizeInspection(rec.client, ORG, REPORT, USER);
    expect("code" in result && result.code).toBe("catalogue_changed");
    expect(rec.writes()).toHaveLength(0);
  });

  it("never restamps the version the draft was taken under (D-AVI1)", async () => {
    rec = seed();
    await finalizeInspection(rec.client, ORG, REPORT, USER);
    const update = rec.forTable("vehicle_inspections").find((q) => q.write?.method === "update");
    // Writing it here would make a report claim a checklist it was never worked down.
    expect(update!.write!.payload).not.toHaveProperty("catalogue_version");
  });

  it("does NOT refuse a pass with no decal serial — that is §6 Q7, unanswered", async () => {
    rec = seed({ vehicle_inspections: [draft({ decal_serial: null })] });
    const result = await finalizeInspection(rec.client, ORG, REPORT, USER);
    expect("outcome" in result && result.outcome).toBe("pass");
  });
});

describe("replay", () => {
  it("answers an already-final report with what was filed, writing nothing again", async () => {
    rec = seed({
      vehicle_inspections: [
        draft({
          status: "final",
          outcome: "pass",
          next_due_on: "2027-06-16",
          document_id: "d-1",
          certification_id: "c-1",
        }),
      ],
    });
    const result = await finalizeInspection(rec.client, ORG, REPORT, USER);
    expect("finalized" in result && result.finalized).toBe(false);
    expect("documentId" in result && result.documentId).toBe("d-1");
    expect(rec.writes()).toHaveLength(0);
  });

  it("derives the document id from the inspection, so a retry cannot file a second copy", async () => {
    await finalizeInspection(rec.client, ORG, REPORT, USER);
    const first = rec.writtenRows("documents")[0]!.id;
    rec = seed();
    await finalizeInspection(rec.client, ORG, REPORT, USER);
    expect(rec.writtenRows("documents")[0]!.id).toBe(first);
  });
});

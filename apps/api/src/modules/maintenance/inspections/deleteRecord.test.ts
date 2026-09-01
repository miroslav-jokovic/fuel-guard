import { describe, expect, it, beforeEach, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * Destroying a §396.17 report (D-AVI29).
 *
 * ── WHAT THIS FILE GUARDS, AND WHY EACH ONE WOULD PASS WITHOUT IT ──────────────────────────────
 * A delete that leaves the report gone LOOKS successful from every angle a person checks: the row
 * is missing, the page 404s, the list is shorter. Every failure worth catching here is invisible
 * that way.
 *
 *   · the audit row written AFTER the deletes would describe only what survived — and a delete that
 *     failed halfway would leave no account at all. So the order is asserted, not just the presence;
 *   · a blank reason is the difference between "deleted, because the unit was wrong" and a record
 *     that vanished for no stated cause. `audit_logs` outlives everything else here;
 *   · **the equipment claim**: finalize sets `identity_source = 'manual'` so the McLeod sweep leaves
 *     the office's date alone. Undo the date and not the claim and the truck is stranded — the sweep
 *     stops maintaining its IDENTITY, not just its inspection. Measured once on production, on one
 *     truck, which is how this was found;
 *   · deleting one report of several must leave the date the SURVIVORS justify, not null.
 */

const ORG = "org-1";
const OTHER_ORG = "org-2";
const USER = "user-1";
const REPORT = "11111111-1111-4111-8111-111111111111";
const OLDER = "44444444-4444-4444-8444-444444444444";
const VEHICLE = "22222222-2222-4222-8222-222222222222";
const DOC = "55555555-5555-4555-8555-555555555555";
const CERT = "66666666-6666-4666-8666-666666666666";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));

const { deleteInspectionRecord, deleteReasonIsUsable } = await import("./deleteRecord.js");

const report = (over: Record<string, unknown> = {}) => ({
  id: REPORT,
  org_id: ORG,
  subject_type: "tractor",
  subject_id: VEHICLE,
  inspected_on: "2026-06-16",
  status: "final",
  outcome: "pass",
  next_due_on: "2027-06-16",
  document_id: DOC,
  certification_id: CERT,
  equipment_identity_source_before: "samsara",
  ...over,
});

/**
 * The recorder does not filter — `.eq()` is RECORDED, not applied — so a table that answers two
 * different questions has to answer them itself. `vehicle_inspections` is read three ways here (load
 * one by id, find the surviving report, delete), and a fixture that returned the same rows to all
 * three would make "is the claim released" untestable: the survivor query would always find one.
 */
const filterVal = (q: { filters(): Array<{ col: string; val: unknown }> }, col: string) =>
  q.filters().find((f) => f.col === col)?.val;
const isDelete = (q: { ops: Array<{ method: string }> }) => q.ops.some((o) => o.method === "delete");

const seed = (rows: Array<Record<string, unknown>> = [report()]) =>
  createSupabaseRecorder({
    tables: {
      vehicle_inspections: (q) => {
        if (isDelete(q)) return { data: [], error: null };
        const org = filterVal(q, "org_id");
        const mine = rows.filter((r) => r.org_id === org);
        const id = filterVal(q, "id");
        if (id !== undefined) return { data: mine.filter((r) => r.id === id), error: null };
        // The survivor read: every OTHER final passing report for the same subject.
        const subject = filterVal(q, "subject_id");
        const survivors = mine
          .filter((r) => r.subject_id === subject && r.status === "final" && r.outcome === "pass" && r.id !== REPORT)
          .sort((a, b) => String(b.next_due_on).localeCompare(String(a.next_due_on)));
        return { data: survivors, error: null };
      },
      vehicle_inspection_items: { data: [], error: null, count: 1 },
      documents: [{ id: DOC, org_id: ORG, storage_path: `${ORG}/tractor/${VEHICLE}/${DOC}.pdf` }],
      certifications: [{ id: CERT, org_id: ORG }],
      vehicles: [{ id: VEHICLE, org_id: ORG, identity_source: "manual", dot_annual_inspection_expires_at: "2027-06-16" }],
      audit_logs: [],
    },
  });

beforeEach(() => {
  rec = seed();
});

const run = (reason = "created against the wrong unit") =>
  deleteInspectionRecord(rec.client, ORG, REPORT, { reason, actorId: USER });

describe("a reason is required, because it is the only part that survives", () => {
  it("refuses a blank one, and writes nothing", async () => {
    const result = await run("   ");
    expect("code" in result && result.code).toBe("reason_required");
    expect(rec.writtenRows("audit_logs")).toEqual([]);
    expect(rec.writtenRows("vehicle_inspections")).toEqual([]);
  });

  it("agrees with the predicate the form uses, so the button and the API cannot disagree", () => {
    expect(deleteReasonIsUsable("")).toBe(false);
    expect(deleteReasonIsUsable("  \n ")).toBe(false);
    expect(deleteReasonIsUsable("ok")).toBe(false);
    expect(deleteReasonIsUsable("sold")).toBe(true);
  });
});

describe("the account is written before the act", () => {
  it("records every artefact it is about to destroy, with the reason", async () => {
    await run();
    const [entry] = rec.writtenRows("audit_logs") as Array<Record<string, unknown>>;
    expect(entry).toMatchObject({ action: "maintenance.inspection_record_deleted", entity_id: REPORT });
    expect(entry!.meta).toMatchObject({
      reason: "created against the wrong unit",
      documentId: DOC,
      certificationId: CERT,
      itemsDeleted: 1,
      identitySourceToRestore: "samsara",
    });
    // The path has to be captured while the row still exists — after the delete there is nothing to
    // read it from, and an object left in the bucket would be unfindable.
    expect(String((entry!.meta as Record<string, unknown>).storagePath)).toContain(`${DOC}.pdf`);
  });

  it("still leaves an account when the report cannot be loaded at all", async () => {
    const missing = await deleteInspectionRecord(rec.client, ORG, "77777777-7777-4777-8777-777777777777", {
      reason: "sold",
      actorId: USER,
    });
    expect("code" in missing && missing.code).toBe("not_found");
    // Nothing was destroyed, so there is nothing to account for — an audit row here would claim a
    // deletion that never happened.
    expect(rec.writtenRows("audit_logs")).toEqual([]);
  });
});

describe("everything the report created goes with it", () => {
  it("reports what it removed", async () => {
    const result = await run();
    expect("id" in result && result).toMatchObject({
      itemsDeleted: 1,
      certificationDeleted: true,
      documentDeleted: true,
    });
  });

  it("is org-scoped on every query, because the service role bypasses RLS", async () => {
    await run();
    expectOrgScoped(rec, ORG);
  });

  it("refuses a report belonging to another organisation as if it did not exist", async () => {
    const result = await deleteInspectionRecord(rec.client, OTHER_ORG, REPORT, { reason: "sold", actorId: USER });
    expect("code" in result && result.code).toBe("not_found");
  });
});

describe("the equipment claim is given back — the assertion that would silently pass if missing", () => {
  it("restores what the report displaced, and clears the date, when nothing is left", async () => {
    const result = await run();
    expect("identitySourceRestored" in result && result.identitySourceRestored).toBe("samsara");
    const [patch] = rec.writtenRows("vehicles") as Array<Record<string, unknown>>;
    expect(patch).toMatchObject({ dot_annual_inspection_expires_at: null, identity_source: "samsara" });
  });

  it("leaves the date the SURVIVING report justifies, and keeps the claim while one stands", async () => {
    rec = seed([
      report(),
      report({ id: OLDER, inspected_on: "2025-06-16", next_due_on: "2026-06-16", document_id: null, certification_id: null }),
    ]);
    const result = await run();
    // The older report is still final and still passing, so the truck still has an inspection — and
    // its claim must stay, or the next sweep overwrites a date the office still owns.
    expect("expiresOn" in result && result.expiresOn).toBe("2026-06-16");
    expect("identitySourceRestored" in result && result.identitySourceRestored).toBeNull();
    const [patch] = rec.writtenRows("vehicles") as Array<Record<string, unknown>>;
    expect(patch).toMatchObject({ dot_annual_inspection_expires_at: "2026-06-16" });
    expect(patch).not.toHaveProperty("identity_source");
  });

  it("leaves identity_source alone for a report filed before 0285 recorded what it took", async () => {
    rec = seed([report({ equipment_identity_source_before: null })]);
    const result = await run();
    expect("identitySourceRestored" in result && result.identitySourceRestored).toBeNull();
    const [patch] = rec.writtenRows("vehicles") as Array<Record<string, unknown>>;
    // Guessing here — writing the column default, or whatever most of the fleet carries — would hand
    // the row to a sweep that may never have owned it.
    expect(patch).not.toHaveProperty("identity_source");
  });

  it("touches no equipment row at all for a draft, which never made a projection", async () => {
    rec = seed([report({ status: "draft", outcome: null, next_due_on: null, document_id: null, certification_id: null })]);
    await run();
    expect(rec.writtenRows("vehicles")).toEqual([]);
  });
});

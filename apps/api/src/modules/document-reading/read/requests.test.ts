import { describe, expect, it } from "vitest";
import { DOCUMENT_PROFILES, type ReviewEntry } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { workingSizeOf } from "../pages/canonical.js";
import { DOCUMENT_BUCKET, PAGE_URL_TTL_SEC } from "../storage.js";
import { getRead, recordReviews, requestRead, reviewEntryProblem } from "./requests.js";

/**
 * Step 1.6b — the read side: queue a read, show it, record the verdicts on it.
 *
 * The expensive mistakes are a second model call for a read already in flight, a review screen with a
 * page silently missing, and a review row whose `oldValue` is not what the reader said — reviews are
 * append-only evidence that graduation counts (D-DR5), so a wrong one is wrong for ever.
 */
const ORG = "org-1";
const USER = "user-1";
const SOURCE = "11111111-1111-4111-8111-111111111111";
const READ = "33333333-3333-4333-8333-333333333333";
const ASSEMBLY = "44444444-4444-4444-8444-444444444444";
const SRC = { kind: "source", id: SOURCE } as const;

describe("requestRead", () => {
  /** `priorJob`: the status of the prior read's latest `document_read` job, or none. */
  function world(prior: string | null, source = true, priorJob: string | null = "running", priorStatus = "reading") {
    const rec = createSupabaseRecorder({
      tables: {
        document_sources: source ? [{ id: SOURCE }] : [],
        document_reads: (q) => (q.write ? [{ id: READ }] : prior ? [{ id: prior, status: priorStatus }] : []),
        jobs: priorJob ? [{ status: priorJob }] : [],
      },
      rpc: { document_read_transition: null },
    });
    const dispatched: string[] = [];
    return { rec, dispatched, dispatch: async (id: string) => void dispatched.push(id) };
  }

  it("inserts a queued read under the profile's version and dispatches it once", async () => {
    const { rec, dispatched, dispatch } = world(null);
    expect(await requestRead(rec.client, ORG, USER, SRC, "shipping_document", dispatch)).toEqual({ readId: READ, reused: false });
    expect(dispatched).toEqual([READ]);
    expect(rec.writtenRows("document_reads")).toEqual([{
      org_id: ORG, source_id: SOURCE, profile: "shipping_document", profile_version: DOCUMENT_PROFILES.shipping_document.version, requested_by: USER,
    }]);
    // A finished read is NOT reused by the route: asking again after a review is a new read.
    expect(rec.forTable("document_reads")[0]!.ops.find((o) => o.method === "in")?.args[1]).toEqual(["queued", "reading"]);
    expectOrgScoped(rec, ORG);
  });

  it("returns the read already in flight without inserting or dispatching", async () => {
    const { rec, dispatched, dispatch } = world("prior-read");
    expect(await requestRead(rec.client, ORG, USER, SRC, "shipping_document", dispatch)).toEqual({ readId: "prior-read", reused: true });
    expect(dispatched).toEqual([]);
    expect(rec.writes()).toEqual([]);
  });

  it("does not hand back a read in flight whose job has failed for good: it ends that read and queues a new one", async () => {
    const { rec, dispatched, dispatch } = world("stuck-read", true, "failed");
    expect(await requestRead(rec.client, ORG, USER, SRC, "shipping_document", dispatch)).toEqual({ readId: READ, reused: false });
    expect(dispatched).toEqual([READ]);
    expect(rec.rpcs().map((r) => [r.fn, (r.args as { p_read: string; p_to: string }).p_read, (r.args as { p_to: string }).p_to]))
      .toEqual([["document_read_transition", "stuck-read", "failed"]]);
    expect(rec.forTable("jobs")[0]!.filters()).toEqual(expect.arrayContaining([
      { col: "kind", val: "document_read" }, { col: "dedup_key", val: "document_read:stuck-read" },
    ]));
    expectOrgScoped(rec, ORG);
  });

  it("still reuses a read in flight whose job is queued, running, or waiting out a retry", async () => {
    for (const status of ["queued", "running"]) {
      const { rec, dispatch } = world("prior-read", true, status);
      expect(await requestRead(rec.client, ORG, USER, SRC, "shipping_document", dispatch)).toEqual({ readId: "prior-read", reused: true });
      expect(rec.rpcs()).toEqual([]);
    }
  });

  it("answers not_found for a source outside the org", async () => {
    const { rec, dispatch } = world(null, false);
    expect(await requestRead(rec.client, ORG, USER, SRC, "shipping_document", dispatch)).toMatchObject({ code: "not_found" });
    expect(rec.writes()).toEqual([]);
    expectOrgScoped(rec, ORG);
  });

  it("queues a read of an assembly under assembly_id alone, and reuses only a read of that same assembly", async () => {
    const rec = createSupabaseRecorder({
      tables: { document_assemblies: [{ id: ASSEMBLY }], document_reads: (q) => (q.write ? [{ id: READ }] : []) },
    });
    const dispatched: string[] = [];
    const out = await requestRead(rec.client, ORG, USER, { kind: "assembly", id: ASSEMBLY }, "shipping_document", async (id) => void dispatched.push(id));
    expect(out).toEqual({ readId: READ, reused: false });
    expect(rec.writtenRows("document_reads")).toEqual([{
      org_id: ORG, assembly_id: ASSEMBLY, profile: "shipping_document", profile_version: DOCUMENT_PROFILES.shipping_document.version, requested_by: USER,
    }]);
    const reuse = rec.forTable("document_reads")[0]!.filters();
    expect(reuse).toContainEqual({ col: "assembly_id", val: ASSEMBLY });
    expect(reuse.some((f) => f.col === "source_id")).toBe(false);
    expect(rec.forTable("document_assemblies")[0]!.filters()).toContainEqual({ col: "id", val: ASSEMBLY });
    expect(dispatched).toEqual([READ]);
    expectOrgScoped(rec, ORG);
  });

  it("answers not_found for an assembly outside the org", async () => {
    const rec = createSupabaseRecorder({ tables: { document_assemblies: [], document_reads: [] } });
    expect(await requestRead(rec.client, ORG, USER, { kind: "assembly", id: ASSEMBLY }, "shipping_document", async () => {}))
      .toMatchObject({ code: "not_found" });
    expect(rec.writes()).toEqual([]);
  });
});

describe("getRead", () => {
  const readRow = {
    id: READ, source_id: SOURCE, profile: "shipping_document", profile_version: "1.0.0", status: "done", failure_code: null,
    result: { shipper: { name: "ACME" } }, evidence: [],
  };
  const pageRows = [
    { id: "p1", page_number: 1, working_path: `${ORG}/${SOURCE}/pages/1.webp`, width: 2550, height: 3300 },
    { id: "p2", page_number: 2, working_path: `${ORG}/${SOURCE}/pages/2.webp`, width: 3300, height: 2550 },
  ];
  function world(signed: (paths: string[]) => unknown, read: unknown = readRow, job: string | null = null) {
    return createSupabaseRecorder({
      tables: { document_reads: read ? [read] : [], document_pages: pageRows, jobs: job ? [{ status: job }] : [] },
      rpc: { document_page_current_class: [{ page_id: "p1", page_class: "bol" }], document_read_transition: null },
      storage: { createSignedUrls: (paths: string[]) => signed(paths) },
    });
  }
  const signAll = (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: `https://signed.example.test/${path}` })), error: null });

  it("shows every page of the source with its class, a signed URL, and the working copy's size, signed in one call", async () => {
    const rec = world(signAll);
    const out = await getRead(rec.client, ORG, READ);
    expect(out).toMatchObject({ id: READ, sourceId: SOURCE, assemblyId: null, status: "done", result: readRow.result, evidence: [] });
    expect("pages" in out && out.pages).toEqual([
      { page: 1, pageClass: "bol", url: `https://signed.example.test/${pageRows[0]!.working_path}`, ...workingSizeOf(2550, 3300) },
      { page: 2, pageClass: null, url: `https://signed.example.test/${pageRows[1]!.working_path}`, ...workingSizeOf(3300, 2550) },
    ]);
    expect(rec.storageCalls()).toEqual([{ bucket: DOCUMENT_BUCKET, fn: "createSignedUrls", args: [pageRows.map((p) => p.working_path), PAGE_URL_TTL_SEC] }]);
    expect(rec.rpcs()).toEqual([{ fn: "document_page_current_class", args: { p_org: ORG, p_pages: ["p1", "p2"] } }]);
    expectOrgScoped(rec, ORG);
  });

  it("carries the paper audit for a finished shipping-document read, and none for a read still in flight", async () => {
    const result = { hazmat: { lines: [{ idText: "UN1203", psn: "Gasoline", hazardClass: "3", pg: "II", quantity: { value: 8000, unit: "gal" }, packageCount: 1, packaging: "1 cargo tank" }] } };
    const done = await getRead(world(signAll, { ...readRow, result }).client, ORG, READ);
    expect("paperAudit" in done && done.paperAudit?.results.find((r) => r.ruleId === "paper_psn_matches_hmt")).toMatchObject({ outcome: "pass", lineIndex: 0 });
    const reading = await getRead(world(signAll, { ...readRow, result: null, status: "reading" }).client, ORG, READ);
    expect("paperAudit" in reading && reading.paperAudit).toBeNull();
    const failed = await getRead(world(signAll, { ...readRow, result, status: "failed" }).client, ORG, READ);
    expect("paperAudit" in failed && failed.paperAudit).toBeNull();
  });

  // Q-RC5: pass A missed the signed certification, pass B read it; a person said the page has it.
  describe("a field a person checked against the page (Q-RC5)", () => {
    const line = { idText: "UN1203", psn: "Gasoline", hazardClass: "3", pg: "II", quantity: { value: 8000, unit: "gal" }, packageCount: 1, packaging: "1 cargo tank" };
    const result = { hazmat: { lines: [line], emergencyPhone: "800-424-9300", shipperCertification: null } };
    const cert = { path: "hazmat.shipperCertification", value: null, status: "check", ruleVersion: "12", sources: [
      { reader: "passA", page: null, bbox: null, value: null }, { reader: "passB", page: null, bbox: null, value: true }] };
    const review = (action: string, newValue: unknown, explicit = true, consumer = "paper_check") =>
      ({ org_id: ORG, read_id: READ, field_path: "hazmat.shipperCertification", action, old_value: null, new_value: newValue, explicit, consumer });
    const certOf = async (reviews: unknown[]) => {
      const rec = createSupabaseRecorder({
        tables: { document_reads: [{ ...readRow, result, evidence: [cert] }], document_pages: pageRows, document_read_reviews: reviews },
        rpc: { document_page_current_class: [] },
        storage: { createSignedUrls: signAll },
      });
      const out = await getRead(rec.client, ORG, READ);
      expectOrgScoped(rec, ORG);
      return "paperAudit" in out ? out.paperAudit?.results.find((r) => r.ruleId === "paper_certification") : undefined;
    };

    it("judges the certification as the person said the page prints it", async () => {
      expect(await certOf([])).toMatchObject({ outcome: "cannot_tell", reason: "field_unconfirmed" });
      expect(await certOf([review("corrected", true)])).toMatchObject({ outcome: "pass", reason: "present" });
    });

    it("takes only a person's explicit word on the page, the latest of it, and lets an 'unreadable' withdraw an earlier check", async () => {
      expect(await certOf([review("corrected", true, false)])).toMatchObject({ outcome: "cannot_tell" });
      // A Calculate press may carry the load's values, not the page's (0509): it never reaches the audit.
      expect(await certOf([review("corrected", true, true, "hazmat_calculator")])).toMatchObject({ outcome: "cannot_tell" });
      expect(await certOf([review("corrected", false), review("corrected", true)])).toMatchObject({ outcome: "pass" });
      expect(await certOf([review("corrected", true), review("unreadable", null)])).toMatchObject({ outcome: "cannot_tell" });
    });

    it("answers a recorded check with the audit as it now stands", async () => {
      const reviews: unknown[] = [];
      const rec = createSupabaseRecorder({ tables: { document_reads: [{ ...readRow, result, evidence: [cert] }], document_read_reviews: reviews } });
      const batch = { consumer: "paper_check" as const, reviews: [{ path: "hazmat.shipperCertification", action: "corrected" as const, oldValue: null, newValue: true, explicit: true }] };
      const out = await recordReviews(rec.client, ORG, USER, READ, batch);
      expect(rec.writtenRows("document_read_reviews")).toHaveLength(1);
      expect("paperAudit" in out && out.paperAudit?.results.find((r) => r.ruleId === "paper_certification")).toMatchObject({ outcome: "pass" });
      expectOrgScoped(rec, ORG);
    });
  });

  it("refuses to show a read with a page it could not sign, rather than a document missing a page", async () => {
    const rec = world((paths) => ({ data: [{ path: paths[0], signedUrl: "https://signed.example.test/1" }, { path: paths[1], signedUrl: null, error: "x" }], error: null }));
    expect(await getRead(rec.client, ORG, READ)).toEqual({ code: "sign_failed", error: "Page 2 could not be shown." });
  });

  it("shows an assembly's pages in the assembly's order, numbered by position, whatever their files' page numbers", async () => {
    // Two photos, each page 1 of its own file; the sender put the second one first.
    const photos = [
      { id: "pa", page_number: 1, working_path: `${ORG}/a/pages/1.webp`, width: 2000, height: 1500 },
      { id: "pb", page_number: 1, working_path: `${ORG}/b/pages/1.webp`, width: 1500, height: 2000 },
    ];
    const rec = createSupabaseRecorder({
      tables: {
        document_reads: [{ ...readRow, source_id: null, assembly_id: ASSEMBLY }],
        document_assembly_pages: [{ position: 1, page_id: "pb" }, { position: 2, page_id: "pa" }],
        document_pages: photos,
      },
      rpc: { document_page_current_class: [] },
      storage: { createSignedUrls: signAll },
    });
    const out = await getRead(rec.client, ORG, READ);
    expect(out).toMatchObject({ sourceId: null, assemblyId: ASSEMBLY });
    expect("pages" in out && out.pages.map((p) => [p.page, p.url.split("/").at(-3)])).toEqual([[1, "b"], [2, "a"]]);
    expect(rec.forTable("document_assembly_pages")[0]!.filters()).toContainEqual({ col: "assembly_id", val: ASSEMBLY });
    expectOrgScoped(rec, ORG);
  });

  it("answers failed, not reading, for a read whose job died — and ends it so it stays failed (10/12/2026)", async () => {
    for (const status of ["reading", "queued"]) {
      const rec = world(signAll, { ...readRow, status, result: null }, "failed");
      expect(await getRead(rec.client, ORG, READ)).toMatchObject({ status: "failed", failureCode: "model_unavailable" });
      const moves = rec.rpcs().filter((r) => r.fn === "document_read_transition").map((r) => (r.args as { p_to: string }).p_to);
      expect(moves).toEqual(status === "queued" ? ["reading", "failed"] : ["failed"]);
      expectOrgScoped(rec, ORG);
    }
  });

  it("leaves a read in flight alone while its job is alive", async () => {
    const rec = world(signAll, { ...readRow, status: "reading", result: null }, "running");
    expect(await getRead(rec.client, ORG, READ)).toMatchObject({ status: "reading", failureCode: null });
    expect(rec.rpcs().filter((r) => r.fn === "document_read_transition")).toEqual([]);
  });

  it("names where a read in flight is from the stages its row says it finished, and nothing once it ended (TC0.2)", async () => {
    const at = async (row: Record<string, unknown>) => {
      const out = await getRead(world(signAll, { ...readRow, result: null, ...row }, "running").client, ORG, READ);
      return "stage" in out ? out.stage : out;
    };
    expect(await at({ status: "queued", stage_timings: null })).toBe("preparing");
    expect(await at({ status: "reading", stage_timings: null })).toBe("preparing");
    expect(await at({ status: "reading", stage_timings: { classify: 900, fetch: 300 } })).toBe("reading");
    expect(await at({ status: "reading", stage_timings: { fetch: 300, passA: 9000, passB: 14000 } })).toBe("checking");
    expect(await at({ status: "done", result: readRow.result, stage_timings: { fetch: 300, passA: 9000 } })).toBeNull();
    const rec = world(signAll);
    await getRead(rec.client, ORG, READ);
    expect(rec.forTable("document_reads")[0]!.ops.find((o) => o.method === "select")!.args[0]).toContain("stage_timings");
  });

  it("answers not_found for a read outside the org", async () => {
    const rec = world(signAll, null);
    expect(await getRead(rec.client, ORG, READ)).toMatchObject({ code: "not_found" });
    expectOrgScoped(rec, ORG);
  });
});

describe("reviewEntryProblem", () => {
  const result = { shipper: { name: "ACME", marks: ["A", "B"] }, hazmat: { lines: [{ unNumber: "UN1203", qty: 2 }] }, carrier: null };
  const e = (path: string, action: ReviewEntry["action"], oldValue: unknown, newValue: unknown): ReviewEntry =>
    ({ path, action, oldValue, newValue }) as ReviewEntry;

  it("accepts exactly the verdicts that agree with what the read gave", () => {
    const table: Array<[ReviewEntry, string | null]> = [
      [e("shipper.name", "confirmed", "ACME", "ACME"), null],
      [e("shipper.name", "corrected", "ACME", "ACME Corp"), null],
      [e("shipper.name", "unreadable", "ACME", null), null],
      [e("shipper.marks", "confirmed", ["A", "B"], ["A", "B"]), null],
      [e("hazmat.lines[0].qty", "corrected", 2, 3), null],
      [e("carrier", "corrected", null, "XPO"), null],
      // A line the reader missed, typed in: the path is beyond the document, so its old value is null.
      [e("hazmat.lines[1].unNumber", "corrected", null, "UN1993"), null],
      [e("shipper.name", "confirmed", "ACMEE", "ACMEE"), "shipper.name: the old value is not what this read gave"],
      [e("hazmat.lines[1].unNumber", "corrected", "UN1203", "UN1993"), "hazmat.lines[1].unNumber: the old value is not what this read gave"],
      [e("shipper.name", "confirmed", "ACME", "ACME Corp"), "shipper.name: a confirmation keeps the value"],
      [e("shipper.name", "corrected", "ACME", "ACME"), "shipper.name: a correction changes the value"],
      [e("shipper.name", "unreadable", "ACME", "ACME"), "shipper.name: an unreadable field has no new value"],
      [e("shipper", "unreadable", { name: "ACME", marks: ["A", "B"] }, null), "shipper is a group of fields, not one field"],
      [e("hazmat.lines[0]", "confirmed", { unNumber: "UN1203", qty: 2 }, { unNumber: "UN1203", qty: 2 }), "hazmat.lines[0] is a group of fields, not one field"],
    ];
    for (const [entry, want] of table) expect(reviewEntryProblem(result, entry), `${entry.path} ${entry.action}`).toBe(want);
  });
});

describe("recordReviews", () => {
  const batch = { consumer: "hazmat_calculator" as const, reviews: [{ path: "shipper.name", action: "corrected" as const, oldValue: "ACME", newValue: "ACME Corp", explicit: true }] };
  const world = (status: string | null) =>
    createSupabaseRecorder({ tables: { document_reads: status ? [{ id: READ, status, result: { shipper: { name: "ACME" } } }] : [] } });

  it("records each verdict with its actor, consumer and whether the dispatcher acted on it", async () => {
    const rec = world("done");
    const both = { ...batch, reviews: [...batch.reviews, { path: "shipper.name", action: "corrected" as const, oldValue: "ACME", newValue: "ACME Inc", explicit: false }] };
    expect(await recordReviews(rec.client, ORG, USER, READ, both)).toEqual({ recorded: 2, paperAudit: null });
    const row = { org_id: ORG, read_id: READ, field_path: "shipper.name", action: "corrected", old_value: "ACME", actor: USER, consumer: "hazmat_calculator" };
    expect(rec.writtenRows("document_read_reviews")).toEqual([
      { ...row, new_value: "ACME Corp", explicit: true },
      { ...row, new_value: "ACME Inc", explicit: false },
    ]);
    expectOrgScoped(rec, ORG);
  });

  it("refuses a read that is not finished, and a batch with one bad entry writes none of it", async () => {
    for (const status of ["queued", "reading", "failed"]) {
      const rec = world(status);
      expect(await recordReviews(rec.client, ORG, USER, READ, batch)).toMatchObject({ code: "not_reviewable" });
      expect(rec.writes()).toEqual([]);
    }
    const rec = world("done");
    const bad = { ...batch, reviews: [...batch.reviews, { path: "shipper.name", action: "confirmed" as const, oldValue: "WRONG", newValue: "WRONG", explicit: true }] };
    expect(await recordReviews(rec.client, ORG, USER, READ, bad)).toMatchObject({ code: "invalid_review" });
    expect(rec.writes()).toEqual([]);
  });

  it("answers not_found for a read outside the org", async () => {
    const rec = world(null);
    expect(await recordReviews(rec.client, ORG, USER, READ, batch)).toMatchObject({ code: "not_found" });
    expectOrgScoped(rec, ORG);
  });
});

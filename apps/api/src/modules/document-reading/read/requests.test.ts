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

describe("requestRead", () => {
  function world(prior: string | null, source = true) {
    const rec = createSupabaseRecorder({
      tables: {
        document_sources: source ? [{ id: SOURCE }] : [],
        document_reads: (q) => (q.write ? [{ id: READ }] : prior ? [{ id: prior }] : []),
      },
    });
    const dispatched: string[] = [];
    return { rec, dispatched, dispatch: async (id: string) => void dispatched.push(id) };
  }

  it("inserts a queued read under the profile's version and dispatches it once", async () => {
    const { rec, dispatched, dispatch } = world(null);
    expect(await requestRead(rec.client, ORG, USER, SOURCE, "shipping_document", dispatch)).toEqual({ readId: READ, reused: false });
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
    expect(await requestRead(rec.client, ORG, USER, SOURCE, "shipping_document", dispatch)).toEqual({ readId: "prior-read", reused: true });
    expect(dispatched).toEqual([]);
    expect(rec.writes()).toEqual([]);
  });

  it("answers not_found for a source outside the org", async () => {
    const { rec, dispatch } = world(null, false);
    expect(await requestRead(rec.client, ORG, USER, SOURCE, "shipping_document", dispatch)).toMatchObject({ code: "not_found" });
    expect(rec.writes()).toEqual([]);
    expectOrgScoped(rec, ORG);
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
  function world(signed: (paths: string[]) => unknown, read: unknown = readRow) {
    return createSupabaseRecorder({
      tables: { document_reads: read ? [read] : [], document_pages: pageRows },
      rpc: { document_page_current_class: [{ page_id: "p1", page_class: "bol" }] },
      storage: { createSignedUrls: (paths: string[]) => signed(paths) },
    });
  }
  const signAll = (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: `https://signed.example.test/${path}` })), error: null });

  it("shows every page of the source with its class, a signed URL, and the working copy's size, signed in one call", async () => {
    const rec = world(signAll);
    const out = await getRead(rec.client, ORG, READ);
    expect(out).toMatchObject({ id: READ, sourceId: SOURCE, status: "done", result: readRow.result, evidence: [] });
    expect("pages" in out && out.pages).toEqual([
      { page: 1, pageClass: "bol", url: `https://signed.example.test/${pageRows[0]!.working_path}`, ...workingSizeOf(2550, 3300) },
      { page: 2, pageClass: null, url: `https://signed.example.test/${pageRows[1]!.working_path}`, ...workingSizeOf(3300, 2550) },
    ]);
    expect(rec.storageCalls()).toEqual([{ bucket: DOCUMENT_BUCKET, fn: "createSignedUrls", args: [pageRows.map((p) => p.working_path), PAGE_URL_TTL_SEC] }]);
    expect(rec.rpcs()).toEqual([{ fn: "document_page_current_class", args: { p_org: ORG, p_pages: ["p1", "p2"] } }]);
    expectOrgScoped(rec, ORG);
  });

  it("refuses to show a read with a page it could not sign, rather than a document missing a page", async () => {
    const rec = world((paths) => ({ data: [{ path: paths[0], signedUrl: "https://signed.example.test/1" }, { path: paths[1], signedUrl: null, error: "x" }], error: null }));
    expect(await getRead(rec.client, ORG, READ)).toEqual({ code: "sign_failed", error: "Page 2 could not be shown." });
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
  const batch = { consumer: "hazmat_calculator" as const, reviews: [{ path: "shipper.name", action: "corrected" as const, oldValue: "ACME", newValue: "ACME Corp" }] };
  const world = (status: string | null) =>
    createSupabaseRecorder({ tables: { document_reads: status ? [{ id: READ, status, result: { shipper: { name: "ACME" } } }] : [] } });

  it("records each verdict with its actor and consumer", async () => {
    const rec = world("done");
    expect(await recordReviews(rec.client, ORG, USER, READ, batch)).toEqual({ recorded: 1 });
    expect(rec.writtenRows("document_read_reviews")).toEqual([{
      org_id: ORG, read_id: READ, field_path: "shipper.name", action: "corrected", old_value: "ACME", new_value: "ACME Corp", actor: USER, consumer: "hazmat_calculator",
    }]);
    expectOrgScoped(rec, ORG);
  });

  it("refuses a read that is not finished, and a batch with one bad entry writes none of it", async () => {
    for (const status of ["queued", "reading", "failed"]) {
      const rec = world(status);
      expect(await recordReviews(rec.client, ORG, USER, READ, batch)).toMatchObject({ code: "not_reviewable" });
      expect(rec.writes()).toEqual([]);
    }
    const rec = world("done");
    const bad = { ...batch, reviews: [...batch.reviews, { path: "shipper.name", action: "confirmed" as const, oldValue: "WRONG", newValue: "WRONG" }] };
    expect(await recordReviews(rec.client, ORG, USER, READ, bad)).toMatchObject({ code: "invalid_review" });
    expect(rec.writes()).toEqual([]);
  });

  it("answers not_found for a read outside the org", async () => {
    const rec = world(null);
    expect(await recordReviews(rec.client, ORG, USER, READ, batch)).toMatchObject({ code: "not_found" });
    expectOrgScoped(rec, ORG);
  });
});

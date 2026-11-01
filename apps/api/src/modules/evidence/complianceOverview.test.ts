import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { getComplianceOverview, overviewViolationsFor } from "./complianceOverview.js";
import { DQ_ROSTER_COLUMN_KEYS, isRestrictedQualificationKind } from "@silvicom/shared";

/**
 * The overview's driver read decides who owes a §391.51 file, and it runs on the SERVICE ROLE — RLS
 * is not a second line of defence here, so the query itself is what these tests pin:
 *   - employed only (`status in active,on_leave` — commit 3876960, which shipped with no test), and
 *   - real identities only (`identity_source <> 'efs'` — 0204/A6: a fuel-card name-stub asserts
 *     `active` with no employment behind it; a third of the measured queue was these).
 */
const ORG = "org1";

function makeRecorder(drivers: unknown[]) {
  return createSupabaseRecorder({
    tables: {
      drivers,
      certifications: [],
      qualification_records: [],
      documents: [],
    },
    rpc: { org_module_enabled: false },
  });
}

/**
 * D-HIRE5: an applicant is a `drivers` row, and the §391.51 queue must never admit one — there is no
 * qualification file for somebody who is not employed, and listing them as "missing a medical card"
 * would be a compliance finding against a person we have not hired. The overview selects by
 * INCLUSION (`["active", "on_leave"]`), which is what makes that true; this pins it, because an
 * exclusion list would have admitted the status silently.
 */
describe("applicant scoping", () => {
  it("selects active and on_leave by inclusion, so a new status is never admitted by default", () => {
    const src = readFileSync(new URL("./complianceOverview.ts", import.meta.url), "utf8");
    expect(src).toContain('.in("status", ["active", "on_leave"])');
    expect(src).not.toMatch(/neq\("status"/);
  });
});

describe("getComplianceOverview — the driver predicate", () => {
  it("filters to employed, non-EFS drivers and stays org-scoped", async () => {
    const rec = makeRecorder([{ id: "d1", full_name: "A Driver", status: "active" }]);
    const result = await getComplianceOverview(rec.client, ORG, "2026-08-19");

    const driversQ = rec.queries.find((q) => q.table === "drivers");
    expect(driversQ).toBeDefined();
    expect(driversQ!.ops).toContainEqual({ method: "in", args: ["status", ["active", "on_leave"]] });
    expect(driversQ!.ops).toContainEqual({ method: "neq", args: ["identity_source", "efs"] });
    expect(result.drivers).toHaveLength(1);
    expectOrgScoped(rec, ORG);
  });

  it("carries computed state only — no record payloads the restricted-kind filter could miss (Phase G)", async () => {
    const rec = makeRecorder([{ id: "d1", full_name: "A Driver", status: "active" }]);
    const result = await getComplianceOverview(rec.client, ORG, "2026-08-19");
    // A dispatcher may see restricted items' STATE (D-DQ15) but never the records behind them. The
    // overview satisfies that by construction — it returns no evidence rows at all — and this pins
    // the shape so a future field addition has to face the question.
    expect(Object.keys(result.drivers[0]!).sort()).toEqual(
      ["attention", "counts", "documents", "driver_id", "driver_name", "driver_status", "groups", "requirements", "state"],
    );
  });

  /**
   * `requirements` is R4's addition, and this is the question the assertion above exists to force.
   *
   * Two things make it safe, and both are asserted rather than argued. It carries no evidence
   * payload — no record row, nothing but computed state, a date, and (since UF4b) the id of the scan
   * that proves it, which the documents list already serves to the same reader. And its KEYS are
   * a closed set of three, none of which is a restricted kind: a §382.401(a) testing record or a
   * §391.23 investigation result cannot appear here even if one were added to the catalogue, because
   * the projection filters to `DQ_ROSTER_COLUMN_KEYS`.
   */
  it("the document count is two numbers, never the documents themselves (Phase G)", async () => {
    // R5's file cell needs "how many scans", not "which scans". Carrying the ids here would put a
    // §382.401 testing record's document id in front of a dispatcher, which is the exact leak the
    // assertion above exists to prevent — and it would also be 287 ids nobody on the roster reads.
    const rec = makeRecorder([{ id: "d1", full_name: "A Driver", status: "active", cdl_number: "D1" }]);
    const result = await getComplianceOverview(rec.client, ORG, "2026-08-19");
    const docs = result.drivers[0]!.documents;

    expect(Object.keys(docs).sort()).toEqual(["of", "onFile"]);
    expect(typeof docs.onFile).toBe("number");
    expect(docs.of).toBeGreaterThan(0);
  });

  it("costs the same four reads whatever the fleet size — the file count adds none (R5)", async () => {
    // R5's own note warned that a document count would cost "200 signed-URL round trips on load".
    // It costs nothing: `buildDqFile` already resolves `documentId` per item, so the count is a fold
    // over work this function has done anyway. Asserted as a CONSTANT rather than a small number,
    // because the failure being guarded against is per-driver growth.
    const many = Array.from({ length: 50 }, (_, i) => ({
      id: `d${i}`, full_name: `Driver ${i}`, status: "active", cdl_number: "D1",
    }));
    const one = makeRecorder([{ id: "d1", full_name: "A Driver", status: "active", cdl_number: "D1" }]);
    const fifty = makeRecorder(many);

    const small = await getComplianceOverview(one.client, ORG, "2026-08-19");
    const large = await getComplianceOverview(fifty.client, ORG, "2026-08-19");

    expect(large.drivers.length).toBeGreaterThan(small.drivers.length);
    expect(fifty.queries.length).toBe(one.queries.length);
  });

  it("the roster requirements carry no evidence payload and no restricted kind (Phase G)", async () => {
    const rec = makeRecorder([{ id: "d1", full_name: "A Driver", status: "active", cdl_number: "D1" }]);
    const result = await getComplianceOverview(rec.client, ORG, "2026-08-19");
    const cells = result.drivers[0]!.requirements;

    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(Object.keys(cell).sort()).toEqual(
        ["daysRemaining", "documentId", "expiryUnknown", "goodUntil", "key", "state"],
      );
      expect(DQ_ROSTER_COLUMN_KEYS).toContain(cell.key);
      expect(isRestrictedQualificationKind(cell.key)).toBe(false);
    }
  });

  it("a 60-day-out item is invisible at the default horizon and present at 91 (C2 — the assertion that would have caught the plan's own defect)", async () => {
    const rec = () =>
      createSupabaseRecorder({
        tables: {
          drivers: [{ id: "d1", full_name: "A Driver", status: "active", cdl_number: "D123" }],
          certifications: [
            {
              subject_id: "d1", kind: "medical_card", qualifier: null, training_type: null,
              issued_at: "2026-01-01", expires_at: "2026-10-18", document_id: null, // 60 days from TODAY
            },
          ],
          qualification_records: [],
          documents: [],
        },
        rpc: { org_module_enabled: false },
      });
    const TODAY = "2026-08-19";

    const narrow = await getComplianceOverview(rec().client, ORG, TODAY);
    expect(narrow.drivers[0]!.attention.map((a) => a.key)).not.toContain("medical_card");

    const wide = await getComplianceOverview(rec().client, ORG, TODAY, { expiringWithinDays: 91 });
    const medical = wide.drivers[0]!.attention.find((a) => a.key === "medical_card");
    expect(medical).toBeDefined();
    expect(medical!.state).toBe("expiring");
    expect(medical!.daysRemaining).toBe(60);
  });

  it("computes a file for every returned driver even with zero evidence rows", async () => {
    const rec = makeRecorder([
      { id: "d1", full_name: "A Driver", status: "active" },
      { id: "d2", full_name: "B Driver", status: "on_leave" },
    ]);
    const result = await getComplianceOverview(rec.client, ORG, "2026-08-19");
    expect(result.drivers.map((d) => d.state)).toEqual(["not_started", "not_started"]);
    expect(result.truncated).toBe(false);
  });
});

/**
 * The roster's File cell (UNIT-FILES-PLAN UF4b, D-UF7): each driver's newest papers, with signed
 * thumbnails, on the one path that draws them — and on no other. The scheduler and the digest run
 * the same function for a reader who will never open a scan, so for them it must sign nothing; and
 * what the route's reader sees is what the documents list would have shown them, kind by kind.
 */
describe("papers on the overview (UF4b)", () => {
  const D1 = "d1";
  const DOCS = [
    { id: "cdl1", subject_type: "driver", subject_id: D1, kind: "cdl", content_type: "application/pdf", variant: "original", derived_from: null, storage_path: "o/d/cdl1.pdf", captured_at: null, created_at: "2026-03-01T00:00:00Z" },
    { id: "cdl1t", subject_type: "driver", subject_id: D1, kind: "cdl", content_type: "image/webp", variant: "thumb", derived_from: "cdl1", storage_path: "o/d/cdl1t.thumb.webp", captured_at: null, created_at: "2026-03-01T00:00:05Z" },
    // A testing record's scan (Phase G): on file, and not every reader's to see.
    { id: "dt1", subject_type: "driver", subject_id: D1, kind: "drug_test", content_type: "image/jpeg", variant: "original", derived_from: null, storage_path: "o/d/dt1.jpg", captured_at: null, created_at: "2026-04-01T00:00:00Z" },
    { id: "mvr1", subject_type: "driver", subject_id: D1, kind: "mvr", content_type: "image/png", variant: "original", derived_from: null, storage_path: "o/d/mvr1.png", captured_at: null, created_at: "2026-02-01T00:00:00Z" },
    { id: "app1", subject_type: "driver", subject_id: D1, kind: "employment_application", content_type: "application/pdf", variant: "original", derived_from: null, storage_path: "o/d/app1.pdf", captured_at: null, created_at: "2025-01-01T00:00:00Z" },
  ];
  const rec = () =>
    createSupabaseRecorder({
      tables: {
        drivers: [{ id: D1, full_name: "A Driver", status: "active", cdl_number: "D1" }, { id: "d2", full_name: "B Driver", status: "active" }],
        certifications: [{ subject_id: D1, kind: "cdl", qualifier: null, training_type: null, issued_at: "2026-01-01", expires_at: "2030-01-01", document_id: "cdl1" }],
        qualification_records: [],
        documents: DOCS,
      },
      rpc: { org_module_enabled: false },
      storage: { createSignedUrls: (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed.test/${p}` })), error: null }) },
    });

  it("carries the three newest papers a reader may see, with signed thumbnails, and counts the rest", async () => {
    const r = rec();
    const o = await getComplianceOverview(r.client, ORG, "2026-08-19", { withPapers: () => true });
    expect(o.drivers[0]!.papers).toEqual([
      { documentId: "dt1", kind: "drug_test", contentType: "image/jpeg", thumbUrl: null, filedAt: "2026-04-01T00:00:00Z", datedAt: "2026-04-01T00:00:00Z", uploadedBy: null },
      { documentId: "cdl1", kind: "cdl", contentType: "application/pdf", thumbUrl: "https://signed.test/o/d/cdl1t.thumb.webp", filedAt: "2026-03-01T00:00:00Z", datedAt: "2026-03-01T00:00:00Z", uploadedBy: null },
      { documentId: "mvr1", kind: "mvr", contentType: "image/png", thumbUrl: null, filedAt: "2026-02-01T00:00:00Z", datedAt: "2026-02-01T00:00:00Z", uploadedBy: null },
    ]);
    expect(o.drivers[0]!.paper_count).toBe(4);
    // A driver with nothing filed has an empty cell, not an absent one.
    expect(o.drivers[1]!).toMatchObject({ papers: [], paper_count: 0 });
    // The roster cell knows which scan proves the CDL, so the hover card can say until when.
    expect(o.drivers[0]!.requirements.find((c) => c.key === "cdl")).toMatchObject({ documentId: "cdl1", goodUntil: "2030-01-01" });
    expect(r.storageCalls()).toEqual([{ bucket: "compliance-docs", fn: "createSignedUrls", args: [["o/d/cdl1t.thumb.webp"], expect.any(Number)] }]);
    expectOrgScoped(r, ORG);
  });

  it("neither draws nor counts a paper the reader may not see — a dispatcher's roster has no drug test on it (Phase G)", async () => {
    const o = await getComplianceOverview(rec().client, ORG, "2026-08-19", { withPapers: (kind) => kind !== "drug_test" });
    expect(o.drivers[0]!.papers!.map((p) => p.documentId)).toEqual(["cdl1", "mvr1", "app1"]);
    // Four on file, three this reader may see: "+N" must not reveal that a fourth exists.
    expect(o.drivers[0]!.paper_count).toBe(3);
  });

  /** Q-WF4 (§9 P9): a paper whose picture the reader may not see is drawn and counted, with no thumbnail signed. */
  it("draws a paper whose picture is withheld without signing its thumbnail (Q-WF4)", async () => {
    const r = rec();
    const o = await getComplianceOverview(r.client, ORG, "2026-08-19", { withPapers: () => true, imageVisible: (kind) => kind !== "cdl" });
    expect(o.drivers[0]!.papers!.find((p) => p.documentId === "cdl1")).toMatchObject({ thumbUrl: null });
    expect(o.drivers[0]!.paper_count).toBe(4);
    expect(r.storageCalls().flatMap((c) => c.args[0] as string[])).not.toContain("o/d/cdl1t.thumb.webp");
  });

  it("signs nothing and carries no papers when nobody asked — the scheduler's and the digest's path", async () => {
    const r = rec();
    const o = await getComplianceOverview(r.client, ORG, "2026-08-19", { expiringWithinDays: 91 });
    expect(r.storageCalls()).toEqual([]);
    expect("papers" in o.drivers[0]!).toBe(false);
    expect("paper_count" in o.drivers[0]!).toBe(false);
    // And the documents read stays the three-column one the engine needs.
    const docsQ = r.queries.find((q) => q.table === "documents")!;
    expect(docsQ.ops.find((op) => op.method === "select")?.args[0]).toBe("id, subject_id, kind");
  });
});

/**
 * MS2's open item (MEDSTOP-PLAN §7A.15): a Med-Stop hold in the fleet queue — for the readers
 * §382.401(a) admits, and for nobody else, who would otherwise read the result off a new "missing".
 */
describe("the Med-Stop hold in the fleet queue", () => {
  const rtd = (o: Awaited<ReturnType<typeof getComplianceOverview>>) =>
    o.drivers[0]!.attention.find((a) => a.key === "return_to_duty");

  it("asks for return-to-duty documentation for a driver the caller's violations name", async () => {
    const rec = makeRecorder([{ id: "d1", full_name: "A Driver", status: "active" }]);
    const o = await getComplianceOverview(rec.client, ORG, "2026-10-14", { medstopViolations: new Map([["d1", "2026-10-01"]]) });
    expect(rtd(o)).toMatchObject({ state: "missing" });
  });

  it("adds nothing without them — the scheduler, the digest, and every non-testing reader", async () => {
    const rec = makeRecorder([{ id: "d1", full_name: "A Driver", status: "active" }]);
    expect(rtd(await getComplianceOverview(rec.client, ORG, "2026-10-14"))).toBeUndefined();
  });

  it("reads Med-Stop for an admin or a safety manager, and not at all for anybody else", async () => {
    for (const role of ["admin", "safety_manager"] as const) {
      const rec = createSupabaseRecorder({ tables: { medstop_employees: [{ medstop_id: "e1", driver_id: "d1", match_rule: "licence" }], medstop_tests: [{ employee_medstop_id: "e1", service: "TD", status: "CLOSED", result: "POSITIVE", collected_local: "2026-10-01T09:00:00" }] } });
      expect(Object.fromEntries((await overviewViolationsFor(rec.client, ORG, role))!)).toEqual({ d1: "2026-10-01" });
      expectOrgScoped(rec, ORG);
    }
    for (const role of ["fleet_manager", "dispatcher", "recruiter", "auditor", null] as const) {
      const rec = createSupabaseRecorder({ tables: {} });
      expect(await overviewViolationsFor(rec.client, ORG, role)).toBeUndefined();
      expect(rec.queries).toHaveLength(0);
    }
  });
});

/**
 * PostgREST answers at most 1,000 rows a request, whatever `.limit()` asks for. Each table here answers
 * like that — the slice its `.range()` asked for, and never more than 1,000 — so a read that does not
 * page sees only its first thousand, which is what the overview did with all four until 2026-10-16.
 */
describe("reads every row, a page at a time", () => {
  const CAP = 1000;
  const paged = (rows: unknown[]) => (q: { ops: { method: string; args: unknown[] }[] }) => {
    const r = q.ops.find((op) => op.method === "range");
    const [from, to] = r ? (r.args as [number, number]) : [0, rows.length - 1];
    return rows.slice(from, Math.min(to + 1, from + CAP));
  };
  // One driver past the first thousand, whose medical card is the 1,201st certification.
  const drivers = Array.from({ length: 1001 }, (_, i) => ({ id: `d${i}`, full_name: `Driver ${String(i).padStart(4, "0")}`, status: "active" }));
  const medCard = (subject: string, expires: string) => ({ subject_id: subject, kind: "medical_card", qualifier: null, training_type: null, issued_at: "2026-01-01", expires_at: expires, document_id: null });
  const certs = [...Array.from({ length: 1200 }, (_, i) => medCard(`d${i % 1000}`, "2027-06-01")), medCard("d1000", "2026-09-01")];

  it("finds the 1,001st driver and the 1,201st certification", async () => {
    const rec = createSupabaseRecorder({
      tables: { drivers: paged(drivers), certifications: paged(certs), qualification_records: paged([]), documents: paged([]) },
      rpc: { org_module_enabled: false },
    });
    const result = await getComplianceOverview(rec.client, ORG, "2026-10-16");
    expect(result.drivers).toHaveLength(1001);
    const last = result.drivers.find((d) => d.driver_id === "d1000")!;
    // Read, the expired card puts the driver in the queue; unread, it would say the card is missing.
    expect(last.attention.find((a) => a.key.includes("medical"))).toMatchObject({ state: "expired" });
    expect(rec.forTable("certifications").length).toBe(2);
    expectOrgScoped(rec, ORG);
  });

  it("says the record read was cut at its cap, which a single request never could", async () => {
    const records = Array.from({ length: 10_050 }, (_, i) => ({ driver_id: "d0", kind: "annual_review", occurred_on: "2026-01-01", covers_until: null, document_id: null, id: i }));
    const rec = createSupabaseRecorder({
      tables: { drivers: paged(drivers.slice(0, 1)), certifications: paged([]), qualification_records: paged(records), documents: paged([]) },
      rpc: { org_module_enabled: false },
    });
    const result = await getComplianceOverview(rec.client, ORG, "2026-10-16");
    expect(result.truncated).toBe(true);
    // Ten pages and no eleventh: the cap stops the read, it is not a filter applied afterwards.
    expect(rec.forTable("qualification_records").length).toBe(10);
  });
});

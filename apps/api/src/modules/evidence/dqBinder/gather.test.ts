import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { gatherSample } from "./gather.js";

/**
 * Phase G (D-DQ15) at the binder — the highest-stakes read in the product, because its output is a
 * PDF built to leave the building. Two properties, both non-negotiable:
 *   1. A default binder prints NO restricted evidence: no drug-test event rows, no restricted scans.
 *   2. The checklist STATE stays truthful anyway — a driver with a drug test on record must not
 *      print as "missing" and send an auditor chasing a gap that does not exist.
 */
const ORG = "org1";
const DRIVER = "00000000-0000-4000-8000-0000000000d1";
const MVR_DOC = "00000000-0000-4000-8000-00000000000a";
const DRUG_DOC = "00000000-0000-4000-8000-00000000000b";

function makeRecorder() {
  return createSupabaseRecorder({
    tables: {
      drivers: [
        {
          id: DRIVER,
          full_name: "A Driver",
          employee_id: null,
          hire_date: null,
          termination_date: null,
          status: "active",
        },
      ],
      certifications: [],
      qualification_records: [
        { driver_id: DRIVER, kind: "mvr", occurred_on: "2026-01-10", covers_until: null, performed_by: null, reference: null, document_id: MVR_DOC },
        { driver_id: DRIVER, kind: "drug_test", occurred_on: "2026-02-01", covers_until: null, performed_by: null, reference: null, document_id: DRUG_DOC },
      ],
      documents: [
        { id: MVR_DOC, subject_id: DRIVER, kind: "mvr", storage_path: "p/a.pdf", content_type: "application/pdf", bytes: 10, sha256: "a".repeat(64), created_at: "2026-01-10" },
        { id: DRUG_DOC, subject_id: DRIVER, kind: "drug_test", storage_path: "p/b.pdf", content_type: "application/pdf", bytes: 10, sha256: "b".repeat(64), created_at: "2026-02-01" },
      ],
    },
  });
}

describe("gatherSample — restricted evidence (Phase G)", () => {
  it("a default binder carries no restricted events or scans, and the checklist state stays truthful", async () => {
    const rec = makeRecorder();
    const { drivers } = await gatherSample(rec.client, ORG, [DRIVER], "2026-08-19", false, false);
    const d = drivers[0]!;

    expect(d.events.map((e) => e.kind)).toEqual(["mvr"]);
    expect(d.documentsById.has(DRUG_DOC)).toBe(false);
    expect(d.documentsById.has(MVR_DOC)).toBe(true);

    // The state is computed from EVERYTHING: the pre-employment drug test is on record, so its
    // checklist item must not read "missing" in the version that hides the evidence.
    const drugItem = d.file.items.find((i) => i.spec.evidenceKinds.includes("drug_test"));
    expect(drugItem).toBeDefined();
    expect(drugItem!.state).not.toBe("missing");

    expectOrgScoped(rec, ORG);
  });

  it("a privileged includeRestricted binder carries both", async () => {
    const rec = makeRecorder();
    const { drivers } = await gatherSample(rec.client, ORG, [DRIVER], "2026-08-19", false, true);
    const d = drivers[0]!;
    expect(d.events.map((e) => e.kind).sort()).toEqual(["drug_test", "mvr"]);
    expect(d.documentsById.has(DRUG_DOC)).toBe(true);
  });
});

/**
 * A Med-Stop positive or refusal (MS2) in the binder (MEDSTOP-PLAN §7A.15). It is a §382.401(a) fact:
 * a RESTRICTED binder asks for the return-to-duty documentation it raises; a default binder neither
 * shows the item nor reads Med-Stop — an item there would state the result to whoever opens the PDF.
 */
describe("gatherSample — a Med-Stop hold", () => {
  const withViolation = (day: string) =>
    createSupabaseRecorder({
      tables: {
        drivers: [{ id: DRIVER, full_name: "A Driver", employee_id: null, hire_date: null, termination_date: null, status: "active" }],
        certifications: [],
        qualification_records: [],
        documents: [],
        medstop_employees: [{ medstop_id: "e1", driver_id: DRIVER, match_rule: "licence" }],
        medstop_tests: [{ employee_medstop_id: "e1", service: "TD", status: "CLOSED", result: "POSITIVE", collected_local: `${day}T09:00:00` }],
      },
    });
  const rtd = (d: { file: { items: Array<{ spec: { key: string }; state: string }> } }) => d.file.items.find((i) => i.spec.key === "return_to_duty");

  it("asks for return-to-duty documentation in a restricted binder", async () => {
    const rec = withViolation("2026-08-01");
    const { drivers } = await gatherSample(rec.client, ORG, [DRIVER], "2026-08-19", false, true);
    expect(rtd(drivers[0]!)).toMatchObject({ state: "missing" });
    expectOrgScoped(rec, ORG);
  });

  it("shows nothing of it in a default binder, and never reads Med-Stop for one", async () => {
    const rec = withViolation("2026-08-01");
    const { drivers } = await gatherSample(rec.client, ORG, [DRIVER], "2026-08-19", false, false);
    expect(rtd(drivers[0]!)).toBeUndefined();
    expect(rec.forTable("medstop_tests")).toHaveLength(0);
  });

  it("judges the file as at the binder's date — a later violation was not yet owed", async () => {
    const rec = withViolation("2026-09-01");
    const { drivers } = await gatherSample(rec.client, ORG, [DRIVER], "2026-08-19", false, true);
    expect(rtd(drivers[0]!)).toBeUndefined();
  });
});

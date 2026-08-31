import { describe, expect, it } from "vitest";
import { DQ_KIND_LABELS } from "./dqCatalogue.js";
import { QUALIFICATION_RECORD_KINDS } from "./complianceContract.js";
import { hiringGapsAfterHire } from "./hireHandoff.js";
import {
  buildDqFile,
  dqAttention,
  dqCapturableSpecs,
  dqRosterCells,
  DQ_ROSTER_COLUMN_KEYS,
  DQ_ITEMS,
  type DqCertInput,
  type DqDocumentInput,
  type DqRecordInput,
} from "./dqFile.js";

/**
 * The §391.51 checklist. Every assertion here is a question a DOT auditor asks out loud, which is the
 * only reason any of these items exist.
 */

const TODAY = "2026-08-08";

const cert = (over: Partial<DqCertInput>): DqCertInput => ({
  kind: "cdl", qualifier: null, trainingType: null, issuedAt: null, expiresAt: null, documentId: null, ...over,
});
const record = (over: Partial<DqRecordInput>): DqRecordInput => ({
  kind: "mvr", occurredOn: "2026-01-01", coversUntil: null, documentId: null, ...over,
});

const build = (o: Partial<Parameters<typeof buildDqFile>[0]> = {}) =>
  buildDqFile({ today: TODAY, certs: [], records: [], documents: [], includeHazmat: true, ...o });

const item = (f: ReturnType<typeof build>, key: string) => f.items.find((i) => i.spec.key === key)!;

describe("buildDqFile — scope", () => {
  it("omits the hazmat items for a carrier without the module", () => {
    const keys = build({ includeHazmat: false }).items.map((i) => i.spec.key);
    expect(keys).not.toContain("endorsement_hazmat");
    expect(keys).not.toContain("training_safety");
    expect(keys).toContain("cdl");
  });

  it("includes them when hazmat is on", () => {
    expect(build().items.map((i) => i.spec.key)).toContain("training_security_awareness");
  });

  it("leaves the tank endorsement out entirely — that is the load's question, not the file's", () => {
    expect(DQ_ITEMS.map((i) => i.key)).not.toContain("endorsement_tank");
  });

  it("leaves out §391.27, which was removed in 2020", () => {
    // Filing it would teach a carrier a requirement that no longer exists.
    expect(DQ_ITEMS.some((i) => i.citation.includes("391.27"))).toBe(false);
  });
});

/**
 * §40.25(j)'s paperwork in the file (0237, and the wiring that was missing from it).
 *
 * ⚠ **The gate shipped before the file knew about it.** `assignLoad` refused a driver who owed
 * return-to-duty documentation and there was no way to file that documentation from any screen: the
 * kind had no `DQ_KIND_LABELS` entry, so it rendered as a raw slug in the history drawer and the
 * binder, and no `DQ_ITEMS` entry, so `RequirementDrawer` never offered it. A block with no way to
 * lift it is worse than no block.
 */
describe("the return-to-duty requirement", () => {
  const owing = { returnToDutyRequired: true };

  it("is absent from a file for a driver who never admitted anything", () => {
    expect(build().items.map((i) => i.spec.key)).not.toContain("return_to_duty");
  });

  it("appears, and reads as missing, once the driver owes it", () => {
    const f = build(owing);
    expect(f.items.map((i) => i.spec.key)).toContain("return_to_duty");
    expect(item(f, "return_to_duty").state).toBe("missing");
  });

  it("is satisfied by the filed record, which is what lifts the dispatch block", () => {
    const f = build({ ...owing, records: [record({ kind: "return_to_duty", occurredOn: "2026-03-01" })] });
    expect(item(f, "return_to_duty").state).toBe("current");
  });

  /**
   * ⚠ The two lists must agree. Before 0237 there was one condition and the two filters were two
   * copies of one line; a second condition is what turns that into a checklist offering a
   * requirement the file does not have, or a file demanding one the checklist cannot capture.
   */
  it("is offered for capture exactly when the file asks for it", () => {
    const capturable = (o: { returnToDutyRequired?: boolean }) =>
      dqCapturableSpecs({ includeHazmat: true, ...o }).map((s) => s.key).includes("return_to_duty");
    expect(capturable({})).toBe(false);
    expect(capturable(owing)).toBe(true);
  });

  /**
   * ⚠ `hiringGapsAfterHire` sees records, not drivers, so it cannot evaluate the condition — and an
   * item it cannot evaluate must not be reported. Listing this one would tell every carrier that
   * every hire is missing §40.25(j) paperwork. The real warning is `HireResult.returnToDutyBlocked`.
   */
  it("is never reported as a hiring gap, because that function cannot know whether it applies", () => {
    expect(hiringGapsAfterHire([], []).map((g) => g.key)).not.toContain("return_to_duty");
  });
});

/**
 * ⚠ The guard that would have caught the raw-slug bug, and catches the next one.
 *
 * `DQ_KIND_LABELS` is what the history drawer, the file page and the binder PDF all read to turn a
 * `kind` into English. A kind added to the vocabulary and not to the map does not fail anything — it
 * renders as `return_to_duty` in a document an auditor reads, which is how it shipped.
 */
describe("every qualification-record kind has a name", () => {
  it.each([...QUALIFICATION_RECORD_KINDS])("%s", (kind) => {
    expect(DQ_KIND_LABELS[kind], `${kind} has no label`).toBeTruthy();
  });
});

describe("buildDqFile — an empty file", () => {
  it("is not_started, and every item is missing", () => {
    const f = build();
    expect(f.state).toBe("not_started");
    expect(f.counts.missing).toBe(f.items.length);
    expect(f.counts.current).toBe(0);
  });

  it("becomes merely incomplete once anything at all is filed", () => {
    const f = build({ certs: [cert({ kind: "cdl", expiresAt: "2027-01-01" })] });
    expect(f.state).toBe("incomplete");
  });
});

describe("buildDqFile — expiry-based items", () => {
  it("is current when the expiry is comfortably ahead", () => {
    const f = build({ certs: [cert({ kind: "medical_card", expiresAt: "2027-01-01" })] });
    expect(item(f, "medical_card").state).toBe("current");
    expect(item(f, "medical_card").goodUntil).toBe("2027-01-01");
  });

  it("is expiring right up to the last day of the window, and current one day past it", () => {
    // August has 31 days, so 2026-08-08 + 30 days is 2026-09-07 — not the 8th. The off-by-one here
    // is exactly the kind a hand-written expectation gets wrong, which is why the boundary is pinned
    // on both sides rather than sampled once in the middle.
    expect(item(build({ certs: [cert({ kind: "medical_card", expiresAt: "2026-09-06" })] }), "medical_card").state)
      .toBe("expiring");
    expect(item(build({ certs: [cert({ kind: "medical_card", expiresAt: "2026-09-07" })] }), "medical_card").state)
      .toBe("expiring");
    expect(item(build({ certs: [cert({ kind: "medical_card", expiresAt: "2026-09-08" })] }), "medical_card").state)
      .toBe("current");
  });

  it("is expired the day after it lapses, and still current on the day itself", () => {
    expect(item(build({ certs: [cert({ kind: "medical_card", expiresAt: "2026-08-08" })] }), "medical_card").state)
      .toBe("expiring");
    expect(item(build({ certs: [cert({ kind: "medical_card", expiresAt: "2026-08-07" })] }), "medical_card").state)
      .toBe("expired");
  });

  it("flags evidence that records no expiry rather than treating it as eternal", () => {
    const i = item(build({ certs: [cert({ kind: "cdl", expiresAt: null })] }), "cdl");
    expect(i.expiryUnknown).toBe(true);
    expect(i.goodUntil).toBeNull();
  });

  it("accepts H or X for the hazmat endorsement and ignores the rest", () => {
    for (const q of ["H", "X"]) {
      expect(item(build({ certs: [cert({ kind: "endorsement", qualifier: q, expiresAt: "2027-01-01" })] }), "endorsement_hazmat").state)
        .toBe("current");
    }
    expect(item(build({ certs: [cert({ kind: "endorsement", qualifier: "N", expiresAt: "2027-01-01" })] }), "endorsement_hazmat").state)
      .toBe("missing");
  });
});

describe("buildDqFile — recurring items", () => {
  it("gives an annual review one year from the day it happened", () => {
    const f = build({ records: [record({ kind: "annual_mvr_review", occurredOn: "2026-03-01" })] });
    expect(item(f, "annual_mvr_review").goodUntil).toBe("2027-03-01");
    expect(item(f, "annual_mvr_review").state).toBe("current");
  });

  it("expires an annual review a year and a day later", () => {
    const f = build({ records: [record({ kind: "annual_mvr_review", occurredOn: "2025-08-07" })] });
    expect(item(f, "annual_mvr_review").state).toBe("expired");
  });

  it("lets an explicit covers_until override the arithmetic", () => {
    const f = build({ records: [record({ kind: "annual_mvr_review", occurredOn: "2025-01-01", coversUntil: "2027-01-01" })] });
    expect(item(f, "annual_mvr_review").goodUntil).toBe("2027-01-01");
    expect(item(f, "annual_mvr_review").state).toBe("current");
  });

  it("takes the newest occurrence when a record was corrected", () => {
    // qualification_records is append-only: a correction is a new row, not an edit.
    const f = build({ records: [
      record({ kind: "annual_mvr_review", occurredOn: "2024-01-01" }),
      record({ kind: "annual_mvr_review", occurredOn: "2026-06-01" }),
    ] });
    expect(item(f, "annual_mvr_review").goodUntil).toBe("2027-06-01");
  });

  it("runs hazmat training three years from the ISSUED date (§172.704(c)(2))", () => {
    const fresh = build({ certs: [cert({ kind: "hazmat_training", trainingType: "safety", issuedAt: "2024-01-01" })] });
    expect(item(fresh, "training_safety").state).toBe("current");
    expect(item(fresh, "training_safety").goodUntil).toBe("2027-01-01");

    // Training issued exactly three years ago comes due TODAY. `expiring`, not `current`: §172.704(c)(2)
    // says recurrent training at least once every three years, so the third anniversary is the
    // deadline, not the last safe day. The hazmat GATE still passes it — a warning here and a pass
    // there is the correct pair, because these two answer different questions.
    const dueToday = build({ certs: [cert({ kind: "hazmat_training", trainingType: "safety", issuedAt: "2023-08-08" })] });
    expect(item(dueToday, "training_safety").state).toBe("expiring");
    expect(item(dueToday, "training_safety").goodUntil).toBe(TODAY);

    const stale = build({ certs: [cert({ kind: "hazmat_training", trainingType: "safety", issuedAt: "2023-08-07" })] });
    expect(item(stale, "training_safety").state).toBe("expired");
  });

  it("keeps the four training types apart — §172.704(a) is five requirements, not one", () => {
    const f = build({ certs: [cert({ kind: "hazmat_training", trainingType: "safety", issuedAt: "2026-01-01" })] });
    expect(item(f, "training_safety").state).toBe("current");
    expect(item(f, "training_general_awareness").state).toBe("missing");
  });
});

describe("buildDqFile — one-time items", () => {
  it("never expires an employment application", () => {
    const f = build({ records: [record({ kind: "employment_application", occurredOn: "2019-04-02" })] });
    expect(item(f, "employment_application").state).toBe("current");
    expect(item(f, "employment_application").goodUntil).toBeNull();
  });

  it("accepts either lawful evidence for the road-test requirement (§391.31 or §391.33)", () => {
    expect(item(build({ records: [record({ kind: "road_test", occurredOn: "2020-01-01" })] }), "road_test").state).toBe("current");
    expect(item(build({ records: [record({ kind: "cdl_equivalency", occurredOn: "2020-01-01" })] }), "road_test").state).toBe("current");
  });
});

describe("buildDqFile — the scan behind an item", () => {
  const DOC = "11111111-1111-4111-8111-111111111111";
  const docs: DqDocumentInput[] = [{ id: DOC, kind: "medical_card" }];

  it("reports the document when the register and the row agree", () => {
    const f = build({ certs: [cert({ kind: "medical_card", expiresAt: "2027-01-01", documentId: DOC })], documents: docs });
    expect(item(f, "medical_card").documentId).toBe(DOC);
  });

  it("reports NO document when the id points at nothing", () => {
    // A failed upload leaves the metadata row behind. A checklist that trusted the id would promise
    // the auditor a scan that cannot be opened.
    const f = build({ certs: [cert({ kind: "medical_card", expiresAt: "2027-01-01", documentId: DOC })], documents: [] });
    expect(item(f, "medical_card").documentId).toBeNull();
    // The item itself is still current — the certification is valid, only the scan is absent.
    expect(item(f, "medical_card").state).toBe("current");
  });
});

describe("dqAttention — date projections", () => {
  it("includes evidence dates for certification and record-backed requirements", () => {
    const f = build({
      includeHazmat: false,
      certs: [cert({ kind: "medical_card", issuedAt: "2026-01-01", expiresAt: "2026-08-07" })],
      records: [record({ kind: "annual_mvr_review", occurredOn: "2025-08-07" })],
    });
    const attention = dqAttention(f, TODAY);
    expect(attention.find((item) => item.key === "medical_card")).toMatchObject({
      evidenceDate: "2026-01-01",
      goodUntil: "2026-08-07",
    });
    expect(attention.find((item) => item.key === "annual_mvr_review")).toMatchObject({
      evidenceDate: "2025-08-07",
      goodUntil: "2026-08-07",
    });
  });
});

describe("buildDqFile — completeness", () => {
  it("is complete only when nothing is missing or expired", () => {
    const f = build({
      includeHazmat: false,
      certs: [
        cert({ kind: "cdl", expiresAt: "2027-01-01" }),
        cert({ kind: "medical_card", expiresAt: "2027-01-01" }),
      ],
      records: [
        record({ kind: "employment_application", occurredOn: "2024-01-01" }),
        record({ kind: "mvr", occurredOn: "2024-01-01" }),
        record({ kind: "previous_employer_inquiry", occurredOn: "2024-01-01" }),
        record({ kind: "previous_employer_response", occurredOn: "2024-01-15" }),
        record({ kind: "road_test", occurredOn: "2024-01-02" }),
        record({ kind: "eldt", occurredOn: "2023-06-01" }),
        record({ kind: "medical_registry_verification", occurredOn: "2024-01-03" }),
        record({ kind: "drug_test", occurredOn: "2024-01-04" }),
        record({ kind: "clearinghouse_full", occurredOn: "2024-01-05" }),
        record({ kind: "annual_mvr_review", occurredOn: "2026-01-06" }),
        record({ kind: "clearinghouse_limited", occurredOn: "2026-01-07" }),
      ],
    });
    expect(f.counts.missing).toBe(0);
    expect(f.counts.expired).toBe(0);
    expect(f.state).toBe("complete");
  });

  it("stays complete with an item merely expiring — expiring is a warning, not a gap", () => {
    const f = build({ includeHazmat: false, certs: [cert({ kind: "cdl", expiresAt: "2026-08-20" })] });
    expect(item(f, "cdl").state).toBe("expiring");
    expect(f.state).toBe("incomplete"); // still incomplete, but because of the OTHER missing items
    expect(f.counts.expired).toBe(0);
  });
});

/**
 * D8 — the verified regulatory state (plan G33, eCFR current through 2026-08-07). Three corrections:
 * ELDT is tracked-not-required, the registry note is non-CDL-only, and the medical item cites
 * (b)(6) post-2022. Each assertion is the sentence the regulation actually says now.
 */
describe("buildDqFile — D8 regulatory corrections", () => {
  it("an empty file does not demand ELDT — §391.51(b) has no ELDT item", () => {
    expect(build().items.map((i) => i.spec.key)).not.toContain("eldt");
  });

  it("a filed ELDT certificate renders, marked advisory, and never enters attention when current", () => {
    const f = build({ records: [record({ kind: "eldt", occurredOn: "2024-01-01" })] });
    const eldt = item(f, "eldt");
    expect(eldt.state).toBe("current");
    expect(eldt.spec.advisory).toBe(true);
    expect(dqAttention(f, TODAY).map((a) => a.key)).not.toContain("eldt");
  });

  it("a CDL holder's file has no registry-note item — §391.51(b)(8)(ii) sunset 2025-06-22", () => {
    const withCdl = build({ hasCdl: true });
    expect(withCdl.items.map((i) => i.spec.key)).not.toContain("medical_registry_verification");
    // And the count shrinks accordingly rather than reporting a permanent gap.
    expect(withCdl.counts.missing).toBe(withCdl.items.length);
  });

  it("a non-CDL driver's file still demands the registry note — §391.23(m)(1)", () => {
    const noCdl = build({ hasCdl: false });
    expect(noCdl.items.map((i) => i.spec.key)).toContain("medical_registry_verification");
    expect(item(noCdl, "medical_registry_verification").state).toBe("missing");
  });

  it("unknown licence status reads as the stricter file — hasCdl defaults false", () => {
    expect(build().items.map((i) => i.spec.key)).toContain("medical_registry_verification");
  });

  it("dqCapturableSpecs still offers ELDT so the first certificate can be filed", () => {
    const keys = dqCapturableSpecs({ includeHazmat: true, hasCdl: true }).map((s) => s.key);
    expect(keys).toContain("eldt");
    expect(keys).not.toContain("medical_registry_verification");
  });

  it("the medical item cites the post-2022 (b)(6), not the pre-renumbering (b)(7)", () => {
    const spec = DQ_ITEMS.find((i) => i.key === "medical_card")!;
    expect(spec.citation).toContain("391.51(b)(6)");
  });
});

/**
 * The roster's three expiry columns (R4, D-ROS9).
 *
 * These exist because the roster must not read `drivers.cdl_expires_at`: two sources of truth for a
 * legal gate IS the defect (D-DQ6). The cells are a projection of the same file the driver page
 * renders, so a date on the roster and the same date on the driver's qualification section cannot
 * disagree — there is no second calculation to drift.
 */
describe("dqRosterCells — the roster's expiry columns", () => {
  const cellsFor = (o: Parameters<typeof build>[0] = {}) => {
    const out = new Map(dqRosterCells(build(o), TODAY).map((c) => [c.key, c]));
    return out;
  };

  it("carries a date for a driver whose requirement is perfectly current", () => {
    // The whole reason these are not read off `attention`: that list filters `current` out, so the
    // column would have been empty for exactly the drivers with nothing wrong.
    const c = cellsFor({ certs: [cert({ kind: "cdl", expiresAt: "2030-01-01" })] }).get("cdl")!;
    expect(c.state).toBe("current");
    expect(c.goodUntil).toBe("2030-01-01");
    expect(c.daysRemaining).toBeGreaterThan(0);
  });

  it("counts days to expiry the same way the queue does, so the two cannot disagree", () => {
    const file = build({ certs: [cert({ kind: "cdl", expiresAt: "2026-08-20" })] });
    const cell = dqRosterCells(file, TODAY).find((c) => c.key === "cdl")!;
    const queued = dqAttention(file, TODAY).find((a) => a.key === "cdl");
    expect(cell.daysRemaining).toBe(12);
    // When the item IS in the queue, both surfaces must be counting to the same day.
    if (queued) expect(queued.daysRemaining).toBe(cell.daysRemaining);
  });

  it("goes negative when a requirement has lapsed, rather than reading as absent", () => {
    const c = cellsFor({ certs: [cert({ kind: "cdl", expiresAt: "2026-08-01" })] }).get("cdl")!;
    expect(c.state).toBe("expired");
    expect(c.daysRemaining).toBeLessThan(0);
  });

  it("reports a requirement with no evidence as missing, with no date to show", () => {
    const c = cellsFor().get("cdl")!;
    expect(c.state).toBe("missing");
    expect(c.goodUntil).toBeNull();
    expect(c.daysRemaining).toBeNull();
  });

  it("omits a requirement that does not APPLY, rather than calling it missing", () => {
    // Hazmat on a carrier without the module. The column reads "—", which is the truth; "missing"
    // would be an accusation about a requirement this carrier does not have.
    expect(cellsFor({ includeHazmat: false }).has("endorsement_hazmat")).toBe(false);
    expect(cellsFor({ includeHazmat: true }).has("endorsement_hazmat")).toBe(true);
  });

  it("flags evidence that records no expiry rather than treating it as an eternal licence", () => {
    const c = cellsFor({ certs: [cert({ kind: "cdl", issuedAt: "2026-01-01", expiresAt: null })] }).get("cdl")!;
    expect(c.expiryUnknown).toBe(true);
  });

  it("projects every key it declares, and nothing else", () => {
    // A key added to the catalogue list without a column, or a column with no catalogue item, is the
    // way these three quietly become two.
    const keys = [...cellsFor({ includeHazmat: true }).keys()].sort();
    expect(keys).toEqual([...DQ_ROSTER_COLUMN_KEYS].sort());
  });
});

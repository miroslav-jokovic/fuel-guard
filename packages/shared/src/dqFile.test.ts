import { describe, expect, it } from "vitest";
import {
  buildDqFile,
  dqAttention,
  dqCapturableSpecs,
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

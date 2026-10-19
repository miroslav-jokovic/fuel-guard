import { describe, expect, it } from "vitest";
import { emptyShippingDocument, printedHazmatLineSchema, type PrintedHazmatLine, type ShippingDocument } from "@silvicom/shared";
import { shippingEvidence } from "../evidence/shippingEvidence.js";
import { ACCEPTANCE_RULE_VERSION } from "./cacheKey.js";
import { replayRead, type StoredRead } from "./replay.js";

/**
 * A stored read judged again (RC2). What must hold: today's code over the stored inputs reproduces a read
 * judged by today's code exactly (no false diff); a read judged by older code shows what moved; a read with
 * no stored inputs is refused, never re-judged with pass B missing.
 */
const line = (over: Partial<PrintedHazmatLine>): PrintedHazmatLine => printedHazmatLineSchema.parse(over);
const doc = (lines: PrintedHazmatLine[]): ShippingDocument => {
  const e = emptyShippingDocument();
  return { ...e, hazmat: { ...e.hazmat, lines } };
};
const UN1993 = { idText: "UN1993", psn: "FLAMMABLE LIQUID, N.O.S. (ISOPROPYL ALCOHOL)", hazardClass: "3", pg: "III" as const, packageCount: 4, grossWeightLb: 1555 };

function stored(a: ShippingDocument, b: ShippingDocument | null, evidence: unknown = shippingEvidence(a, b, ACCEPTANCE_RULE_VERSION, null, null)): StoredRead {
  return { id: "r1", profile: "shipping_document", result: a, evidence, replay_inputs: { passB: b, ocr: null, textLayer: null } };
}

describe("replayRead", () => {
  it("reproduces a read judged by today's code with no diff at all", () => {
    const a = doc([line(UN1993)]);
    const r = replayRead(stored(a, doc([line(UN1993)])));
    expect(r).toMatchObject({ replayable: true, fields: [], findings: [], ruleChanged: false });
  });

  it("shows what moved on a read judged by older code — the owner's UN1993 line of 2026-10-19", () => {
    const a = doc([line(UN1993)]);
    const b = doc([line(UN1993)]);
    // As the read of 2026-10-19 stored it under rule 7: the table refused the singular name.
    const old = shippingEvidence(a, b, "7", null, null).map((e) =>
      e.path === "hazmat.lines[0].idText"
        ? { ...e, sources: e.sources.map((s) => (s.reader === "table" ? { ...s, value: { consistent: false, dataset: "2026.07.1", reason: "psn_no_match" } } : s)) }
        : e);
    const r = replayRead(stored(a, b, old));
    if (!r.replayable) throw new Error(r.why);
    expect(r.ruleChanged).toBe(true);
    // The stored table verdict is what the calculator's product came from; today's is consistent.
    const idText = r.evidence.find((e) => e.path === "hazmat.lines[0].idText")!;
    expect(r.fields.map((f) => f.path)).toContain("hazmat.lines[0].idText");
    expect(idText.sources.find((s) => s.reader === "table")!.value).toMatchObject({ consistent: true });
  });

  it("shows an audit finding that moves because the evidence moved — a count the readers now agree on", () => {
    const a = doc([line({ ...UN1993, packageCount: null })]);
    const b = doc([line({ ...UN1993, packageCount: null })]);
    // Stored: pass B had read a count; today's inputs say both read none — the quantity rule can now judge.
    const old = shippingEvidence(a, doc([line(UN1993)]), "7", null, null);
    const r = replayRead(stored(a, b, old));
    if (!r.replayable) throw new Error(r.why);
    expect(r.fields.map((f) => f.path)).toContain("hazmat.lines[0].packageCount");
    expect(r.findings.length).toBeGreaterThan(0);
  });

  it("refuses a read with no stored inputs instead of judging it on pass A alone", () => {
    const a = doc([line(UN1993)]);
    expect(replayRead({ ...stored(a, null), replay_inputs: null })).toMatchObject({ replayable: false });
  });
});

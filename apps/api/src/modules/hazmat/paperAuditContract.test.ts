import { describe, expect, it } from "vitest";
import { buildDatasetIndex, loadDataset, resolveHmtLine, type ResolveLineResult } from "@hazmat/data";
import {
  PAPER_RULE_IDS,
  auditPrintedPaper,
  type PaperResolution,
  type PaperRuleResult,
  type PrintedPaper,
  type PrintedPaperLine,
} from "@hazmat/engine";
import {
  BOL_FINDING_CATALOGUE,
  BOL_FINDING_RULE_IDS,
  emptyShippingDocument,
  printedHazmatLineSchema,
  type BolFindingContext,
  type PrintedHazmatLine,
  type ShippingDocument,
} from "@silvicom/shared";

/**
 * The seams between three packages that may not import each other (lint:boundaries): the reader's
 * contract (`@silvicom/shared`), the resolver (`@hazmat/data`) and the printed-paper audit
 * (`@hazmat/engine`, document reader D-DR6). The engine defines structural input shapes and the
 * catalogue a structural context; this file is where the real types are made to fit them, so a field
 * renamed on any side fails `tsc` here instead of silently reading as null.
 */

// ── type level: these assignments are the test; `pnpm typecheck` compiles this file ───────────────
type Assignable<From, To> = [From] extends [To] ? true : false;
const printedLineFits: Assignable<PrintedHazmatLine, PrintedPaperLine> = true;
const documentFits: Assignable<ShippingDocument, PrintedPaper> = true;
const resolutionFits: Assignable<ResolveLineResult, PaperResolution> = true;
const resultFitsCatalogue: Assignable<PaperRuleResult, BolFindingContext> = true;

const DATASET = loadDataset("2026.08.0");
const INDEX = buildDatasetIndex(DATASET);
const printed = (over: Partial<PrintedHazmatLine>): PrintedHazmatLine => printedHazmatLineSchema.parse(over);

function auditDocument(doc: ShippingDocument) {
  const resolved = doc.hazmat.lines.map((l) =>
    resolveHmtLine(INDEX, { idText: l.idText, psn: l.psn, hazardClass: l.hazardClass, pg: l.pg }),
  );
  return auditPrintedPaper(doc, { dataset: DATASET, lines: resolved.map((resolution) => ({ resolution, quantityUnit: "gal", packagingKind: "bulk" })) });
}

describe("printed-paper audit seams (D-DR6 / D-DR7)", () => {
  it("compiles the reader's and resolver's real types into the engine's input shapes", () => {
    expect([printedLineFits, documentFits, resolutionFits, resultFitsCatalogue]).toEqual([true, true, true, true]);
  });

  it("has one catalogue entry for every engine rule id, and no other", () => {
    expect([...BOL_FINDING_RULE_IDS].sort()).toEqual([...PAPER_RULE_IDS].sort());
  });

  it("renders every result of a real two-line BOL through the catalogue against dataset 2026.08.0", () => {
    const doc = emptyShippingDocument();
    doc.hazmat.lines = [
      printed({ idText: "UN1203", psn: "Gasoline", hazardClass: "3", pg: "II", quantity: { value: 8000, unit: "gal" }, packageCount: 1, packaging: "1 cargo tank" }),
      // F-DR11's first real BOL: lead-acid batteries marked X with the shipper's model text only.
      printed({ hmColumnMark: "X", quantity: { value: 2, unit: null }, packaging: "pallets" }),
    ];
    doc.hazmat.shipperCertification = true;
    const audit = auditDocument(doc);
    expect(audit.datasetVersion).toBe("2026.08.0");
    for (const r of audit.results) {
      const text = BOL_FINDING_CATALOGUE[r.ruleId].sentence(r);
      expect(text, `${r.ruleId}/${r.reason}`).not.toMatch(/undefined|null|\(\)|""|\s{2}/);
    }
    const outcome = (ruleId: string, lineIndex: number | null) => audit.results.find((r) => r.ruleId === ruleId && r.lineIndex === lineIndex)?.outcome;
    expect(outcome("paper_sequence", 1)).toBe("fail");
    expect(outcome("paper_er_phone", null)).toBe("fail");
    expect(outcome("paper_psn_matches_hmt", 0)).toBe("pass");
    expect(outcome("paper_psn_matches_hmt", 1)).toBe("cannot_tell");
  });

  it("answers LQ cannot_tell on the latest released dataset, which predates HMT column 8A", () => {
    const old = loadDataset("2026.07.1");
    const line = printed({ idText: "UN1203", psn: "Gasoline", hazardClass: "3", pg: "II", marks: ["LTD QTY"] });
    const resolution = resolveHmtLine(buildDatasetIndex(old), { idText: "UN1203", psn: "Gasoline", hazardClass: "3", pg: "II" });
    const doc = emptyShippingDocument();
    doc.hazmat.lines = [line];
    const lq = auditPrintedPaper(doc, { dataset: old, lines: [{ resolution }] }).results.find((r) => r.ruleId === "paper_lq");
    expect(lq?.reason).toBe("requirement_not_in_dataset");
  });
});

import { describe, expect, it } from "vitest";
import { alignHazmatLines, hazmatLineKey, valuesEqual } from "./documentFieldMatch.js";
import { documentBand, scoreCorpus, type CorpusEntry, type FieldScore } from "./documentScoring.js";
import { shippingDocumentLabelsSkeleton } from "./documentReadingContract.js";
import type { FieldEvidence } from "./fieldEvidenceContract.js";
import { leafFieldPaths } from "./fieldEvidenceContract.js";
import { emptyShippingDocument, printedHazmatLineSchema, type PrintedHazmatLine, type ShippingDocument } from "./shippingDocumentContract.js";

// Every fixture here is SYNTHETIC and built in the test. The real corpus (fixtures/real/private) holds
// real shippers' papers and never enters a test or a commit.

// The shared package compiles for React Native too, so no `structuredClone` in its types; JSON round-trip
// is enough for these plain objects.
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const line = (over: Partial<PrintedHazmatLine>): PrintedHazmatLine => printedHazmatLineSchema.parse(over);

function paper(): ShippingDocument {
  const d = emptyShippingDocument();
  d.identity.bolNumber = "BOL-1001";
  d.identity.date = "10/01/2026";
  d.parties.shipper = { name: "Acme Chemical", address: "1 Plant Rd" };
  d.references.po = ["PO-7", "PO-8"];
  d.hazmat.lines = [
    line({ idText: "UN1203", psn: "Gasoline", hazardClass: "3", pg: "II", quantity: { value: 8000, unit: "GAL" } }),
    line({ idText: "UN1993", psn: "Flammable liquid, n.o.s.", hazardClass: "3", pg: "III", marks: ["LIMITED QUANTITY"] }),
  ];
  return d;
}

function labelsFor(doc: ShippingDocument, bands: Array<["bol" | "delivery_copy" | "placard", "good" | "fair" | "poor"]> = [["bol", "good"]]) {
  const sk = shippingDocumentLabelsSkeleton(bands.map((_, i) => `pages/${i + 1}.jpg`));
  return {
    ...sk,
    ...clone(doc),
    labelledBy: ["keyer-a", "keyer-b"],
    pages: sk.pages.map((p, i) => ({ ...p, class: bands[i]![0], band: bands[i]![1] })),
  };
}

/** A reader output that read `doc` with every leaf at `status`. */
function output(doc: ShippingDocument, status: FieldEvidence["status"] = "read", usd = 0.06) {
  const evidence = leafFieldPaths(doc).map((path) => ({ path, value: null, status, sources: [], ruleVersion: "r1" }));
  return { document: clone(doc), evidence, cost: { inputTokens: 5000, outputTokens: 2000, usd } };
}

const field = (s: { fields: FieldScore[] }, f: string) => s.fields.find((x) => x.field === f)!;

describe("valuesEqual — defined once, conservatively", () => {
  it("trims and collapses internal whitespace, and nothing else", () => {
    expect(valuesEqual("  Acme \n Chemical ", "Acme Chemical")).toBe(true);
    expect(valuesEqual("AcmeChemical", "Acme Chemical")).toBe(false);
  });
  it("is case-sensitive, because an identifier's case is printed data", () => {
    expect(valuesEqual("UN1203", "un1203")).toBe(false);
  });
  it("compares numbers exactly and string lists as multisets", () => {
    expect(valuesEqual(8000, 8000.0)).toBe(true);
    expect(valuesEqual(8000, 8000.5)).toBe(false);
    expect(valuesEqual(["PO-8", " PO-7"], ["PO-7", "PO-8"])).toBe(true);
    expect(valuesEqual(["X", "X"], ["X"])).toBe(false);
    expect(valuesEqual(["X", "Y"], ["X", "X"])).toBe(false);
    expect(valuesEqual(["X", "X"], ["X", "Y"])).toBe(false);
  });
  it("does not treat an empty string as a missing value", () => {
    expect(valuesEqual("", null)).toBe(false);
  });
});

describe("alignHazmatLines — by key, not index (F-EX6)", () => {
  it("keys on the id's digits, so the prefix and spacing do not decide which line is which", () => {
    expect(hazmatLineKey("UN 1203")).toBe("1203");
    expect(hazmatLineKey(null)).toBe("");
  });
  it("matches reordered lines to their labels and scores them all correct", () => {
    const label = paper();
    const read = clone(label);
    read.hazmat.lines.reverse();
    expect(alignHazmatLines(label.hazmat.lines, read.hazmat.lines).pairs).toEqual([{ label: 0, read: 1 }, { label: 1, read: 0 }]);
    const s = scoreCorpus([{ id: "d1", labels: labelsFor(label), output: output(read) }]);
    expect(field(s, "hazmat.lines[].psn")).toMatchObject({ fields: 2, correct: 2, falseAccepts: 0 });
    expect(s.lines).toEqual({ labelled: 2, matched: 2, missed: 0, extra: 0 });
  });
  it("breaks a tie between two lines of one id on the PSN", () => {
    const a = line({ idText: "UN1993", psn: "Diesel fuel" });
    const b = line({ idText: "UN1993", psn: "Fuel oil" });
    expect(alignHazmatLines([a, b], [b, a]).pairs).toEqual([{ label: 0, read: 1 }, { label: 1, read: 0 }]);
  });
  it("matches a line with no printed id only on an equal PSN", () => {
    const noId = line({ psn: "Batteries, wet" });
    expect(alignHazmatLines([noId], [line({ psn: "Batteries, wet" })]).pairs).toHaveLength(1);
    expect(alignHazmatLines([noId], [line({ psn: "Batteries" })]).missed).toEqual([0]);
  });
  it("counts an unmatched label line as missed and an unmatched read line as extra, whose read fields are false accepts", () => {
    const label = paper();
    const read = clone(label);
    read.hazmat.lines = [read.hazmat.lines[0]!, line({ idText: "UN1830", psn: "Sulfuric acid" })];
    const s = scoreCorpus([{ id: "d1", labels: labelsFor(label), output: output(read) }]);
    expect(s.lines).toEqual({ labelled: 2, matched: 1, missed: 1, extra: 1 });
    // UN1203 right; UN1993 missed (unread, wrong); UN1830 extra and `read` (a false accept).
    expect(field(s, "hazmat.lines[].psn")).toMatchObject({ fields: 3, correct: 1, read: 2, falseAccepts: 1 });
  });
});

describe("scoreCorpus — the four numbers", () => {
  it("moves exactly one field's accuracy when exactly one label changes", () => {
    const doc = paper();
    const base = scoreCorpus([{ id: "d1", labels: labelsFor(doc), output: output(doc) }]);
    for (const [mutate, moved] of [
      [(d: ShippingDocument) => { d.identity.bolNumber = "BOL-1002"; }, "identity.bolNumber"],
      [(d: ShippingDocument) => { d.hazmat.lines[1]!.quantity.value = 55; }, "hazmat.lines[].quantity.value"],
      [(d: ShippingDocument) => { d.references.po = ["PO-7"]; }, "references.po"],
    ] as const) {
      const altered = clone(doc);
      mutate(altered);
      const s = scoreCorpus([{ id: "d1", labels: labelsFor(altered), output: output(doc) }]);
      const changed = s.fields.filter((f) => f.accuracy !== field(base, f.field).accuracy).map((f) => f.field);
      expect(changed).toEqual([moved]);
    }
  });

  it("counts a wrong value as a false accept only when its status is `read`", () => {
    const label = paper();
    const read = clone(label);
    read.identity.bolNumber = "BOL-1O01";
    const asRead = scoreCorpus([{ id: "d1", labels: labelsFor(label), output: output(read, "read") }]);
    const asCheck = scoreCorpus([{ id: "d1", labels: labelsFor(label), output: output(read, "check") }]);
    expect(field(asRead, "identity.bolNumber")).toMatchObject({ correct: 0, read: 1, falseAccepts: 1, falseAcceptRate: 1 });
    expect(field(asCheck, "identity.bolNumber")).toMatchObject({ correct: 0, read: 0, falseAccepts: 0, falseAcceptRate: null, yield: 0 });
  });

  it("scores a field the reader gave no evidence for as not read", () => {
    const doc = paper();
    const out = output(doc);
    out.evidence = out.evidence.filter((e) => e.path !== "identity.date");
    const s = scoreCorpus([{ id: "d1", labels: labelsFor(doc), output: out }]);
    expect(field(s, "identity.date")).toMatchObject({ correct: 1, read: 0, yield: 0 });
  });

  it("skips unlabelled documents and reports invalid labels and outputs by id, without crashing", () => {
    const doc = paper();
    const unlabelled = { ...labelsFor(doc), labelledBy: [] };
    const entries: CorpusEntry[] = [
      { id: "ok", labels: labelsFor(doc), output: output(doc) },
      { id: "blank", labels: unlabelled, output: output(doc) },
      { id: "bad-label", labels: { pages: "nope" }, output: output(doc) },
      { id: "no-run", labels: labelsFor(doc), output: undefined },
      { id: "bad-run", labels: labelsFor(doc), output: { document: {}, evidence: "x" } },
    ];
    expect(scoreCorpus(entries).documents).toEqual({
      total: 5, scored: 1, skippedUnlabelled: 1, invalidLabels: ["bad-label"], missingOutputs: ["no-run"], invalidOutputs: ["bad-run"],
    });
  });

  it("splits by band — a document's band is its worst BOL or delivery-copy page — with cost per page", () => {
    const doc = paper();
    const wrong = clone(doc);
    wrong.identity.bolNumber = "BOL-9999";
    const s = scoreCorpus([
      { id: "clean", labels: labelsFor(doc, [["bol", "good"], ["placard", "poor"]]), output: output(doc, "read", 0.1) },
      { id: "night", labels: labelsFor(doc, [["bol", "good"], ["delivery_copy", "poor"]]), output: output(wrong, "read", 0.3) },
    ]);
    const band = (b: string) => s.bands.find((x) => x.band === b)!;
    expect(s.bands.map((b) => b.band)).toEqual(["good", "poor", "all"]);
    expect(band("good")).toMatchObject({ documents: 1, falseAccepts: 0, pages: 2, costPerPage: 0.05 });
    expect(band("poor")).toMatchObject({ documents: 1, falseAccepts: 1, pages: 2 });
    expect(band("poor").costPerPage).toBeCloseTo(0.15);
    expect(band("all")).toMatchObject({ documents: 2, falseAccepts: 1, pages: 4 });
  });

  it("puts a document with no banded BOL page in `unbanded`", () => {
    expect(documentBand(labelsFor(paper(), [["placard", "poor"]]))).toBe("unbanded");
  });

  it("scores a null party and a filled party as the same field rows", () => {
    const filled = paper();
    const blank = paper();
    blank.parties.shipper = null;
    const s = scoreCorpus([
      { id: "a", labels: labelsFor(filled), output: output(filled) },
      { id: "b", labels: labelsFor(blank), output: output(blank) },
    ]);
    expect(s.fields.map((f) => f.field)).not.toContain("parties.shipper");
    expect(field(s, "parties.shipper.name")).toMatchObject({ documents: 2, fields: 2, correct: 2, labelPresent: 1 });
  });

  it("states D-DR5's bar: rule of three over correct reads, engine inputs at 600, others at 300", () => {
    const doc = paper();
    const entries = Array.from({ length: 3 }, (_, i) => ({ id: `d${i}`, labels: labelsFor(doc), output: output(doc) }));
    const s = scoreCorpus(entries);
    expect(field(s, "hazmat.lines[].psn").graduation).toEqual({ correctReads: 6, upperBound95: 0.5, required: 600, ceiling: 0.005, graduates: false });
    expect(field(s, "identity.bolNumber")).toMatchObject({ criticality: "standard", graduation: { required: 300, ceiling: 0.01 } });
    const bad = clone(doc);
    bad.identity.bolNumber = "X";
    const withError = scoreCorpus([...entries, { id: "e", labels: labelsFor(doc), output: output(bad) }]);
    expect(field(withError, "identity.bolNumber").graduation.upperBound95).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DOCUMENT_PROFILES, mergeSections, sectionSchema, sectionsOwning, type DocumentProfile } from "./documentReadingContract.js";
import { leafFieldPaths } from "./fieldEvidenceContract.js";
import { shippingDocumentSchema, type ShippingDocument } from "./shippingDocumentContract.js";

/** Q-DR11 (ruled 2026-10-09): the shipping document is read in sections and merged. */
const P = DOCUMENT_PROFILES.shipping_document;
const names = P.sections.map((s) => s.name);

/** Every object present and every list holding one entry, so every leaf the profile has is a path here. */
function fullDocument(): ShippingDocument {
  const party = { name: "A", address: "B" };
  return shippingDocumentSchema.parse({
    identity: { bolNumber: "1", date: "d", pageOf: { page: 1, of: 1 }, printedPageNumbers: ["Page 1 of 1"] },
    parties: { shipper: party, consignee: party, billTo: party },
    references: { po: ["p"], customer: ["c"], consignee: ["r"] },
    freight: { pieces: 1, pallets: 1, weight: 1, weightUnit: "lb", seals: ["s"], trailer: "t" },
    hazmat: {
      lines: [{ idText: "UN1203", descriptionText: "UN1203, Gasoline, 3, PG II", quantity: { value: 1, unit: "gal" }, marks: ["HOT"] }],
      emergencyPhone: "800", shipperCertification: true, offeror: "o", emergencyContactText: "CHEMTREC",
    },
    otherLines: ["Paper products"],
    execution: { receiverSignaturePresent: true, receiverName: "n", deliveredAt: "d", osdNotations: ["x"] },
  });
}
const partsOf = (doc: unknown) => Object.fromEntries(names.map((n) => [n, sectionSchema(P, n).parse(doc)]));

describe("profile sections — a partition of the profile's leaves", () => {
  it("assigns every leaf of the profile to exactly one section", () => {
    const leaves = [...leafFieldPaths(fullDocument()), ...leafFieldPaths(P.empty())];
    expect(leaves.length).toBeGreaterThan(40);
    const unowned = leaves.filter((p) => sectionsOwning(P, p).length !== 1);
    expect(unowned).toEqual([]);
  });

  it("splits hazmat between the load section (header items) and the lines section", () => {
    expect(sectionsOwning(P, "hazmat.lines[3].psn")).toEqual(["lines"]);
    expect(sectionsOwning(P, "otherLines")).toEqual(["lines"]);
    expect(sectionsOwning(P, "hazmat.emergencyContactText")).toEqual(["load"]);
    expect(sectionsOwning(P, "identity.printedPageNumbers")).toEqual(["identity"]);
  });

  it("derives each section schema from the profile: its empty answer is the profile's, sliced", () => {
    const empty = P.empty() as ShippingDocument;
    expect(sectionSchema(P, "lines").parse({})).toEqual({ hazmat: { lines: [] }, otherLines: [] });
    expect(sectionSchema(P, "load").parse({}).hazmat).toEqual({
      emergencyPhone: null, shipperCertification: null, offeror: null, emergencyContactText: null,
    });
    expect(sectionSchema(P, "identity").parse({})).toEqual({ identity: empty.identity, parties: empty.parties });
    // The very field schema, not a copy: the profile's line schema is the one the lines section holds.
    const lines = sectionSchema(P, "lines").shape.hazmat as z.ZodDefault<z.ZodObject>;
    expect(lines.unwrap().shape.lines).toBe(P.schema.shape.hazmat.unwrap().shape.lines);
  });

  it("refuses an unknown section, a group that is not a field, and overlapping groups", () => {
    expect(() => sectionSchema(P, "nope")).toThrow(/no section nope/);
    const bad = (groups: string[]): DocumentProfile => ({ ...P, sections: [{ name: "x", groups }] });
    expect(() => sectionSchema(bad(["hazmat.nope"]), "x")).toThrow(/hazmat\.nope is not a field/);
    expect(() => sectionSchema(bad(["hazmat", "hazmat.lines"]), "x")).toThrow(/overlaps/);
    expect(() => sectionSchema(bad(["hazmat.lines", "hazmat"]), "x")).toThrow(/overlaps/);
    expect(() => sectionSchema(bad(["identity.bolNumber.x"]), "x")).toThrow(/not an object/);
  });
});

describe("mergeSections — the section answers back into one document", () => {
  it("round-trips a full document through its section slices", () => {
    const doc = fullDocument();
    expect(mergeSections(P, partsOf(doc))).toEqual(doc);
  });

  it("merges the two halves of hazmat into one object", () => {
    const doc = fullDocument();
    const merged = mergeSections(P, partsOf(doc)) as ShippingDocument;
    expect(merged.hazmat.lines).toEqual(doc.hazmat.lines);
    expect(merged.hazmat.emergencyContactText).toBe("CHEMTREC");
  });

  it("refuses a missing section and an unknown one", () => {
    const parts = partsOf(fullDocument());
    const { lines: _lines, ...missing } = parts;
    expect(() => mergeSections(P, missing)).toThrow(/section lines is missing/);
    expect(() => mergeSections(P, { ...parts, extra: {} })).toThrow(/unknown section extra/);
  });

  it("refuses a part that writes a field another section owns", () => {
    const parts = partsOf(fullDocument());
    const load = parts.load as { hazmat: Record<string, unknown> };
    expect(() => mergeSections(P, { ...parts, load: { ...load, hazmat: { ...load.hazmat, lines: [] } } })).toThrow(
      /section load writes hazmat\.lines, which it does not own/,
    );
    expect(() => mergeSections(P, { ...parts, identity: { ...(parts.identity as object), otherLines: ["x"] } })).toThrow(
      /does not own/,
    );
  });

  it("refuses two parts writing the same key even where ownership cannot see it", () => {
    // Two sections claiming one group is a broken profile; the merge must still refuse, not pick one.
    const twice: DocumentProfile = { ...P, sections: [{ name: "a", groups: ["otherLines"] }, { name: "b", groups: ["otherLines"] }] };
    expect(() => mergeSections(twice, { a: { otherLines: ["x"] }, b: { otherLines: ["y"] } })).toThrow(/overlap at otherLines/);
  });

  it("leaves the parts it was given untouched — merging hazmat's halves writes into neither part", () => {
    const parts = partsOf(fullDocument());
    const before = JSON.stringify(parts);
    const merged = mergeSections(P, parts) as ShippingDocument;
    expect(JSON.stringify(parts)).toBe(before);
    merged.otherLines.push("mutated");
    expect((parts.lines as ShippingDocument).otherLines).toEqual(["Paper products"]);
  });
});

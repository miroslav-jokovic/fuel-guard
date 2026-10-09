import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DOCUMENT_PROFILES,
  INTAKE_LIMITS,
  INTAKE_REFUSALS,
  createSourceRequestSchema,
  reviewBatchRequestSchema,
  shippingDocumentLabelsSchema,
  shippingDocumentLabelsSkeleton,
} from "./documentReadingContract.js";
import { formatFieldPath, leafFieldPaths, parseFieldPath, valueAtPath } from "./fieldEvidenceContract.js";
import {
  GRADUATION_MIN_CONFIRMATIONS,
  emptyShippingDocument,
  shippingDocumentSchema,
  shippingFieldCriticality,
} from "./shippingDocumentContract.js";

/** DOCUMENT-READER-PLAN.md Step 1.1 — the reader's three contracts. */
describe("ShippingDocument", () => {
  it("parses {} to the empty document: every scalar null, every list empty", () => {
    const d = emptyShippingDocument();
    expect(d.identity).toEqual({ bolNumber: null, date: null, pageOf: null });
    expect(d.hazmat).toEqual({ lines: [], emergencyPhone: null, shipperCertification: null, offeror: null });
    expect(d.freight.seals).toEqual([]);
  });

  it("gives a printed line the hazmat extractor's defaults, so BolFields is a projection of it", () => {
    const d = shippingDocumentSchema.parse({ hazmat: { lines: [{ idText: "UN1203" }] } });
    expect(d.hazmat.lines[0]).toMatchObject({ idText: "UN1203", pg: null, quantity: { value: null, unit: null }, marks: [] });
  });

  it("generates a structured-output JSON schema in which every property is required (D-DR8)", () => {
    // The model must answer every key (null when not printed); an optional key is one it may silently skip.
    const js = z.toJSONSchema(shippingDocumentSchema, { io: "output" }) as Record<string, unknown>;
    const unrequired: string[] = [];
    const walk = (node: unknown, at: string) => {
      if (node == null || typeof node !== "object") return;
      const n = node as { properties?: Record<string, unknown>; required?: string[] };
      if (n.properties) {
        for (const k of Object.keys(n.properties)) if (!n.required?.includes(k)) unrequired.push(`${at}.${k}`);
      }
      for (const [k, v] of Object.entries(n)) walk(v, `${at}.${k}`);
    };
    walk(js, "$");
    expect(unrequired).toEqual([]);
  });
});

describe("field criticality (D-DR5)", () => {
  it("puts the placard engine's inputs at the 600 bar and everything else at 300", () => {
    expect(shippingFieldCriticality("hazmat.lines[0].idText")).toBe("engine");
    expect(shippingFieldCriticality("hazmat.lines[12].quantity.value")).toBe("engine");
    expect(shippingFieldCriticality("hazmat.lines[1].marks")).toBe("engine");
    expect(shippingFieldCriticality("hazmat.lines[0].technicalName")).toBe("standard");
    expect(shippingFieldCriticality("hazmat.emergencyPhone")).toBe("standard");
    expect(shippingFieldCriticality("identity.bolNumber")).toBe("standard");
    expect(GRADUATION_MIN_CONFIRMATIONS).toEqual({ engine: 600, standard: 300 });
  });
});

describe("field paths", () => {
  it("round-trips dotted keys and indexes, and refuses anything else", () => {
    expect(parseFieldPath("hazmat.lines[2].quantity.value")).toEqual(["hazmat", "lines", 2, "quantity", "value"]);
    expect(formatFieldPath(["hazmat", "lines", 2, "quantity", "value"])).toBe("hazmat.lines[2].quantity.value");
    for (const bad of ["", "hazmat..lines", "lines[x]", "Hazmat.lines", "a.b[1"]) expect(() => parseFieldPath(bad)).toThrow();
  });

  it("tells a printed-nothing null from a field the document does not have", () => {
    const d = shippingDocumentSchema.parse({ hazmat: { lines: [{ idText: "UN1203" }] } });
    expect(valueAtPath(d, "hazmat.lines[0].idText")).toBe("UN1203");
    expect(valueAtPath(d, "hazmat.lines[0].psn")).toBeNull();
    expect(valueAtPath(d, "hazmat.lines[1].psn")).toBeUndefined();
    expect(valueAtPath(d, "hazmat.lines.psn")).toBeUndefined();
  });

  it("lists every leaf, treating a list of strings as one field and walking a list of lines", () => {
    const d = shippingDocumentSchema.parse({ hazmat: { lines: [{ idText: "UN1203", marks: ["HOT"] }] } });
    const paths = leafFieldPaths(d);
    expect(paths).toContain("hazmat.lines[0].idText");
    expect(paths).toContain("hazmat.lines[0].quantity.unit");
    expect(paths).toContain("hazmat.lines[0].marks");
    expect(paths).toContain("references.po");
    expect(paths).not.toContain("hazmat.lines[0].marks[0]");
    for (const p of paths) expect(valueAtPath(d, p)).not.toBeUndefined();
  });
});

describe("corpus labels (Step 0.3)", () => {
  it("writes a skeleton the labels schema accepts, with no value pre-filled", () => {
    const s = shippingDocumentLabelsSkeleton(["pages/1.jpg"]);
    expect(shippingDocumentLabelsSchema.parse(s)).toEqual(s);
    expect(s.pages).toEqual([{ file: "pages/1.jpg", class: null, band: null, assignedBy: null }]);
    const { labelledBy, pages, notes, ...doc } = s;
    expect([labelledBy, pages.length, notes]).toEqual([[], 1, ""]);
    expect(doc).toEqual(emptyShippingDocument());
  });

  it("refuses a page class outside the closed set", () => {
    const s = shippingDocumentLabelsSkeleton(["pages/1.jpg"]);
    expect(() => shippingDocumentLabelsSchema.parse({ ...s, pages: [{ file: "pages/1.jpg", class: "invoice" }] })).toThrow();
  });
});

describe("routes and refusals", () => {
  it("says the limit it refuses on, read from the one definition", () => {
    expect(INTAKE_REFUSALS.too_small).toContain(String(INTAKE_LIMITS.minLongEdgePx));
    expect(INTAKE_REFUSALS.too_large).toContain(`${INTAKE_LIMITS.maxBytes / 1024 / 1024} MB`);
    expect(INTAKE_REFUSALS.too_many_pages).toContain(String(INTAKE_LIMITS.maxPdfPages));
  });

  it("refuses an upload over the size limit or with a malformed hash", () => {
    const ok = { fileName: "bol.pdf", mime: "application/pdf", byteSize: 1000, sha256: "a".repeat(64) };
    expect(createSourceRequestSchema.safeParse(ok).success).toBe(true);
    expect(createSourceRequestSchema.safeParse({ ...ok, byteSize: INTAKE_LIMITS.maxBytes + 1 }).success).toBe(false);
    expect(createSourceRequestSchema.safeParse({ ...ok, sha256: "A".repeat(64) }).success).toBe(false);
    expect(createSourceRequestSchema.safeParse({ ...ok, mime: "image/gif" }).success).toBe(false);
  });

  it("accepts a review batch only on field paths", () => {
    const entry = { path: "hazmat.lines[0].pg", action: "corrected", oldValue: "II", newValue: "III" };
    expect(reviewBatchRequestSchema.safeParse({ consumer: "hazmat_calculator", reviews: [entry] }).success).toBe(true);
    expect(reviewBatchRequestSchema.safeParse({ consumer: "hazmat_calculator", reviews: [{ ...entry, path: "pg!" }] }).success).toBe(false);
    expect(reviewBatchRequestSchema.safeParse({ consumer: "hazmat_calculator", reviews: [] }).success).toBe(false);
  });

  it("registers shipping_document reading only BOL and delivery-copy pages (D-DR11)", () => {
    expect(DOCUMENT_PROFILES.shipping_document.readsPageClasses).toEqual(["bol", "delivery_copy"]);
    expect(DOCUMENT_PROFILES.shipping_document.empty()).toEqual(emptyShippingDocument());
  });
});

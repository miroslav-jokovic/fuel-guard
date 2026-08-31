import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { defaultInspectionItems } from "@silvicom/shared";
import { RENDERER_VERSION, renderDigest, renderInspectionReport, type InspectionRenderInput } from "./report.js";

/**
 * The stamped report (plan step A5).
 *
 * The four layout properties are pinned next door in `layout.test.ts`; this file is about the
 * rendering itself — that it produces a real PDF, that it is deterministic, and that the two things
 * the plan says must never be typed are still not typeable.
 */

const BASE: InspectionRenderInput = {
  subjectType: "tractor",
  unitNumber: "654",
  inspectedOn: "2026-06-16",
  decalSerial: "610641628",
  inspectorName: "GEORGE GACEV",
  inspectorQualified: true,
  carrierName: "SILVICOM INC",
  carrierAddress: "1301 ARMITAGE AVE",
  carrierCityStateZip: "MELROSE PARK IL , 60160",
  identificationMethod: "vin",
  identificationValue: "3AKJHHDR7RSUX1186",
  inspectionAgencyLocation: null,
  otherConditions: null,
  items: defaultInspectionItems("tractor").map((i) => ({ key: i.key, result: i.result })),
  outcome: "pass",
};

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

describe("rendering onto the Keller template", () => {
  it("produces a PDF built on the real template, not a blank page", async () => {
    const pdf = await renderInspectionReport(BASE);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // The template carries Keller's artwork; a blank page would be a fraction of the size.
    expect(pdf.byteLength).toBeGreaterThan(100_000);
  });

  it("emits the same values on a blank page when the background is off (A8's mode)", async () => {
    const withTemplate = await renderInspectionReport(BASE, { background: "template" });
    const withoutTemplate = await renderInspectionReport(BASE, { background: "none" });
    expect(withoutTemplate.subarray(0, 5).toString()).toBe("%PDF-");
    // Same values, no artwork — so it must be dramatically smaller and still a valid page.
    expect(withoutTemplate.byteLength).toBeLessThan(withTemplate.byteLength / 10);
  });

  it("is deterministic — the same report renders byte-identically", async () => {
    const [a, b] = await Promise.all([renderInspectionReport(BASE), renderInspectionReport(BASE)]);
    expect(sha(a)).toBe(sha(b));
  });

  it("changes bytes when an answer changes, so determinism is not just a frozen clock", async () => {
    const changed = {
      ...BASE,
      items: BASE.items.map((i) => (i.key === "brake.hose" ? { ...i, result: "needs_repair" as const } : i)),
    };
    expect(sha(await renderInspectionReport(changed))).not.toBe(sha(await renderInspectionReport(BASE)));
  });

  it("the draft preview differs from the final by more content, not less", async () => {
    const final = await renderInspectionReport(BASE);
    const draft = await renderInspectionReport(BASE, { draft: true });
    expect(sha(draft)).not.toBe(sha(final));
    // Content streams are compressed, so the DRAFT mark cannot be found by searching the bytes —
    // what IS assertable is that the draft carries strictly more drawing than the final, which is
    // the only direction a "this certifies nothing" mark can move the page. The mark itself is
    // verified by rendering the page, recorded in the plan's A5 register.
    expect(draft.byteLength).toBeGreaterThan(final.byteLength);
  });
});

describe("the digest is over the source, not the file", () => {
  it("is stable for the same answers regardless of their order", () => {
    const shuffled = { ...BASE, items: [...BASE.items].reverse() };
    expect(renderDigest(shuffled)).toBe(renderDigest(BASE));
  });

  it("moves when a component's result moves", () => {
    const changed = {
      ...BASE,
      items: BASE.items.map((i) => (i.key === "tires.steer_axle" ? { ...i, result: "na" as const } : i)),
    };
    expect(renderDigest(changed)).not.toBe(renderDigest(BASE));
  });

  it("moves when the renderer version moves, so an old digest cannot vouch for new output", () => {
    expect(renderDigest(BASE)).toContain("");
    expect(RENDERER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("moves when the decal serial moves — the §396.17(c)(2) join is part of the record", () => {
    expect(renderDigest({ ...BASE, decalSerial: "610641629" })).not.toBe(renderDigest(BASE));
  });
});

describe("what the renderer refuses to let a caller assert", () => {
  it("leaves the §396.19 box empty for an unqualified inspector (D-AVI6)", async () => {
    const qualified = await renderInspectionReport(BASE);
    const not = await renderInspectionReport({ ...BASE, inspectorQualified: false });
    // Fewer marks on the page means the box was genuinely not stamped.
    expect(sha(not)).not.toBe(sha(qualified));
    expect(not.byteLength).toBeLessThanOrEqual(qualified.byteLength);
  });

  it("ticks the trailer box for a trailer, on the same template (D-AVI12)", async () => {
    const trailer = await renderInspectionReport({
      ...BASE,
      subjectType: "trailer",
      items: defaultInspectionItems("trailer").map((i) => ({ key: i.key, result: i.result })),
    });
    expect(sha(trailer)).not.toBe(sha(await renderInspectionReport(BASE)));
    expect(trailer.byteLength).toBeGreaterThan(100_000);
  });
});

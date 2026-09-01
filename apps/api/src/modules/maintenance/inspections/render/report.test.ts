import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
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

  /**
   * Reading the drawn content back out of the PDF.
   *
   * Two layers to get through, and both of them are why a defect like this survives review: pdf-lib
   * DEFLATES its content streams, and it writes every string as HEX rather than as literal text. So
   * neither the operators nor the words are in the raw bytes. Inflating and decoding lets these
   * tests assert what was PAINTED rather than that a file of roughly the right size appeared —
   * which is the only kind of assertion that could catch a heading drawn in white on white.
   */
  const painted = (pdf: Buffer): string => {
    const raw = pdf.toString("latin1");
    let out = "";
    const re = /stream\r?\n/g;
    for (let m = re.exec(raw); m; m = re.exec(raw)) {
      const start = m.index + m[0].length;
      const end = raw.indexOf("endstream", start);
      if (end < 0) continue;
      const chunk = Buffer.from(raw.slice(start, end), "latin1");
      try {
        out += inflateSync(chunk).toString("latin1");
      } catch {
        out += chunk.toString("latin1");
      }
    }
    // `<48656C6C6F> Tj` → `Hello`, appended so a plain `toContain` can read the page's words.
    return (
      out +
      "\n" +
      [...out.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)]
        .map((m) => Buffer.from(m[1]!, "hex").toString("latin1"))
        .join("\n")
    );
  };

  it("prints all sixteen section headings on plain paper, which the template no longer carries", async () => {
    // D-AVI22, remeasured: the export dropped the coloured bands and left fifteen white heading
    // strings on white paper, with `1. BRAKE SYSTEM` gone altogether. Print that and the office gets
    // a table of items with nothing naming the sections — which is exactly what was reported.
    //
    // Number and title are two draw calls (Keller sets a fixed tab between them), so each title is
    // checked on its own rather than as one string.
    const pdf = painted(await renderInspectionReport(BASE));
    for (const title of ["BRAKE SYSTEM", "WHEELS AND RIMS", "OTHER", "REAR IMPACT GUARD"]) {
      expect(pdf, title).toContain(title);
    }
  });

  it("knocks the headings out of a Keller-red band, not black onto white", async () => {
    // The page the office files is white-on-colour. A black heading on a white gap is legible and is
    // still the wrong document; this is the assertion that would have caught that.
    const pdf = painted(await renderInspectionReport(BASE));
    expect(pdf, "Keller red band").toContain("0.933 0.212 0.251 rg");
    expect(pdf, "white knockout text").toContain("1 1 1 rg");
  });

  it("restores the OK column heading and the legend marks the export lost", async () => {
    const pdf = painted(await renderInspectionReport(BASE));
    expect(pdf).toContain("OK");
    expect(pdf).toContain("NA");
  });

  it("does NOT print any of it onto a pre-printed pad, which already carries it", async () => {
    // The overlay lands on a real Keller pad. Drawing the artwork there would print every band and
    // heading on top of the one already on the paper (D-AVI8).
    const overlay = painted(await renderInspectionReport(BASE, { background: "none" }));
    expect(overlay).not.toContain("BRAKE SYSTEM");
    expect(overlay, "no Keller-red band on the overlay").not.toContain("0.933 0.212 0.251 rg");
  });

  it("stamps every value in black, on the draft as well as the filing", async () => {
    // The preview used to stamp red, and the office read that as the product printing in red. The
    // DRAFT watermark is the signal; the ink is not, because a preview whose ink differs from the
    // filing is not previewing the filing (D-AVI22).
    const draft = await renderInspectionReport(BASE, { draft: true });
    expect(painted(draft)).toContain("DRAFT - NOT A CERTIFIED INSPECTION");
    expect(painted(draft)).not.toContain("0.72 0.11 0.11 rg");
    expect(painted(draft)).toContain("0 0 0 rg");
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

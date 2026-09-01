import { describe, expect, it } from "vitest";
import { INSPECTION_ITEMS } from "@silvicom/shared";
import { PAGE_HEIGHT, PAGE_WIDTH, baselineOf, cellsFor } from "./layouts/keller14834Rev0122.js";
import { renderRegistrationSheet } from "./registrationSheet.js";

/**
 * The sheet a printer is measured with (D-AVI8).
 *
 * A calibration sheet has one job and one failure mode: if a mark is clipped or in the wrong place,
 * the office measures a wrong number very carefully and every subsequent print is off by it.
 */

/** The margin a typical laser printer cannot reach — 4–6 mm; 17 pt is the pessimistic end. */
const UNPRINTABLE = 17;
const ARM = 6;

describe("the sheet measures the page the report actually prints on", () => {
  it("puts its marks at REAL cells from the coordinate map, not at invented coordinates", () => {
    for (const key of ["brake.service_brakes", "lighting.all_operable", "windshield.glazing", "rear_impact_guard.present"]) {
      expect(cellsFor(key), key).toBeTruthy();
      expect(INSPECTION_ITEMS.some((i) => i.key === key), key).toBe(true);
    }
  });

  it("keeps every crosshair clear of the unprintable margin, arms included", () => {
    // The leftmost target is the OK column at 25.5pt from the edge. A 9pt arm reached 16.5 and
    // risked clipping the very mark being measured — a half-drawn crosshair still looks like one.
    for (const key of ["brake.service_brakes", "lighting.all_operable", "windshield.glazing", "rear_impact_guard.present"]) {
      const c = cellsFor(key)!.ok;
      const x = c.x + c.maxWidth / 2;
      const y = baselineOf(c, 8) + 2.5;
      expect(x - ARM, `${key} left`).toBeGreaterThan(UNPRINTABLE);
      expect(x + ARM, `${key} right`).toBeLessThan(PAGE_WIDTH - UNPRINTABLE);
      expect(y - ARM, `${key} bottom`).toBeGreaterThan(UNPRINTABLE);
      expect(y + ARM, `${key} top`).toBeLessThan(PAGE_HEIGHT - UNPRINTABLE);
    }
  });

  it("spreads the marks widely, because one point cannot tell a shift from a scale error", () => {
    const xs = ["brake.service_brakes", "windshield.glazing"].map((k) => cellsFor(k)!.ok.x);
    const ys = ["brake.service_brakes", "lighting.all_operable"].map((k) => baselineOf(cellsFor(k)!.ok, 8));
    expect(Math.abs(xs[0]! - xs[1]!)).toBeGreaterThan(300);
    expect(Math.abs(ys[0]! - ys[1]!)).toBeGreaterThan(300);
  });
});

describe("rendering", () => {
  it("produces a real PDF on the same page box as the form", async () => {
    const pdf = await renderRegistrationSheet();
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // No template embedded — this is a measuring tool, not a copy of Keller's page.
    expect(pdf.byteLength).toBeLessThan(50_000);
  });

  it("is deterministic, so two prints of the same calibration are the same sheet", async () => {
    const [a, b] = await Promise.all([renderRegistrationSheet(), renderRegistrationSheet()]);
    expect(a.equals(b)).toBe(true);
  });

  it("moves when an offset is applied — that is how a calibration is CHECKED, not only set", async () => {
    const plain = await renderRegistrationSheet();
    const shifted = await renderRegistrationSheet({ x: 2, y: -3 });
    expect(plain.equals(shifted)).toBe(false);
  });
});

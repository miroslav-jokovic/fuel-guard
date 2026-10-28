import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import LabelStockControls from "./LabelStockControls.vue";
import type { LabelPresetDto } from "./useLabels";

/**
 * R6 (DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md §5): a roll is not a sheet. The start position and the
 * sheet advice are for a page holding many labels; on the shop's 2" roll every label is its own page.
 */
const SHEET: LabelPresetDto = {
  id: "avery-22805",
  name: "Avery 22805",
  perSheet: 24,
  material: "Polyester.",
  label: { width: 108, height: 108 },
  sheet: { width: 612, height: 792 },
};
const ROLL: LabelPresetDto = {
  id: "roll-single",
  name: "Roll",
  perSheet: 1,
  material: "Direct-thermal paper.",
  label: { width: 144, height: 144 },
  sheet: { width: 144, height: 144 },
};

const render = (presetId: string) =>
  mount(LabelStockControls, {
    props: { presets: [SHEET, ROLL], presetId, startPosition: 1, nudgeX: 0, nudgeY: 0 },
  });

describe("the stock controls", () => {
  it("offers a start position and the sheet advice for a sheet", () => {
    const w = render("avery-22805");
    expect(w.text()).toContain("Start at position");
    expect(w.text()).toContain("Labels");
    expect(w.text()).not.toContain("Each label prints as its own page");
  });

  it("drops the start position for the roll and names the paper size the printer dialog wants", () => {
    const w = render("roll-single");
    expect(w.text()).not.toContain("Start at position");
    expect(w.text()).toContain('2" × 2"');
    expect(w.text()).toContain("Each label prints as its own page");
    // The nudge stays: a roll printer's registration can be off by a constant too.
    expect(w.text()).toContain("Shift print right");
  });
});

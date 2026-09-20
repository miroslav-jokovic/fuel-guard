import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AppIconChip from "./AppIconChip.vue";
import AppIcon from "./AppIcon.vue";
import { TruckIcon } from "../icons";
// Vite's `?raw`, which works for a `.vue` file. (It does NOT for a `.css` one: measured
// 2026-09-20 under vitest 4.1.9, `tokens.generated.css?raw` resolves, throws nothing and yields a
// string of LENGTH 0 — so the sheet-level rules about these tokens live in `lint:ui-contrast`,
// which reads the file from node, rather than here where their failure could be silent.)
import badgeSource from "./AppBadge.vue?raw";

/**
 * `AppIconChip` (D-DT17, `docs/plans/design-system/DASHBOARD-TEMPLATE-V2.md` §4.2b).
 *
 * ⚠ These expectations CHANGED on 2026-09-20, exactly as the version before them said they would.
 * What they used to pin was that closing the vocabulary changed nothing on screen — every tone
 * resolving to the pale `text-<hue>-600 bg-<hue>-50` pair its 22 call sites had hand-written. The
 * restyle that refactor existed to unblock has now landed, so the same eight assertions go red and
 * are re-aimed at the treatment that replaced it: one hue's ramp, two stops, a white glyph.
 *
 * What this file pins is what the COMPONENT does: which tone reaches for which tone's tokens, that
 * the glyph is thickened for a white-on-colour stroke, that the default is the calm tone. Whether
 * those tokens exist, stay on one hue's ramp in both schemes, and hold the glyph above 3:1 is a
 * question about the SHEET, and `lint:ui-contrast` asks it there — a test that read the sheet from
 * here would be asking a gate's question in a browser package that deliberately has no `node`
 * types.
 */
const TONES = ["danger", "caution", "warning", "success", "info", "brand", "neutral"] as const;

const mountChip = (props: Record<string, unknown> = {}) =>
  mount(AppIconChip, { props: { icon: TruckIcon, ...props } });

describe("AppIconChip tone vocabulary", () => {
  it.each(TONES)("draws tone=%s as a gradient down that tone's own ramp", (tone) => {
    const cls = mountChip({ tone }).get("span").classes();
    expect(cls).toContain("bg-linear-140");
    expect(cls).toContain(`from-chip-${tone}-from`);
    expect(cls).toContain(`to-chip-${tone}-to`);
    expect(cls).toContain(`shadow-chip-${tone}`);
  });

  /** The white stroke needs the weight back that a saturated ground takes off it (§4.2b). */
  it("thickens the glyph's stroke for a white-on-colour glyph", () => {
    expect(mountChip().findComponent(AppIcon).props("strokeWidth")).toBe(2.2);
  });

  /**
   * ⚠ Not cosmetic. `neutral` is the ZERO-VALUE tone — `KpiHeroWidget` reaches for it when the
   * alert count is 0 and `MaintenanceHomePage` when nothing is short. Defaulting to a hue would
   * paint a calm figure in a colour that means something.
   */
  it("defaults to neutral rather than to a hue", () => {
    expect(mountChip().get("span").classes()).toContain("from-chip-neutral-from");
  });

  /**
   * The chip is scenery beside a figure that is already labelled. Announcing the glyph would read
   * the metric's name twice to a screen reader.
   */
  it("is hidden from the accessibility tree", () => {
    expect(mountChip().get("span").attributes("aria-hidden")).toBe("true");
  });

  describe("sizes", () => {
    /** Both taken from StatCard's two incumbent anatomies — hero led with size-10/size-6. */
    it("renders the hero box at 40px with a 24px glyph", () => {
      const w = mountChip({ size: "md" });
      expect(w.get("span").classes()).toContain("size-10");
      expect(w.findComponent(AppIcon).classes()).toContain("size-6");
    });

    it("renders the dense box at 36px with a 20px glyph", () => {
      const w = mountChip({ size: "sm" });
      expect(w.get("span").classes()).toContain("size-9");
      expect(w.findComponent(AppIcon).classes()).toContain("size-5");
    });

    /** One radius role at both sizes, so the chip tracks the shape scale instead of freezing. */
    it("uses the same shape role at both sizes", () => {
      for (const size of ["md", "sm"] as const) {
        expect(mountChip({ size }).get("span").classes()).toContain("rounded-surface");
      }
    });
  });

  /**
   * ⚠ The chip and the badge must name the same seven ideas with the same seven words. A reader who
   * knows what `tone="caution"` means on a badge cannot be asked to learn a second answer for a
   * chip, and a page showing a caution badge beside a caution chip is naming one idea once.
   *
   * This asserts the NAMES agree, not the values — they deliberately differ (600/50 here against
   * the badge's 700/50, because a badge carries 12px text and a chip carries a 20px glyph).
   */
  it("shares its tone names with AppBadge, exactly", () => {
    // ⚠ Read from AppBadge's SOURCE, not from a list retyped here. A test that compares one
    // hardcoded array to another hardcoded array cannot fail for the reason it claims to exist:
    // add a tone to the badge and both copies stay in agreement with each other and wrong about
    // the product. Parsing the union off the real prop type is what makes this able to go red.
    const union = badgeSource.match(/tone\?:\s*([^;]+);/)?.[1];
    expect(union, "AppBadge's tone prop is no longer a string union — this test must be re-aimed")
      .toBeTruthy();
    const badgeTones = [...union!.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);

    expect(badgeTones.length).toBe(7);
    expect([...badgeTones].sort()).toEqual([...TONES].sort());
  });
});

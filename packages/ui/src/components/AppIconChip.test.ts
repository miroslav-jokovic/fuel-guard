import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AppIconChip from "./AppIconChip.vue";
import AppIcon from "./AppIcon.vue";
import { TruckIcon } from "../icons";
// Vite's `?raw` rather than `node:fs`: `import.meta.url` is not a file URL under vitest's
// transform (it throws `ERR_INVALID_URL_SCHEME`), and a cwd-relative path would depend on whether
// the runner started in `packages/ui` or at the repo root. CI does the latter.
import badgeSource from "./AppBadge.vue?raw";

/**
 * `AppIconChip` (D-DT17, `docs/plans/design-system/DASHBOARD-TEMPLATE-V2.md` §4.2b).
 *
 * ⚠ What is pinned here is that CLOSING THE VOCABULARY CHANGED NOTHING ON SCREEN. This component
 * replaced 22 hand-written `tone="text-success-600 bg-success-50"` strings across 5 files, and the
 * only way that refactor is safe to merge is if every tone still resolves to the exact pair its
 * call sites were passing. The strings below are therefore duplicated ON PURPOSE — they are the
 * incumbent values copied from the call sites before the change, so if somebody edits the `tones`
 * map they have to come here and say so deliberately.
 *
 * The restyle these unblock (gradient ground, white glyph) is expected to CHANGE these
 * expectations. That is the signal working, not a broken test.
 */
const mountChip = (props: Record<string, unknown> = {}) =>
  mount(AppIconChip, { props: { icon: TruckIcon, ...props } });

describe("AppIconChip tone vocabulary", () => {
  /** The pairs the 24 call sites were passing, verbatim. */
  const INCUMBENT: [string, string][] = [
    ["danger", "text-danger-600 bg-danger-50"],
    ["caution", "text-caution-600 bg-caution-50"],
    ["warning", "text-warning-600 bg-warning-50"],
    ["success", "text-success-600 bg-success-50"],
    ["info", "text-info-600 bg-info-50"],
    ["brand", "text-brand-600 bg-brand-50"],
    ["neutral", "text-ink-muted bg-surface-muted"],
  ];

  it.each(INCUMBENT)("resolves tone=%s to the pair its call sites hand-wrote", (tone, pair) => {
    const cls = mountChip({ tone }).get("span").classes();
    for (const c of pair.split(" ")) expect(cls).toContain(c);
  });

  /**
   * ⚠ Not cosmetic. `neutral` is the ZERO-VALUE tone — `KpiHeroWidget` reaches for it when the
   * alert count is 0 and `MaintenanceHomePage` when nothing is short. Defaulting to a hue would
   * paint a calm figure in a colour that means something.
   */
  it("defaults to neutral rather than to a hue", () => {
    expect(mountChip().get("span").classes()).toContain("bg-surface-muted");
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
    expect([...badgeTones].sort()).toEqual(INCUMBENT.map(([t]) => t).sort());
  });
});

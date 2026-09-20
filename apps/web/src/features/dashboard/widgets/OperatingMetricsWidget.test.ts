import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { computed, ref } from "vue";

/**
 * The operating-metrics strip's ANATOMY (DR7a, `docs/plans/design-system/DESIGN-REFRESH-2026-09.md`).
 *
 * ── WHY THIS FILE EXISTS AT ALL ──────────────────────────────────────────────────────────────────
 * The widget had no component test before DR7a, and the two things it got wrong were each invisible
 * to every test that did cover it. `dashboardEquivalence.test.ts` reads only `dt`/`dd`/`h2`/`h3`
 * TEXT, so it cannot see a chip that is never drawn or a column count that clips the text it is
 * reading; `tabWidgetsLayout.test.ts` asserts which widgets appear, not what is inside one. Both
 * were green for as long as the defects lived, which is the argument for a third file rather than a
 * wider assertion in either of those two — neither is the wrong shape, they are answering other
 * questions.
 *
 * ⚠ These are CLASS assertions, which this repo is otherwise sparing with, and the reason is that
 * both rulings below are expressed in nothing else. "Four columns, not eight" and "bold, not
 * semibold" have no behaviour to observe and no DOM structure to count — a render test that avoided
 * the class string would be asserting that the strip still has tiles, which was never in doubt.
 */

const SUMMARY = {
  totalSpend: 128_400.5,
  totalGallons: 34_100,
  reeferSpend: 9_100,
  declinedCount: 3,
  coveragePct: 95,
  allTimeCoveragePct: 23,
};

vi.mock("../useDashboard", () => ({
  useDashboard: () => ({ data: computed(() => SUMMARY), isLoading: ref(false), isFetching: ref(false) }),
}));
vi.mock("@/composables/useFuelLog", () => ({
  useFuelRangeTotals: () => ({ data: computed(() => ({ fillUps: 210, totalMiles: 251_000 })), isLoading: ref(false) }),
}));
vi.mock("@/composables/useFleetMpg", () => ({
  useFleetMpgSeries: () => ({
    data: computed(() => ({ total: { mpg: 7.4, measuredShare: 0.82, reason: null }, periods: [] })),
  }),
}));
vi.mock("@/composables/useFindingsSummary", async (importOriginal) => ({
  // `ledgerTiles` stays real: it is what supplies two of the eight icons, and a stub of it would
  // make "every tile draws its chip" a statement about the stub.
  ...(await importOriginal<object>()),
  useFindingsSummaryQuery: () => ({
    data: computed(() => ({ open: 4, recoveredThisQuarter: 12_500, quarterFrom: "2026-07-01" })),
  }),
}));
vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({ canView: () => true, can: () => true, readOnly: false, role: "admin", sections: null }),
}));

async function renderStrip() {
  const { default: OperatingMetricsWidget } = await import("./OperatingMetricsWidget.vue");
  return mount(OperatingMetricsWidget, {
    props: { range: { from: "2026-09-01", to: "2026-09-15" } },
    global: { stubs: { RouterLink: { template: "<a><slot /></a>" } } },
  });
}

describe("the operating-metrics strip's tile anatomy (DR7a)", () => {
  /**
   * ⚠ The chip is the assertion that would have caught the original defect, and it is worth being
   * precise about what the defect WAS: not a chip that rendered wrongly, but eight `icon` and `tone`
   * values computed on every range change and dropped. The data was always there. Counting chips
   * against tiles is therefore the right shape — a fixed expectation of eight would pass just as
   * happily against a template that hard-coded one glyph for all of them.
   */
  it("draws one icon chip per tile, in that tile's own tone", async () => {
    const wrapper = await renderStrip();
    const tiles = wrapper.findAll("dl > *");
    const chips = wrapper.findAll("dl span[aria-hidden='true']");
    expect(tiles.length).toBeGreaterThan(0);
    expect(chips).toHaveLength(tiles.length);

    // Two different tones, read off the rendered chips rather than off the source: "Fill-ups" is
    // brand, "Miles driven" is success. A template painting every chip one colour passes the count
    // above and fails here. (The class NAMES changed on 2026-09-20 — `bg-brand-50` became the
    // gradient head `from-chip-brand-from` when D-DT17's restyle landed — the question did not.)
    const classes = chips.map((c) => c.attributes("class") ?? "");
    expect(classes.some((c) => c.includes("from-chip-brand-from"))).toBe(true);
    expect(classes.some((c) => c.includes("from-chip-success-from"))).toBe(true);
    // Copied from `StatCard`'s `size="kpi"` branch, and pinned so the two cannot drift apart
    // silently — D-DR2 moved the chip left in the HERO anatomy only.
    for (const c of classes) expect(c).toContain("size-9");
  });

  /**
   * Measured 2026-09-16, and the numbers are why this is a test and not a preference: at the 1280px
   * where `xl:grid-cols-8` switched on, the cell was 116px and "Telematics coverage" overran it by
   * 27px; at 1440px a label and three captions still clipped; at 1512px two captions did. Nothing
   * truncated at the four-up's 168px cell. `truncate` throws nothing and warns nothing, so the only
   * thing standing between that grid and a re-introduction is this assertion.
   */
  it("stops at four columns, because eight never fitted at any width they existed at", async () => {
    const wrapper = await renderStrip();
    const grid = wrapper.find("dl").attributes("class") ?? "";
    expect(grid).toContain("md:grid-cols-3");
    expect(grid).toContain("xl:grid-cols-4");
    expect(grid).not.toContain("grid-cols-8");
  });

  /**
   * DESIGN-SYSTEM-CONTRACT.md §2.3: "`font-bold` is reserved for KPI numbers. Headings are
   * `font-semibold`." These are KPI numbers and they shipped in the heading's weight — the same
   * correction D-DR2 made to `StatCard`'s hero value. The `text-lg` half is asserted too, because
   * the contract pairs bold with `text-2xl` and this strip deliberately does not follow it there:
   * it sits under four `text-3xl` hero tiles that outrank it, so taking the full KPI size would
   * flatten the order. Both halves are decisions, so both are pinned.
   */
  it("gives its values the contract's KPI weight without taking the KPI size", async () => {
    const wrapper = await renderStrip();
    const value = wrapper.findAll("dd")[0]!.attributes("class") ?? "";
    expect(value).toContain("font-bold");
    expect(value).toContain("text-lg");
  });
});

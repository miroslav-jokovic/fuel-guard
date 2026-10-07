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

// DR2b: no previous window here, so no delta pill; this file is not about the comparison.
vi.mock("../useDashboardComparison", () => ({
  useDashboardComparison: () => ({
    previousRange: computed(() => ({ from: "2026-08-01", to: "2026-08-31" })),
    previous: computed(() => undefined), mpgPrevious: computed(() => undefined), isLoading: ref(false),
  }),
}));
vi.mock("../useDashboard", () => ({
  useDashboard: () => ({ data: computed(() => SUMMARY), isLoading: ref(false), isFetching: ref(false) }),
}));
/** Captures the filters this card hands the RPC — the assertion for D-PREC5 lives on them. */
const rangeTotalsArgs: Array<{ from?: string; to?: string }> = [];
vi.mock("@/composables/useFuelLog", () => ({
  useFuelRangeTotals: (filters: { value: { from?: string; to?: string } }) => {
    rangeTotalsArgs.push(filters.value);
    return { data: computed(() => ({ fillUps: 210, totalMiles: 251_000 })), isLoading: ref(false) };
  },
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
// The real shape (SP5): each tile is a link only where its page opens, which `useOpens` answers
// from the role and the screen answers — so an answer-everything stub would say nothing about it.
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s, __session: s };
});

async function renderStrip() {
  const { default: OperatingMetricsWidget } = await import("./OperatingMetricsWidget.vue");
  return mount(OperatingMetricsWidget, {
    props: { range: { from: "2026-09-01", to: "2026-09-15" } },
    global: {
      stubs: {
        RouterLink: {
          props: ["to"],
          template: `<a :href="typeof to === 'string' ? to : to.path"><slot /></a>`,
        },
      },
    },
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


/**
 * D-PREC5, measured. This card asked `fuel_range_totals` for a window built with
 * `new Date(`${from}T00:00:00`).toISOString()` — the BROWSER's midnight — and the RPC's parameters
 * are `date`, so Postgres cast it back to a calendar day one later. For a Central viewer asking
 * 08/09 → 08/09 on 2026-09-20 that was **104 fills and 11,471 gallons instead of 45 and 4,788**,
 * beside neighbouring tiles on the same card that were right.
 */
describe("the window this card asks about (D-PREC5)", () => {
  it("passes the picked calendar days through, undecorated", async () => {
    rangeTotalsArgs.length = 0;
    await renderStrip();

    expect(rangeTotalsArgs[0]).toEqual({ from: "2026-09-01", to: "2026-09-15" });
  });

  // The shape of the bug, stated so a reintroduction cannot pass: anything with a `T` in it is an
  // instant, and an instant is the one thing a `date` parameter must never be handed.
  it("sends nothing that looks like an instant", async () => {
    rangeTotalsArgs.length = 0;
    await renderStrip();

    const sent = rangeTotalsArgs[0]!;
    expect(sent.from).not.toContain("T");
    expect(sent.to).not.toContain("T");
    expect(sent.to).not.toContain("Z");
  });
});

/**
 * SP5 (plan §4b): a tile is a link only where its page opens for the reader. Detection coverage and
 * Reefer coverage are Settings screens that start off for everyone but the admin (Q-SET2), and Fuel
 * spend asks `fuel: manage` — the dispatcher's strip used to link all three into the guard's refusal.
 */
describe("the strip's doors (SP5)", () => {
  it("links every tile for the admin", async () => {
    const hrefs = (await renderStrip()).findAll("a").map((a) => a.attributes("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["/coverage", "/reefer-coverage", "/fuel-spend"]));
  });

  it("keeps a fleet manager's figures and drops the doors to screens they do not have", async () => {
    const { __session: session } = (await import("@/stores/session")) as unknown as {
      __session: import("@/testing/fakeSession").FakeSession;
    };
    session.role = "fleet_manager";
    try {
      const w = await renderStrip();
      const hrefs = w.findAll("a").map((a) => a.attributes("href"));
      expect(hrefs).not.toContain("/coverage");
      expect(hrefs).not.toContain("/reefer-coverage");
      expect(w.text()).toContain("Telematics coverage");
      session.surfaces = { "admin.coverage": true };
      expect((await renderStrip()).findAll("a").map((a) => a.attributes("href"))).toContain("/coverage");
    } finally {
      session.role = "admin";
      session.surfaces = null;
    }
  });
});

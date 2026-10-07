import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { computed, ref } from "vue";
import type { PeriodDelta } from "@silvicom/shared";

/**
 * The headline strip's delta pills (DR2b, D-DT6/D-DT8, D-DR12).
 *
 * Three rulings, one file: the three PERIOD tiles carry a pill whose verdict is the tile's own
 * (spend up is bad, MPG up is good); "Active alerts" carries none because it is current state and
 * has no previous period; and nothing carries a pill until the previous window has answered — a
 * dash there would claim "no change" about a comparison that has not been made.
 */
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s, __session: s };
});

const deltas = ref<Record<string, PeriodDelta | null>>({ spend: null, mpg: null, idleHours: null });

vi.mock("../fleetWidgetData", async (orig) => ({
  ...(await orig<object>()),
  useFleetWidgetData: () => ({
    s: computed(() => ({
      totalSpend: 1_300_000, idleCostUsd: 151_900, idleHours: 32_302, openAnomalies: 68,
      anomaliesBySeverity: { low: 18, medium: 24, high: 17, critical: 9 }, spendTrend: [],
    })),
    isLoading: ref(false), isFetching: ref(false), canSeeMoney: computed(() => true),
    mpgTotal: computed(() => ({ mpg: 7.72 })), mpgWeeks: computed(() => []), mpgSub: computed(() => ""),
    mpgTitle: computed(() => ""), rangeLabel: computed(() => "Aug 19 – Sep 18"),
    previousRange: computed(() => ({ from: "2026-07-19", to: "2026-08-18" })),
    previousLabel: computed(() => "Jul 19 – Aug 18"),
    deltas: computed(() => deltas.value),
  }),
}));

const RouterLink = { props: ["to"], template: "<a :href='to'><slot /></a>" };

const render = async () => {
  const KpiHeroWidget = (await import("./KpiHeroWidget.vue")).default;
  return mount(KpiHeroWidget, { props: { range: { from: "2026-08-19", to: "2026-09-18" } }, global: { stubs: { RouterLink } } });
};

/** The tile whose label this is, as the DOM node the pill would sit in. */
const tile = (w: ReturnType<typeof mount>, label: string) =>
  w.findAll("p").find((p) => p.text() === label)!.element.closest("dl > *")!;

describe("KpiHeroWidget delta pills", () => {
  beforeEach(() => {
    deltas.value = { spend: null, mpg: null, idleHours: null };
  });

  it("draws no pill on any tile until the previous window has answered", async () => {
    const w = await render();
    expect(w.findAll("[data-direction]")).toHaveLength(0);
  });

  it("gives the three period tiles a pill with the tile's own verdict, and Active alerts none", async () => {
    deltas.value = {
      spend: { abs: 140_000, pct: 12.07, direction: "up" },
      mpg: { abs: 0.3, pct: 4.04, direction: "up" },
      idleHours: { abs: -2_000, pct: -5.8, direction: "down" },
    };
    const w = await render();

    const spend = tile(w, "Fuel spend").querySelector("[data-direction]")!;
    expect(spend.getAttribute("data-direction")).toBe("up");
    expect(spend.className).toContain("danger"); // spend up is bad (D-DT8)
    expect(spend.textContent).toContain("12%");

    const mpg = tile(w, "Fleet avg MPG").querySelector("[data-direction]")!;
    expect(mpg.getAttribute("data-direction")).toBe("up");
    expect(mpg.className).toContain("success"); // MPG up is good
    expect(mpg.textContent).toContain("0.3"); // its own unit, not a percent

    const idle = tile(w, "Idle waste").querySelector("[data-direction]")!;
    expect(idle.getAttribute("data-direction")).toBe("down");
    expect(idle.className).toContain("success"); // idle down is good

    expect(tile(w, "Active alerts").querySelector("[data-direction]")).toBeNull(); // D-DR12
    expect(w.text()).toContain("versus Jul 19 – Aug 18");
  });
});

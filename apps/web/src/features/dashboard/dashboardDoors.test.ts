import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { computed, ref } from "vue";

/**
 * Every door on the Fleet overview opens only where the page behind it opens for THIS reader
 * (SP5, plan §4b) — and the figure stays when the door goes. Three ways a door closes, each
 * exercised: a role with no section, an org that took a section away, and one person whose
 * screen is off. Rewritten for v3 (2026-10-06): the doors moved from tiles to cards, the rule did
 * not.
 */
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s, __session: s };
});
const { __session: session } = (await import("@/stores/session")) as unknown as {
  __session: import("@/testing/fakeSession").FakeSession;
};

vi.mock("./fleetWidgetData", async (orig) => ({
  ...(await orig<object>()),
  useFleetWidgetData: () => ({
    s: computed(() => ({
      totalSpend: 1000, totalGallons: 400, idleCostUsd: 10, idleHours: 5, openAnomalies: 2, declinedCount: 1,
      movingSpend: 900, reeferSpend: 90, coveragePct: 95, allTimeCoveragePct: 23,
      anomaliesBySeverity: { low: 0, medium: 0, high: 1, critical: 1 }, spendTrend: [{ date: "2026-09-01", value: 1000 }],
      topVehiclesByRisk: [{ id: "v1", label: "Unit 1207", anomalyCount: 3, criticalCount: 1 }],
      topDriversByRisk: [{ id: "d1", label: "Marcus Reyes", anomalyCount: 3, criticalCount: 1 }],
    })),
    previous: computed(() => undefined), mpgPrevious: computed(() => undefined), mpgPreviousWeeks: computed(() => []),
    fuelTotals: computed(() => ({ fillUps: 12, totalMiles: 4_000 })), fuelLoading: ref(false),
    isLoading: ref(false), isFetching: ref(false), canSeeMoney: computed(() => true),
    mpgTotal: computed(() => ({ mpg: 7 })), mpgWeeks: computed(() => []), mpgSub: computed(() => ""),
    mpgTitle: computed(() => ""), rangeLabel: computed(() => "Sep 1 – Sep 15"),
    previousRange: computed(() => ({ from: "2026-08-17", to: "2026-08-31" })),
    previousLabel: computed(() => "Aug 17 – Aug 31"), previousPhrase: computed(() => "the previous 15 days"),
    deltas: computed(() => ({ spend: null, gallons: null, idleHours: null, idleCost: null, reefer: null, declined: null, mpg: null, fillUps: null, miles: null })),
  }),
}));
vi.mock("@/composables/useFindingsSummary", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useFindingsSummaryQuery: () => ({ data: computed(() => ({ open: 4, recoveredThisQuarter: null, quarterFrom: "2026-07-01", oldestOpenOn: "2026-08-01" })) }),
}));
vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => ({ data: ref([{ id: "v1", status: "active", tank_capacity_gal: 0, baseline_mpg: null }]) }),
}));
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: ref([]) }) }));
vi.mock("@/composables/useOrgSettings", () => ({
  useOrgSettingsQuery: () => ({ data: ref({ notification_emails: [], notifications_enabled: true }) }),
}));
vi.mock("@/components/BaseChart.vue", () => ({ default: { template: "<div data-test='chart' />" } }));

const FuelWidget = (await import("./widgets/FuelWidget.vue")).default;
const AttentionWidget = (await import("./widgets/AttentionWidget.vue")).default;
const ConcentrationWidget = (await import("./widgets/ConcentrationWidget.vue")).default;
const FleetReadiness = (await import("./FleetReadiness.vue")).default;

const RouterLink = { props: ["to"], template: `<a :href="typeof to === 'string' ? to : JSON.stringify(to)"><slot /></a>` };
const global = { stubs: { RouterLink } };
const hrefs = (w: ReturnType<typeof mount>) => w.findAll("a").map((a) => a.attributes("href"));
const range = { from: "2026-09-01", to: "2026-09-15" };

beforeEach(() => {
  session.role = "admin";
  session.sections = null;
  session.surfaces = null;
});

describe("the Fuel card", () => {
  it("opens the Fuel log for the admin, and keeps its figure for a person whose Fuel log is off", () => {
    expect(hrefs(mount(FuelWidget, { props: { range }, global }))).toContain("/fuel-log?tab=fills");
    session.surfaces = { "fuel.log": false };
    const w = mount(FuelWidget, { props: { range }, global });
    expect(hrefs(w)).not.toContain("/fuel-log?tab=fills");
    expect(w.text()).toContain("$1,000");
  });
});

describe("the attention rail", () => {
  it("links every row to its page for the admin", () => {
    const h = hrefs(mount(AttentionWidget, { props: { range }, global }));
    expect(h).toContain("/anomalies");
    // Q-F13 (a): from the oldest item the row counts, so the page lists what was counted.
    expect(h).toContain("/fuel-problems?from=2026-08-01");
    expect(h).toContain("/idling");
    expect(h).toContain("/fuel-log?tab=declines");
  });

  it("stops linking to Cases for a role with no safety section, and keeps the count", () => {
    session.role = "accountant";
    const w = mount(AttentionWidget, { props: { range }, global });
    expect(hrefs(w)).not.toContain("/anomalies");
    expect(w.get("[data-test='attention-cases']").text()).toBe("2");
  });

  it("stops linking to Idling for one person whose Idling screen is off", () => {
    session.surfaces = { "safety.idling": false };
    expect(hrefs(mount(AttentionWidget, { props: { range }, global }))).not.toContain("/idling");
  });
});

describe("where open cases concentrate", () => {
  it("links a vehicle row for the admin and renders it plain when Vehicles is off for this person", () => {
    expect(hrefs(mount(ConcentrationWidget, { props: { range }, global }))).toEqual(["/vehicles/v1"]);
    session.surfaces = { "fleet.vehicles": false };
    const w = mount(ConcentrationWidget, { props: { range }, global });
    expect(hrefs(w)).toEqual([]);
    expect(w.text()).toContain("Unit 1207");
  });
});

describe("Setup gaps", () => {
  it("points the recipients gap at Notifications, the screen that holds them, for the admin", () => {
    expect(hrefs(mount(FleetReadiness, { global }))).toContain("/settings/notifications");
  });

  it("keeps the gap and drops its Fix for a fleet manager, whose Notifications screen starts off", () => {
    session.role = "fleet_manager";
    const w = mount(FleetReadiness, { global });
    expect(w.text()).toContain("Notification recipients");
    expect(hrefs(w)).not.toContain("/settings/notifications");
  });
});

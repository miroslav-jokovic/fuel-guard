import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { computed, ref } from "vue";

/**
 * The dashboard's doors (SP5, `SETTINGS-PERMISSIONS-PLAN.md` §4b, owner ruling 2026-09-30).
 *
 * The dashboard is `always` — everybody signed in gets it — while every page it points at has a gate
 * of its own, so it is the surface most likely to promise a page the guard then refuses. Before SP5
 * each tile, "View all" and risk row linked unconditionally. These pin that a door shows exactly when
 * the router guard would open its page: by role, by the org's section claim, and by one person's
 * screen answer. The session is the real shape (`testing/fakeSession`), so the answers come from the
 * shared matrix and the catalogue, never from a stub's booleans.
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
      totalSpend: 1000, idleCostUsd: 10, idleHours: 5, openAnomalies: 2,
      anomaliesBySeverity: { low: 0, medium: 0, high: 1, critical: 1 }, spendTrend: [],
    })),
    isLoading: ref(false), isFetching: ref(false), canSeeMoney: computed(() => true),
    mpgTotal: computed(() => ({ mpg: 7 })), mpgWeeks: computed(() => []), mpgSub: computed(() => ""),
    mpgTitle: computed(() => ""), rangeLabel: computed(() => "Sep 1 – Sep 15"),
  }),
}));
vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => ({ data: ref([{ id: "v1", status: "active", tank_capacity_gal: 0, baseline_mpg: null }]) }),
}));
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: ref([]) }) }));
vi.mock("@/composables/useOrgSettings", () => ({
  useOrgSettingsQuery: () => ({ data: ref({ notification_emails: [], notifications_enabled: true }) }),
}));

const KpiHeroWidget = (await import("./widgets/KpiHeroWidget.vue")).default;
const SeverityBreakdown = (await import("./SeverityBreakdown.vue")).default;
const RiskList = (await import("./RiskList.vue")).default;
const FleetReadiness = (await import("./FleetReadiness.vue")).default;

const RouterLink = { props: ["to"], template: `<a :href="typeof to === 'string' ? to : JSON.stringify(to)"><slot /></a>` };
const global = { stubs: { RouterLink, ChartCard: { template: "<section><slot name='meta' /><slot /></section>" } } };
const hrefs = (w: ReturnType<typeof mount>) => w.findAll("a").map((a) => a.attributes("href"));

beforeEach(() => {
  session.role = "admin";
  session.sections = null;
  session.surfaces = null;
});

describe("the headline tiles", () => {
  const range = { from: "2026-09-01", to: "2026-09-15" };
  it("link to their pages for the admin", () => {
    const h = hrefs(mount(KpiHeroWidget, { props: { range }, global }));
    expect(h).toContain("/anomalies");
    expect(h).toContain("/idling");
    expect(h).toContain("/driver-performance");
  });

  it("stop linking to Alerts for a role with no safety section, and keep the figure", () => {
    session.role = "accountant";
    const w = mount(KpiHeroWidget, { props: { range }, global });
    expect(hrefs(w)).not.toContain("/anomalies");
    expect(w.text()).toContain("Active alerts");
  });

  it("stop linking to Idling for one person whose Idling screen is off", () => {
    session.surfaces = { "safety.idling": false };
    expect(hrefs(mount(KpiHeroWidget, { props: { range }, global }))).not.toContain("/idling");
  });
});

describe("Open cases by severity", () => {
  const severity = { critical: 1, high: 0, medium: 0, low: 0 };
  it("offers View all where Alerts opens and not where the org took safety away", () => {
    expect(hrefs(mount(SeverityBreakdown, { props: { severity }, global }))).toEqual(["/anomalies"]);
    session.role = "fleet_manager";
    session.sections = { safety: "none" };
    expect(hrefs(mount(SeverityBreakdown, { props: { severity }, global }))).toEqual([]);
  });
});

describe("the risk lists", () => {
  const rows = [{ id: "d1", label: "Marcus Reyes", anomalyCount: 3, criticalCount: 1 }];
  it("link a driver row for the admin and render it plain when Drivers is off for this person", () => {
    const props = { title: "Top drivers", rows, linkBase: "/drivers", emptyLabel: "none" };
    expect(hrefs(mount(RiskList, { props, global }))).toEqual(["/drivers/d1"]);
    session.surfaces = { "fleet.drivers": false };
    const w = mount(RiskList, { props, global });
    expect(hrefs(w)).toEqual([]);
    expect(w.text()).toContain("Marcus Reyes");
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
    expect(hrefs(w)).toContain("/vehicles");
  });
});

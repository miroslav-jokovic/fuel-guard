import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";

/**
 * SP5 on the pages whose links and buttons asked a different gate from their target
 * (`SETTINGS-PERMISSIONS-PLAN.md` §4b, owner ruling 2026-09-30).
 *
 * Two kinds of fix, pinned together because they share a harness:
 *   - A LINK shows exactly when the router guard would open its page (`useOpens` / `GatedLink`).
 *   - A BUTTON shows exactly when its endpoint accepts the caller (`session.can` on the endpoint's
 *     own section), where that is stricter than the page it sits on.
 *
 * The session is the real shape (`testing/fakeSession`): every answer comes from the shared matrix
 * and the catalogue, and a test changes only who is signed in.
 */
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s, __session: s };
});
const { __session: session } = (await import("@/stores/session")) as unknown as {
  __session: import("@/testing/fakeSession").FakeSession;
};

const apiCalls: string[] = [];
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string) => {
    apiCalls.push(url);
    return { ok: true, data: url.includes("odometer-accuracy") ? { rows: [] } : null };
  }),
}));
vi.mock("@/composables/useOrgTimezone", () => ({ useOrgTimezone: () => ({ zone: ref("America/Chicago") }) }));
vi.mock("@/features/reports/download", () => ({ downloadReport: vi.fn() }));
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: ref([{ id: "v1", unit_number: "T-118" }]) }) }));

const FILL = {
  id: "f1", vehicleId: "v1", fueledAt: "2026-09-01T12:00:00Z", gallons: 100, totalCost: 400, computedMpg: 6.5,
  odometer: 1000, locationText: "Joliet, IL", city: null, state: null, observedCity: null, observedState: null,
};
vi.mock("@/features/anomalies/useRecallAudit", () => ({
  useAuditSample: () => ({ data: ref([FILL]), isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false) }),
  useRecallMetrics: () => ({ data: ref(null) }),
  useRecordVerdict: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
}));
vi.mock("@/features/roster/useOdometerMismatches", () => ({
  useOdometerMismatches: () => ({
    data: ref({ rows: [], offenders: [], toleranceMiles: 10 }),
    isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false),
  }),
}));
vi.mock("@/composables/useOrgSettings", () => ({
  useOrgSettingsQuery: () => ({ data: ref(null), isLoading: ref(false) }),
  useSaveOrgProfile: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
}));
vi.mock("@/features/maintenance/useMaintenanceSpend", () => ({
  useMaintenanceSpendQuery: () => ({
    data: ref({ entries: [], total: 0, pendingSources: null }),
    isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false),
  }),
}));

const RouterLink = { props: ["to"], template: `<a :href="String(to)"><slot /></a>` };
const PageHeader = { template: "<header><slot /><slot name='actions' /></header>" };
const mountPage = async (component: object) => {
  const w = mount(component, {
    global: { stubs: { RouterLink, PageHeader, DateRangeFilter: true, SamsaraFeedLine: true } },
  });
  await flushPromises();
  return w;
};
const hrefs = (w: ReturnType<typeof mount>) => w.findAll("a").map((a) => a.attributes("href"));
const buttons = (w: ReturnType<typeof mount>) => w.findAll("button").map((b) => b.text());

beforeEach(() => {
  setActivePinia(createPinia());
  apiCalls.length = 0;
  session.role = "admin";
  session.sections = null;
  session.surfaces = null;
});

describe("Recall audit", async () => {
  const Page = (await import("./RecallAuditPage.vue")).default;

  it("offers Clean and Missed to a settings manager, whose verdict the endpoint accepts", async () => {
    const w = await mountPage(Page);
    expect(buttons(w)).toEqual(expect.arrayContaining(["Clean", "Missed"]));
  });

  it("shows a settings VIEWER the batch without the two buttons the endpoint would refuse", async () => {
    session.role = "fleet_manager";
    session.sections = { settings: "view" };
    const w = await mountPage(Page);
    expect(w.text()).toContain("Joliet, IL");
    expect(buttons(w)).not.toContain("Clean");
    expect(buttons(w)).not.toContain("Missed");
  });

  it("names the truck as text where Vehicles is off for this person", async () => {
    expect(hrefs(await mountPage(Page))).toContain("/vehicles/v1");
    session.surfaces = { "fleet.vehicles": false };
    const w = await mountPage(Page);
    expect(hrefs(w)).not.toContain("/vehicles/v1");
    expect(w.text()).toContain("T-118");
  });
});

describe("Reports", async () => {
  const Page = (await import("./ReportsPage.vue")).default;

  it("offers Send digest now to a settings manager and not to a settings viewer", async () => {
    expect(buttons(await mountPage(Page))).toContain("Send digest now");
    session.role = "fleet_manager";
    session.sections = { settings: "view" };
    expect(buttons(await mountPage(Page))).not.toContain("Send digest now");
  });

  it("keeps Odometer Mismatches as words where the Odometer page does not open", async () => {
    expect(hrefs(await mountPage(Page))).toContain("/odometer");
    session.surfaces = { "fleet.odometer": false };
    const w = await mountPage(Page);
    expect(hrefs(w)).not.toContain("/odometer");
    expect(w.text()).toContain("Odometer Mismatches");
  });
});

describe("Odometer mismatches' empty state", async () => {
  const Page = (await import("./OdometerPage.vue")).default;

  it("links Data & sync and Coverage for the admin, and neither for a fleet manager without those screens", async () => {
    expect(hrefs(await mountPage(Page))).toEqual(expect.arrayContaining(["/settings/data", "/coverage"]));
    session.role = "fleet_manager";
    const w = await mountPage(Page);
    expect(hrefs(w)).not.toContain("/settings/data");
    expect(hrefs(w)).not.toContain("/coverage");
    expect(w.text()).toContain("Samsara re-sync / backfill");
  });
});

describe("Organization", async () => {
  const Page = (await import("./OrgSettingsPage.vue")).default;

  it("points at Notifications only where that screen is on for the reader", async () => {
    expect(hrefs(await mountPage(Page))).toContain("/settings/notifications");
    session.role = "fleet_manager";
    session.surfaces = { "admin.settings.org": true };
    const w = await mountPage(Page);
    expect(hrefs(w)).not.toContain("/settings/notifications");
    expect(w.text()).toContain("Settings → Notifications");
  });
});

describe("Repair spend", async () => {
  const Page = (await import("./MaintenanceSpendPage.vue")).default;

  it("points at the fleet report only where the Fleet report opens, per person too", async () => {
    expect(hrefs(await mountPage(Page))).toContain("/fleet-report");
    session.surfaces = { "finance.fleet-report": false };
    expect(hrefs(await mountPage(Page))).not.toContain("/fleet-report");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";

// Imported child components declare API-backed composables even though this suite stubs their
// rendered surfaces. Keep module evaluation local so tab behavior never requires Supabase config.
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  return { useSessionStore: () => fakeSession("admin") };
});

vi.mock("@/features/fueling/useFuelPlan", async () => {
  const { ref } = await import("vue");
  return {
    useFuelPlan: () => ({ isPending: ref(false), mutateAsync: vi.fn() }),
  };
});

vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));

vi.mock("@/composables/useModules", async () => {
  const { ref } = await import("vue");
  return { useModulesQuery: () => ({ data: ref(new Set()), isLoading: ref(false) }) };
});

vi.mock("@/composables/useDrivers", async () => {
  const { ref } = await import("vue");
  return {
    useDriversQuery: () => ({
      data: ref([]),
      isLoading: ref(false),
      isError: ref(false),
      error: ref(null),
    }),
  };
});

vi.mock("@/composables/useVehicles", async () => {
  const { ref } = await import("vue");
  return { useVehiclesQuery: () => ({ data: ref([]) }) };
});

vi.mock("@/composables/useRouteFuelSettings", async () => {
  const { ref } = await import("vue");
  return { useRouteFuelSettings: () => ({ data: ref(null) }) };
});

vi.mock("@/features/settings/useDriverAppFeatures", async () => {
  const { ref } = await import("vue");
  const query = () => ({
    data: ref([]),
    isLoading: ref(false),
    isError: ref(false),
    error: ref(null),
  });
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: ref(false) });
  return {
    useDriverAppFeaturesQuery: query,
    useDriverOverridesQuery: query,
    useSaveDriverAppFeature: mutation,
    useSaveDriverOverride: mutation,
    useClearDriverOverride: mutation,
  };
});

vi.mock("@/features/anomalies/useAnomalyDetail", async () => {
  const { ref } = await import("vue");
  return {
    useAnomalyDetail: () => ({
      txn: ref(null),
      transition: { isPending: ref(false), mutateAsync: vi.fn() },
      caseSignals: ref([]),
      isCase: ref(false),
      caseScore: ref(null),
      caseLevel: ref(undefined),
      caseAxes: ref([]),
      evidenceRows: ref([["limit", "120 gallons"]]),
      hasCardSignal: ref(false),
      cardRef: ref(null),
      windowHours: ref(48),
      siblingFills: ref([]),
      siblingLoading: ref(false),
      driverName: vi.fn(() => "—"),
      unitNumber: vi.fn(() => "—"),
      vehicleDesc: vi.fn(() => ""),
      tab: ref("overview"),
      orgTz: ref(null),
      odometerOffset: ref(0),
      axisClass: vi.fn(() => ""),
      weightBarClass: vi.fn(() => ""),
      fmt: vi.fn(() => ""),
      fmtShort: vi.fn(() => ""),
      fmtOdo: vi.fn(() => "—"),
      fmtMoney: vi.fn(() => "—"),
      formatKey: vi.fn((key: string) => key),
      note: ref(""),
      disposition: ref(""),
      DISPOSITION_OPTIONS: [],
      doTransition: vi.fn(),
      doFalseAlarm: vi.fn(),
    }),
  };
});

import DriverAppSettingsPage from "./DriverAppSettingsPage.vue";
import FuelPlanningPage from "./FuelPlanningPage.vue";
import AnomalyDetail from "@/features/anomalies/AnomalyDetail.vue";

enableAutoUnmount(afterEach);

const tabs = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('[role="tab"]');
const selectedTab = (wrapper: ReturnType<typeof mount>) =>
  wrapper.get('[role="tab"][aria-selected="true"]');

describe("standard page tabs", () => {
  it("switches the fuel-planning model and labelled panels", async () => {
    // The tab is in the URL (D-US2), so the page needs a router of its own.
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:any(.*)*", component: { template: "<div/>" } }] });
    await router.push("/fuel-planning");
    await router.isReady();
    const wrapper = mount(FuelPlanningPage, {
      global: {
        plugins: [router],
        stubs: {
          PageHeader: { template: "<header><slot name='actions' /></header>" },
          FuelPlanForm: { template: "<div>Plan form</div>", methods: { reset: vi.fn() } },
          PlanHistory: { template: "<div>Plan history</div>" },
          PlanStatusBanner: true,
          ManualTelematicsPanel: true,
          FuelPlanSummary: true,
          RouteMap: true,
          RouteSummary: true,
          TripPlan: true,
        },
      },
    });

    expect(selectedTab(wrapper).text()).toBe("Plan");
    expect(wrapper.get("#fuel-planning-panel-plan").isVisible()).toBe(true);
    expect(wrapper.get("#fuel-planning-panel-history").isVisible()).toBe(false);

    await tabs(wrapper).find((tab) => tab.text() === "History")!.trigger("click");
    await flushPromises();

    expect(selectedTab(wrapper).text()).toBe("History");
    expect(router.currentRoute.value.query.tab).toBe("history");
    expect(wrapper.get("#fuel-planning-panel-plan").attributes("style")).toContain("display: none");
    expect(wrapper.get("#fuel-planning-panel-history").attributes("style")).not.toContain("display: none");
    expect(wrapper.get("#fuel-planning-panel-history").attributes("aria-labelledby"))
      .toBe("fuel-planning-tab-history");
  });

  it("switches all Driver App settings panels through one canonical tab model", async () => {
    const wrapper = mount(DriverAppSettingsPage, {
      global: {
        stubs: {
          PageHeader: true,
          ScoreFeatureOptions: true,
          ClosureRequestsCard: true,
        },
      },
    });

    expect(selectedTab(wrapper).text()).toBe("Features");
    expect(wrapper.get("#driver-app-panel-features").attributes("aria-labelledby"))
      .toBe("driver-app-tab-features");

    await tabs(wrapper).find((tab) => tab.text() === "App controls")!.trigger("click");
    expect(selectedTab(wrapper).text()).toBe("App controls");
    expect(wrapper.find("#driver-app-panel-features").exists()).toBe(false);
    expect(wrapper.find("#driver-app-panel-app").exists()).toBe(true);

    await tabs(wrapper).find((tab) => tab.text() === "Driver exceptions")!.trigger("click");
    expect(selectedTab(wrapper).text()).toBe("Driver exceptions");
    expect(wrapper.find("#driver-app-panel-app").exists()).toBe(false);
    expect(wrapper.get("#driver-app-panel-exceptions").attributes("aria-labelledby"))
      .toBe("driver-app-tab-exceptions");
  });

  it("switches anomaly detail panels while keeping them labelled by canonical tabs", async () => {
    const wrapper = mount(AnomalyDetail, {
      props: {
        anomaly: {
          id: "anomaly-1",
          rule_id: "fuel_volume",
          status: "resolved",
          message: "Fuel volume exceeds the configured limit.",
          evidence: { limit: "120 gallons" },
          resolution_note: null,
          disposition: null,
        } as never,
        vehicleUnit: "701",
      },
      global: {
        stubs: {
          EntityHistory: true,
          AnomalyAudit: { template: "<div>Odometer audit</div>" },
          StatusBadge: true,
        },
      },
    });

    expect(selectedTab(wrapper).text()).toBe("Overview");
    expect(wrapper.get("#anomaly-detail-panel-overview").attributes("aria-labelledby"))
      .toBe("anomaly-detail-tab-overview");
    expect(wrapper.find("#anomaly-detail-panel-audit").exists()).toBe(false);

    await tabs(wrapper).find((tab) => tab.text() === "Odometer & Location")!.trigger("click");

    expect(selectedTab(wrapper).text()).toBe("Odometer & Location");
    expect(wrapper.find("#anomaly-detail-panel-overview").exists()).toBe(false);
    expect(wrapper.get("#anomaly-detail-panel-audit").attributes("aria-labelledby"))
      .toBe("anomaly-detail-tab-audit");
  });
});

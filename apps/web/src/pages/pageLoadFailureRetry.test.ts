import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";

/**
 * D-US5 — a page whose read fails says so and offers a Retry that asks again (owner ruling
 * 2026-10-12, "all pages and components production ready").
 *
 * Every page here used to do one of two worse things on a failed read: say nothing and fall through
 * to its content (the settings forms drew themselves on their built-in defaults, ready to be saved
 * over the org's real values; Reports said "No reviewed cases yet"), or print a tinted sentence with
 * no way out but the browser's reload. Each test fails its page's one read, then asks for the
 * sentence and for a Retry that reaches that read's `refetch` (or the page's own loader).
 *
 * Pages with a test file of their own carry this test there instead (FuelCostsPage, IftaLedgerPage,
 * FleetReportPage, FuelBuyDisciplinePage, FuelInvoiceCheckPage, CountSessionPage, the EFS and
 * FleetPal settings pages).
 */

/** One failed read, with a `refetch` the test can watch. */
const failing = vi.hoisted(() => ({ refetch: vi.fn() }));
const failed = () => ({
  data: ref(undefined),
  isLoading: ref(false),
  isError: ref(true),
  error: ref(new Error("502 Bad Gateway")),
  isFetching: ref(false),
  refetch: failing.refetch,
});
const ok = <T,>(data: T) => ({
  data: ref(data),
  isLoading: ref(false),
  isError: ref(false),
  error: ref(null),
  isFetching: ref(false),
  refetch: vi.fn(),
});
const mutation = () => ({ mutateAsync: vi.fn(), isPending: ref(false) });

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(async () => ({ ok: false, error: { message: "502" } })), apiDownload: vi.fn() }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  return { useSessionStore: () => fakeSession("admin") };
});
vi.mock("vue-router", async (orig) => ({
  ...((await orig()) as object),
  useRoute: () => ({ params: { id: "x1" }, query: {}, path: "/x1", meta: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), resolve: () => ({ name: "x", meta: {} }) }),
}));
vi.mock("@/composables/useOpens", () => ({ useOpens: () => () => true }));
vi.mock("@/composables/useOrgTimezone", () => ({ useOrgTimezone: () => ({ zone: ref("America/Chicago") }) }));

vi.mock("@/composables/useOrgSettings", () => ({
  useOrgSettingsQuery: () => failed(),
  useSaveOrgProfile: mutation,
  useSaveOrgNotifications: mutation,
}));
vi.mock("@/features/settings/useThresholds", () => ({ useThresholdsQuery: () => failed(), useSaveThresholds: mutation }));
vi.mock("@/features/drivers/useDriverPerformanceSettings", () => ({
  useDriverPerformanceSettings: () => failed(),
  useSaveDriverPerformanceSettings: mutation,
}));
vi.mock("@/composables/useRouteFuelSettings", () => ({ useRouteFuelSettings: () => failed(), useSaveRouteFuelSettings: mutation }));
vi.mock("@/features/fueling/useDiscountRules", async () => ({
  DISCOUNT_TYPES: (await import("@silvicom/shared")).DISCOUNT_TYPES,
  useDiscountRules: () => ok([]),
  useSaveDiscountRules: mutation,
}));
vi.mock("@/features/dispatch/useDispatchLoads", () => ({ useLoadDetailQuery: () => failed() }));
vi.mock("@/features/dispatch/useLoadDispatch", () => ({ dispatchHeadline: () => "", smsReasonText: () => "" }));
vi.mock("@/features/hazmat/useHazmatLoads", () => ({
  isAnalyzing: () => false,
  useHazmatLoadQuery: () => failed(),
  useHazmatRunsQuery: () => ok([]),
  useSubmitLoad: mutation,
  useAnalyzeLoad: mutation,
  useCancelLoad: mutation,
}));
vi.mock("@/features/hazmat/useDefensePacket", () => ({ useDefensePacket: () => ({ loading: ref(false), download: vi.fn() }) }));
vi.mock("@/composables/useModules", () => ({ useModulesQuery: () => ({ data: ref(new Set()), isLoading: ref(false) }) }));
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ok([]) }));
vi.mock("@/features/settings/useDriverAppFeatures", () => ({
  useDriverAppFeaturesQuery: () => failed(),
  useDriverOverridesQuery: () => ok([]),
  useSaveDriverAppFeature: mutation,
  useSaveDriverOverride: mutation,
  useClearDriverOverride: mutation,
}));
vi.mock("@/features/reports/download", () => ({ downloadReport: vi.fn() }));

const stubs = {
  PageHeader: true,
  RouterLink: true,
  GatedLink: true,
  DateRangeFilter: true,
  HazmatPanel: true,
  DispatchLoadDrawer: true,
  ScoreFeatureOptions: true,
  ClosureRequestsCard: true,
};

async function retryReaches(page: string, sentence: string, retried: () => number) {
  const Page = (await import(`./${page}.vue`)).default;
  const w = mount(Page, { global: { stubs } });
  await flushPromises();
  expect(w.text(), page).toContain(sentence);
  const retry = w.findAll("button").find((b) => b.text() === "Retry");
  expect(retry, `${page} offers a Retry`).toBeTruthy();
  const before = retried();
  await retry!.trigger("click");
  await flushPromises();
  expect(retried() - before, page).toBe(1);
  w.unmount();
}
const refetches = () => failing.refetch.mock.calls.length;

beforeEach(() => {
  setActivePinia(createPinia());
  failing.refetch.mockClear();
});

describe("a page whose read fails says so and retries it in place (D-US5)", () => {
  it.each([
    ["DispatchLoadDetailPage", "Could not open this load."],
    ["HazmatLoadDetailPage", "Could not load this hazmat load."],
    ["DriverAppSettingsPage", "Could not load the Driver App settings."],
  ])("%s", async (page, sentence) => {
    await retryReaches(page, sentence, refetches);
  });

  // The settings forms: the failure must also keep the form, and its Save, off the screen — the
  // form's built-in defaults are not the org's values.
  it.each([
    ["DriverPerformanceSettingsPage", "Could not load the performance settings."],
    ["FuelPlanningSettingsPage", "Could not load the planner settings."],
    ["OrgSettingsPage", "Could not load the organization's settings."],
    ["ThresholdsPage", "Could not load the limits."],
    ["NotificationsPage", "Could not load the alert settings."],
  ])("%s, and draws no form to save", async (page, sentence) => {
    await retryReaches(page, sentence, refetches);
    const Page = (await import(`./${page}.vue`)).default;
    const w = mount(Page, { global: { stubs } });
    // FuelPlanningSettingsPage's discount-rules card has its own read and stays; it is not a form.
    expect(w.find("form").exists(), page).toBe(false);
    w.unmount();
  });

  it("ReportsPage — tells a failed accuracy read from no reviewed cases, and reloads it", async () => {
    const { apiFetch } = await import("@/lib/api");
    const metricsCalls = () =>
      vi.mocked(apiFetch).mock.calls.filter(([url]) => String(url).includes("detection-metrics")).length;
    await retryReaches("ReportsPage", "Could not load the detection accuracy.", metricsCalls);
  });
});

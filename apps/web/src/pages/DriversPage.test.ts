import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createRouter, createMemoryHistory } from "vue-router";
import { ref } from "vue";
import type { Driver, Vehicle } from "@silvicom/shared";
import DriversPage from "@/pages/DriversPage.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import ColumnPicker from "@/components/ui/ColumnPicker.vue";

/**
 * R2's safety net (DRIVER-ROSTER-PLAN.md §5): the roster table moves out of `DriversPage.vue` into
 * `features/roster/DriverRosterTable.vue` so R4 has room for four more columns. The extraction is
 * meant to be invisible, and "invisible" is only a claim unless the rendered markup is compared —
 * so this snapshot was taken BEFORE the move and must survive it byte for byte.
 *
 * The fixture is deliberately awkward: one driver with everything set, one with almost nothing, one
 * archived. That covers each cell's null branch, the "Due 12d" rollup override, and the app-access
 * badge with and without a username.
 *
 * The row menu is teleported to `document.body`, so it is outside the table snapshot and pinned
 * separately — it is where the Archive/Restore branch lives, and that branch only appears in the
 * archived view.
 */

const drivers = ref<Driver[]>([]);
const vehicles = ref<Vehicle[]>([]);
const overview = ref<unknown>(null);

const driversQuery = {
  data: drivers,
  isLoading: ref(false),
  isError: ref(false),
  error: ref(null),
  refetch: vi.fn(),
  isFetching: ref(false),
};
const idleMutation = () => ({ isPending: ref(false), mutateAsync: vi.fn() });

vi.mock("@/composables/useDrivers", () => ({
  useDriversQuery: () => driversQuery,
  useCreateDriver: () => idleMutation(),
  useUpdateDriver: () => idleMutation(),
  useArchiveDriver: () => idleMutation(),
}));
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: vehicles }) }));
vi.mock("@/composables/useCompliance", () => ({
  useComplianceOverviewQuery: () => ({ data: overview }),
}));
vi.mock("@/features/roster/useDriverReconcile", () => ({
  useDriverReconcile: () => ({
    preview: vi.fn(),
    apply: vi.fn(),
    linkOne: vi.fn(),
    report: ref(null),
    loading: ref(false),
    applying: ref(false),
    error: ref(null),
  }),
}));
vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({ can: () => true, canView: () => true }),
}));
// PageHeader builds a breadcrumb from the live route; it is page chrome, not the table under test.
vi.mock("@/components/ui/PageHeader.vue", () => ({
  default: {
    props: ["description"],
    template: `<header><slot name="actions" /></header>`,
  },
}));
vi.mock("@/stores/toast", () => ({
  useToastStore: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const base = (over: Partial<Driver>): Driver => ({
  id: "d-0",
  org_id: "org-1",
  user_id: null,
  full_name: "Unnamed",
  employee_id: null,
  phone: null,
  status: "active",
  samsara_driver_id: null,
  samsara_username: null,
  current_hos_status: null,
  current_hos_vehicle: null,
  current_hos_at: null,
  current_location: null,
  app_username: null,
  app_access_enabled: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  archived_at: null,
  ...over,
});

const RouterLinkStub = {
  props: ["to"],
  template: `<a :href="typeof to === 'string' ? to : ''"><slot /></a>`,
};

beforeEach(() => {
  // hosAgo() renders "as of Nh ago" from Date.now(); a real clock would make the snapshot rot daily.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-30T12:00:00Z"));
  // jsdom's matchMedia always answers false, which would snapshot DataTable's narrow card layout
  // instead of the table this step is about.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));

  drivers.value = [
    base({
      id: "d-1",
      full_name: "Marcus Reyes",
      employee_id: "D-104",
      phone: "5558675309",
      samsara_username: "marcus",
      samsara_driver_id: "sam-1",
      current_hos_status: "driving",
      current_hos_vehicle: "T-118",
      current_hos_at: "2026-08-30T09:30:00Z",
      current_location: "Joliet, IL",
      app_username: "mreyes",
      app_access_enabled: true,
      user_id: "u-1",
    }),
    base({ id: "d-2", full_name: "Ana Whitfield", status: "inactive" }),
    base({
      id: "d-3",
      full_name: "Gone Away",
      status: "terminated",
      archived_at: "2026-07-01T00:00:00Z",
    }),
  ];
  vehicles.value = [
    { id: "v-1", unit_number: "T-118", assigned_driver_id: "d-1" } as unknown as Vehicle,
    { id: "v-2", unit_number: "T-902", assigned_driver_id: "d-1" } as unknown as Vehicle,
  ];
  overview.value = {
    drivers: [
      // Inside 30 days with nothing expired → the "Due 12d" override, not the plain state word.
      { driver_id: "d-1", state: "incomplete", counts: { expired: 0 }, attention: [{ daysRemaining: 12 }] },
      { driver_id: "d-2", state: "complete", counts: { expired: 0 }, attention: [] },
      // d-3 is absent on purpose: rows the rollup does not return read as "—".
    ],
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * A real router, because the column picker holds its choice in the URL (R3b) — but `RouterLink` stays
 * STUBBED, so the rendered markup the snapshots pin is the same anchor it always was. The page needs
 * `useRoute`/`useRouter` to work; it does not need real navigation to render a table.
 */
const mountPage = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/drivers", component: { template: "<div/>" } }],
  });
  // Awaited: an unresolved route has no match, and the column picker's first `replace` throws on one.
  await router.push("/drivers");
  await router.isReady();
  return mount(DriversPage, {
    global: {
      plugins: [VueQueryPlugin, router],
      stubs: { RouterLink: RouterLinkStub },
    },
  });
};

/**
 * The "Show" filter is the second FilterSelect on the bar. Driven through its model rather than by
 * clicking the popover open: this file is pinning the TABLE, and a filter's internals changing
 * should not be able to fail an extraction test that has nothing to do with them.
 */
const showArchived = async (w: Awaited<ReturnType<typeof mountPage>>) => {
  const filters = w.findAllComponents(FilterSelect);
  await filters[1]!.vm.$emit("update:modelValue", "archived");
  await w.vm.$nextTick();
};

describe("DriversPage roster table", () => {
  it("renders the roster table unchanged by the R2 extraction", async () => {
    const table = (await mountPage()).find("table");
    expect(table.exists()).toBe(true);
    expect(table.html()).toMatchSnapshot();
  });

  it("renders the archived view unchanged by the R2 extraction", async () => {
    const w = await mountPage();
    await showArchived(w);
    expect(w.find("table").html()).toMatchSnapshot();
  });

  /**
   * R3b end to end: the picker lives in the toolbar and the table is a different component, so the
   * two only agree through `useTableColumns`. Hiding a column has to reach the header, the cells,
   * and the URL — a picker that ticks a box and changes nothing is the failure mode worth pinning.
   */
  it("hides a column from the table when the picker turns it off", async () => {
    const w = await mountPage();
    expect(w.find("table").text()).toContain("Phone");

    const picker = w.findComponent(ColumnPicker);
    picker.vm.columns.toggle("phone");
    await flushPromises();

    expect(w.find("table").text()).not.toContain("Phone");
    expect(w.find("table").text()).not.toContain("(555) 867-5309");
    // …and it is in the URL, which is what lets a saved view carry it in R3c (D-ROS14).
    expect(w.vm.$route.query.hide).toBe("phone");
  });

  it("keeps the name column whatever the picker is asked to do", async () => {
    const w = await mountPage();
    const picker = w.findComponent(ColumnPicker);
    picker.vm.columns.toggle("full_name");
    await flushPromises();
    expect(w.find("table").text()).toContain("Marcus Reyes");
  });

  it("offers Archive on a live row and Restore on an archived one", async () => {
    const w = await mountPage();
    await w.find("td[class*=pl-2] button").trigger("click");
    expect(document.body.textContent).toContain("Archive…");
    expect(document.body.textContent).not.toContain("Restore to the roster");

    const archived = await mountPage();
    await showArchived(archived);
    await archived.find("td[class*=pl-2] button").trigger("click");
    expect(document.body.textContent).toContain("Restore to the roster");
  });
});

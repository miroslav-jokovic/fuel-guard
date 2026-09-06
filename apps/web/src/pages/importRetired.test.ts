import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { ref, type Component } from "vue";

/**
 * FUEL-C4, D-FUI3 — `/import` is retired, and this is the suite that says nothing went with it.
 *
 * ── WHY A DELETION NEEDS A TEST MORE THAN AN ADDITION DOES ──────────────────────────────────────
 * A retired page leaves nothing behind to notice. Three capabilities lived on `/import` — the EFS
 * backfill, the Pilot price and locations uploads, and Repair fuel data — and each one now opens
 * from a different page. If any of the three had simply not been reconnected, every test in this
 * repo would still pass, the nav would look tidier, and the loss would surface as a support question
 * months later. So the done-when ("no upload capability is lost") is asserted as three findings, one
 * per new home.
 *
 * ── ⚠ AND THE PART THE PLAN DID NOT SAY OUT LOUD ────────────────────────────────────────────────
 * `/import` was catalogued `manage("fuel")`. Its EFS half now opens from `/fuel-log`, which is
 * catalogued `always` — the same widening C2 found when it absorbed two `section("fuel")` pages onto
 * that page, arriving a second time by a different route. The API refuses the roles that lack the
 * section either way (`requireSection("fuel")`, which is manage), so the failure mode would have
 * been a button that 403s rather than a data leak; an action offered and then refused is still a
 * defect, and it is what the gate assertions below are for.
 */

const session = vi.hoisted(() => ({
  role: "admin" as string | null,
  admin: true,
  can: (_s: string): boolean => true,
  canView: (_s: string): boolean => true,
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => session }));

/** One role's shoes, from the shared matrix rather than hand-set booleans. */
async function asRole(role: string) {
  const { sectionAccess, isAdmin } = await import("@silvicom/shared");
  session.role = role;
  session.admin = isAdmin(role as never);
  session.can = (s: string) => sectionAccess(role as never, s as never) === "manage";
  session.canView = (s: string) => sectionAccess(role as never, s as never) !== "none";
}

const emptyList = {
  data: ref({ rows: [], total: 0 }),
  isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false),
};
vi.mock("@/features/fuel/useFuelLog", () => ({
  FUEL_PAGE_SIZE: 20,
  useFuelTransactions: () => emptyList,
  useFuelRangeTotals: () => ({ data: ref(null) }),
  useCreateFillUp: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }),
}));
vi.mock("@/features/fuel/useEfsData", () => ({
  EFS_PAGE_SIZE: 20,
  useEfsTransactions: () => emptyList,
  useDeclinedTransactions: () => emptyList,
  useEfsFacets: () => ({ data: ref(undefined) }),
  useEfsRowCoverage: () => ({ data: ref(null) }),
}));
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: ref([]) }) }));
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: ref([]) }) }));
vi.mock("@/composables/useCardAssignments", () => ({
  useCardAssignments: () => ({ data: ref([]) }),
  maskCardRef: (r: string) => r,
}));
vi.mock("@/features/fueling/useFuelStations", () => ({
  useFuelStations: () => ({ data: ref([]), isLoading: ref(false), isError: ref(false), error: ref(null) }),
}));
vi.mock("@/features/jobs/useJob", () => ({
  useJob: () => ({
    lastDone: ref(null), failed: ref(false), freshnessLabel: ref("never run"),
    isRunning: ref(false), progressPct: ref(0), progressLabel: ref(""), refresh: vi.fn(), markRunning: vi.fn(),
  }),
}));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(async () => ({ ok: true, data: null })) }));

import FuelLogPage from "./FuelLogPage.vue";
import FuelStationsPage from "./FuelStationsPage.vue";
import DataSyncPage from "./DataSyncPage.vue";
import EfsImportDrawer from "@/features/import/EfsImportDrawer.vue";
import PriceUploadDrawer from "@/features/fueling/PriceUploadDrawer.vue";
import PriceUploadCard from "@/features/fueling/PriceUploadCard.vue";
import StationDataCard from "@/features/fueling/StationDataCard.vue";
import JobActionCard from "@/features/jobs/JobActionCard.vue";

async function mountAt(page: Component, path: string, title: string) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path, component: { template: "<div/>" }, meta: { title } }],
  });
  await router.push(path);
  await router.isReady();
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(page, {
    global: {
      plugins: [router, pinia, VueQueryPlugin],
      // The drawers themselves are asserted separately; stubbing them here would defeat the point.
      stubs: { UnitMileageDrawer: true, ActiveOverridesPanel: true },
    },
  });
  await flushPromises();
  return w;
}

type Mounted = Awaited<ReturnType<typeof mountAt>>;
const button = (w: Mounted, label: string) =>
  w.findAll("button").find((b) => b.text().trim() === label);

beforeEach(async () => { await asRole("admin"); });

describe("the EFS backfill moved to the Fuel Log's header (D-FUI3)", () => {
  it("offers it to a role that may manage fuel, and mounts the drawer behind the button", async () => {
    const w = await mountAt(FuelLogPage, "/fuel-log", "Fuel Log");
    const open = button(w, "Backfill EFS reports");
    expect(open, "no backfill action on the Fuel Log").toBeTruthy();

    const drawer = w.findComponent(EfsImportDrawer);
    expect(drawer.exists()).toBe(true);
    expect(drawer.props("open")).toBe(false);
    await open!.trigger("click");
    expect(w.findComponent(EfsImportDrawer).props("open")).toBe(true);
  });

  /**
   * ⚠ The widening the move would otherwise have caused. `accountant`, `dispatcher`, `auditor` and
   * `safety_manager` all hold `fuel: "view"` and all reach `/fuel-log`, which is catalogued `always`;
   * `recruiter` and `technician` hold `fuel: "none"` and reach it too. None of them could open
   * `/import`, and none of them may open this.
   */
  it("withholds it from every role that could not open /import", async () => {
    for (const role of ["accountant", "dispatcher", "auditor", "safety_manager", "recruiter", "technician"]) {
      await asRole(role);
      const w = await mountAt(FuelLogPage, "/fuel-log", "Fuel Log");
      expect(button(w, "Backfill EFS reports"), role).toBeFalsy();
      // Not merely hidden: a component holding a write mutation is not instantiated for them at all.
      expect(w.findComponent(EfsImportDrawer).exists(), role).toBe(false);
    }
  });

  it("still offers it to the other role that could — the fleet manager", async () => {
    await asRole("fleet_manager");
    const w = await mountAt(FuelLogPage, "/fuel-log", "Fuel Log");
    expect(button(w, "Backfill EFS reports")).toBeTruthy();
  });
});

describe("the price and locations uploads moved to Truck Stops (D-FUI3)", () => {
  it("offers one drawer to a role that may manage dispatch", async () => {
    await asRole("dispatcher");
    const w = await mountAt(FuelStationsPage, "/truck-stops", "Truck Stops");
    const open = button(w, "Upload prices");
    expect(open, "no upload action on Truck Stops").toBeTruthy();
    expect(w.findComponent(PriceUploadDrawer).props("open")).toBe(false);
    await open!.trigger("click");
    expect(w.findComponent(PriceUploadDrawer).props("open")).toBe(true);
  });

  // Truck Stops is catalogued at `section("dispatch")` VIEW, so a reader reaches the page and must
  // not be handed a write. `auditor` is the role that makes the distinction visible.
  it("withholds it from a role that may only read the page", async () => {
    await asRole("auditor");
    const w = await mountAt(FuelStationsPage, "/truck-stops", "Truck Stops");
    expect(button(w, "Upload prices")).toBeFalsy();
  });

  /**
   * BOTH cards, which is the "one Upload drawer" half of C4 — the plan is explicit that the Pilot
   * price report and the locations/posted-price card become one drawer rather than two.
   */
  it("carries both of the cards it absorbed, unchanged", () => {
    const w = mount(PriceUploadDrawer, {
      props: { open: true },
      global: { plugins: [createPinia()], stubs: { SlideOver: { template: "<div><slot /></div>" } } },
    });
    expect(w.findComponent(PriceUploadCard).exists()).toBe(true);
    expect(w.findComponent(StationDataCard).exists()).toBe(true);
  });
});

describe("Repair fuel data moved to Settings → Data & sync (D-FUI3)", () => {
  const repairCard = (w: Mounted) =>
    w.findAllComponents(JobActionCard).find((c) => c.props("kind") === "efs_store_sync");

  it("is a job-backed card on the page where the other repair actions already are", async () => {
    const w = await mountAt(DataSyncPage, "/settings/data", "Data & Sync");
    const card = repairCard(w);
    expect(card, "no Repair fuel data card on Data & sync").toBeTruthy();
    // The route it was always calling, and the job it was always creating — the old button ignored
    // the second, so a repair still re-scoring in the background looked finished.
    expect(card!.props("endpoint")).toBe("/api/transactions/sync-from-efs");
    expect(card!.props("title")).toBe("Repair fuel data");
  });

  /**
   * ⚠ It keeps `fuel` and does not inherit the page's `settings`. The two happen to be the same two
   * roles in the shipped matrix, so this cannot be caught by an admin-vs-auditor case — it needs a
   * role holding one and not the other, which is what an org override produces. The mocked session
   * is the honest way to express that: settings granted, fuel withheld.
   */
  it("asks for fuel and not for settings, so a settings-only grant is not offered a 403", async () => {
    session.role = "fleet_manager";
    session.admin = false;
    session.can = (s: string) => s === "settings";
    session.canView = () => true;
    const w = await mountAt(DataSyncPage, "/settings/data", "Data & Sync");
    expect(repairCard(w)).toBeFalsy();

    session.can = (s: string) => s === "settings" || s === "fuel";
    const withFuel = await mountAt(DataSyncPage, "/settings/data", "Data & Sync");
    expect(repairCard(withFuel)).toBeTruthy();
  });
});

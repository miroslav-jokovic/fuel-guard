import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { flushPromises, mount, RouterLinkStub, type VueWrapper } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";

/**
 * Notes where the office meets them (UNIT-NOTES-PLAN D-UN12, D-UN14): the Vehicles list's Notes column —
 * count and age, a quiet "Add", a click that opens the drawer through the URL — and the detail page's
 * Notes button; each only for a viewer holding the `notes` surface, and the counts asked ONCE per table
 * and again when the table's own list refreshes (D-UN10). Trailers and Drivers place the same column
 * with the same `withNotesColumn` and the same cell (`notesColumn.test.ts`).
 */
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));
const who = vi.hoisted(() => ({ role: "admin" }));
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = Object.assign(fakeSession("admin"), { isAuthenticated: true, orgId: null });
  return { useSessionStore: () => Object.assign(s, { role: who.role }) };
});
vi.mock("@/composables/useModules", async () => {
  const { computed } = await import("vue");
  return { useModulesQuery: () => ({ data: computed(() => new Set<string>()) }) };
});
const listStamp = ref(1);
const idle = () => ({ isPending: ref(false), mutateAsync: vi.fn() });
vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => ({
    data: ref([
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", unit_number: "1042", status: "active" },
      { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", unit_number: "1043", status: "active" },
    ]),
    isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false), dataUpdatedAt: listStamp,
  }),
  useCreateVehicle: idle, useUpdateVehicle: idle, useRetireVehicle: idle, useBulkUpdateVehicles: idle,
}));
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: ref([]) }) }));
vi.mock("@/composables/useCompliance", () => ({ useUnitFilesQuery: () => ({ data: ref({ units: [] }) }), useDocumentsQuery: () => ({ data: ref([]) }) }));
vi.mock("@/composables/useOrgTimezone", () => ({ useOrgTimezone: () => ({ zone: ref("America/Chicago"), isResolved: ref(true) }) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/ui/PageHeader.vue", () => ({ default: { template: "<header><slot name='actions' /></header>" } }));
vi.mock("@/components/RosterFreshnessLine.vue", () => ({ default: { template: "<span />" } }));
vi.mock("@/features/roster/VehicleSetupImport.vue", () => ({ default: { template: "<span />" } }));

const VehiclesPage = (await import("@/pages/VehiclesPage.vue")).default;
const NotesButton = (await import("./NotesButton.vue")).default;

const VEH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let router: Router;
const mounted: VueWrapper[] = [];
async function render(component: unknown, props: Record<string, unknown> = {}) {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/vehicles", component: { template: "<div/>" } }] });
  await router.push("/vehicles");
  await router.isReady();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Host = defineComponent({ setup: () => () => h(component as never, props) });
  const w = mount(Host, { attachTo: document.body, global: { plugins: [router, [VueQueryPlugin, { queryClient: client }]], stubs: { RouterLink: RouterLinkStub } } });
  mounted.push(w);
  await flushPromises();
  return w;
}
/** The columns the page hands its table — jsdom is narrow, so the table draws cards, not `<th>`s. */
const columnKeys = (w: VueWrapper) => (w.findComponent({ name: "DataTable" }).props("columns") as { key: string }[]).map((c) => c.key);
const summaryCalls = () => apiFetch.mock.calls.map((c) => String(c[0])).filter((p) => p.startsWith("/api/notes/summary"));

beforeEach(() => {
  setActivePinia(createPinia());
  who.role = "admin";
  listStamp.value = 1;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-11T18:00:00Z"));
  apiFetch.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/notes/summary")) return { ok: true, status: 200, data: { kinds: { vehicle: { [VEH]: { count: 3, lastAt: "2026-11-09T12:00:00Z" } } } } };
    return { ok: true, status: 200, data: { notes: [], fuzzy: false, next: null, people: [] } };
  });
});
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
  apiFetch.mockReset();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("the Vehicles list's Notes column", () => {
  it("shows the count and age, a quiet Add on a truck with none, right after File", async () => {
    const w = await render(VehiclesPage);
    const keys = columnKeys(w);
    expect(keys.indexOf("notes")).toBe(keys.indexOf("file") + 1);
    const cells = w.findAll("[data-notes-cell]");
    expect(cells.map((c) => c.text().replace(/\s+/g, " "))).toEqual(["3 2 d ago", "Add"]);
    expect(summaryCalls()).toEqual(["/api/notes/summary?kinds=vehicle"]);
  });

  it("opens the truck's drawer through the URL", async () => {
    const w = await render(VehiclesPage);
    await w.find("[data-notes-cell]").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.notes).toBe(`vehicle:${VEH}`);
    expect(document.body.querySelector("[data-notes-drawer]")).not.toBeNull();
    expect(document.body.textContent).toContain("Notes · Truck 1042");
  });

  it("is not there at all — and nothing is asked — for a viewer without the notes surface (the driver role)", async () => {
    who.role = "driver";
    const w = await render(VehiclesPage);
    expect(columnKeys(w)).toContain("file");
    expect(columnKeys(w)).not.toContain("notes");
    expect(w.find("[data-notes-cell]").exists()).toBe(false);
    expect(apiFetch.mock.calls.filter((c) => String(c[0]).startsWith("/api/notes"))).toEqual([]);
  });

  it("asks for the counts again when the list itself refreshes, and not before", async () => {
    listStamp.value = 0; // the list has not loaded yet
    await render(VehiclesPage);
    expect(summaryCalls()).toHaveLength(1);
    listStamp.value = 1; // its first load: the counts are already being asked for alongside it
    await flushPromises();
    expect(summaryCalls()).toHaveLength(1);
    listStamp.value = 2;
    await flushPromises();
    expect(summaryCalls()).toHaveLength(2);
  });
});

describe("the detail page's Notes button", () => {
  it("names the count and opens the unit's drawer", async () => {
    const w = await render(NotesButton, { kind: "vehicle", id: VEH, label: "1042" });
    const b = w.find("[data-notes-button]");
    expect(b.text().replace(/\s+/g, " ")).toBe("Notes 3");
    await b.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.notes).toBe(`vehicle:${VEH}`);
  });

  it("is not offered to a viewer without the notes surface (the driver role)", async () => {
    who.role = "driver";
    const w = await render(NotesButton, { kind: "vehicle", id: VEH, label: "1042" });
    expect(w.find("[data-notes-button]").exists()).toBe(false);
  });
});

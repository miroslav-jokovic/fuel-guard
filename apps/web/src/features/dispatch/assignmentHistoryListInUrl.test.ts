import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { createPinia } from "pinia";
import { computed, ref, type Ref } from "vue";
import type { AssignmentHistoryFilters } from "./useAssignments";

/**
 * D-US2 (UI-STANDARDIZATION, 2026-10-12) — the Assignment history tab keeps its filters in the URL.
 *
 * What only this list has: it shares `/assignments` with the dispatch board, so every key is scoped
 * `history.` and the board's own `?search=` is never read as a history filter; and it OPENS on the
 * last seven days, a default that stays out of the URL and that Clear filters returns to.
 */

const DRIVER = "11111111-1111-4111-8111-111111111111";
const TRUCK = "22222222-2222-4222-8222-222222222222";
const asked = vi.hoisted(() => ({ filters: null as null | { value: unknown } }));
// The keyset walk, held here so a test can serve pages: `pages` is what the infinite query has fetched,
// `next` the pages the server still has, handed over one per `fetchNextPage`.
const walk = await vi.hoisted(async () => {
  const { ref } = await import("vue");
  return { pages: ref<{ segments: unknown[]; nextCursor: string | null }[]>([]), next: [] as { segments: unknown[]; nextCursor: string | null }[] };
});

vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: ref([{ id: DRIVER, full_name: "Pete Ross" }]) }) }));
vi.mock("@/composables/useVehicles", () => ({ useVehiclesQuery: () => ({ data: ref([{ id: TRUCK, unit_number: "773" }]) }) }));
vi.mock("@/composables/useTrailers", () => ({ useTrailersQuery: () => ({ data: ref([]) }) }));
vi.mock("@/features/dispatch/useAssignments", async (orig) => ({
  ...(await orig<typeof import("./useAssignments")>()),
  useAssignmentHistoryQuery: (filters: Ref<AssignmentHistoryFilters>) => {
    asked.filters = filters;
    return {
      data: computed(() => ({ pages: walk.pages.value })), isLoading: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false),
      hasNextPage: computed(() => walk.next.length > 0 && walk.pages.value.length > 0), isFetchingNextPage: ref(false), refetch: vi.fn(),
      fetchNextPage: vi.fn(async () => {
        const page = walk.next.shift();
        if (page) walk.pages.value = [...walk.pages.value, page];
      }),
    };
  },
}));
vi.mock("@vueuse/core", async (orig) => ({ ...((await orig()) as object), useMediaQuery: () => ref(true) }));

import AssignmentHistory from "./AssignmentHistory.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";

const filters = () => (asked.filters as Ref<AssignmentHistoryFilters>).value;
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function mountAt(url: string) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/assignments", component: { template: "<div/>" } }],
  });
  await router.push(url);
  await router.isReady();
  const w = mount(AssignmentHistory, { global: { plugins: [router, createPinia()] } });
  await flushPromises();
  return { w, query: () => router.currentRoute.value.query };
}
type Mounted = Awaited<ReturnType<typeof mountAt>>["w"];
const driver = (w: Mounted) => w.findAllComponents(FilterSelect).find((c) => c.props("label") === "Driver")!;

describe("Assignment history keeps its filters in the URL", () => {
  it("opens on the last seven days with nothing in the URL", async () => {
    const { query } = await mountAt("/assignments?queue=history");
    expect(filters().from).toBe(iso(new Date(Date.now() - 7 * 86_400_000)));
    expect(filters().to).toBe(iso(new Date()));
    expect(query()).toEqual({ queue: "history" });
  });

  it("reads a pasted link's window and driver, and ignores the board's own search", async () => {
    const { w } = await mountAt(`/assignments?queue=history&search=773&history.from=2026-09-01&history.to=2026-09-03&history.driver=${DRIVER}`);
    expect(filters()).toEqual({ from: "2026-09-01", to: "2026-09-03", driverId: DRIVER });
    expect(driver(w).props("modelValue")).toBe(DRIVER);
    expect(w.findComponent(DateRangeFilter).props("from")).toBe("2026-09-01");
  });

  it("reads a date that is not a real day as the opening week", async () => {
    await mountAt("/assignments?history.from=2026-02-31");
    expect(filters().from).toBe(iso(new Date(Date.now() - 7 * 86_400_000)));
  });

  it("writes a control change under its own scope, and Clear filters leaves the board's keys alone", async () => {
    const { w, query } = await mountAt("/assignments?queue=history&sort=unit&dir=desc");
    driver(w).vm.$emit("update:modelValue", DRIVER);
    w.findComponent(DateRangeFilter).vm.$emit("update:from", "2026-09-01");
    w.findComponent(DateRangeFilter).vm.$emit("update:to", "2026-09-05");
    await flushPromises();
    expect(query()).toEqual({
      queue: "history", sort: "unit", dir: "desc",
      "history.driver": DRIVER, "history.from": "2026-09-01", "history.to": "2026-09-05",
    });

    w.findComponent({ name: "FilterBar" }).vm.$emit("clear-all");
    await flushPromises();
    expect(query()).toEqual({ queue: "history", sort: "unit", dir: "desc" });
  });
});

/**
 * D-US8: Prev/Next over the keyset walk, in place of "Load more". Page N is the Nth page fetched; Next
 * past the last one asks the server, Prev re-reads a page held. The page stays OUT of the URL (Q-US2):
 * a reload has no cursor to stand on.
 */
describe("Assignment history pages over its cursor", () => {
  const segment = (n: number) => ({
    session_id: `s${n}`, segment_id: `seg-${n}`, driver_id: DRIVER, driver_name: `Driver ${n}`, vehicle_id: null, vehicle_unit: null,
    trailer_id: null, trailer_unit: null, seat: "driver", confirmed_by: "driver", session_source: "app", from_at: "2026-10-01T12:00:00Z", to_at: null,
  });
  const serverPage = (start: number, size: number, nextCursor: string | null) =>
    ({ segments: Array.from({ length: size }, (_, i) => segment(start + i)), nextCursor });
  const names = (w: Mounted) => w.findAll("tbody tr").map((tr) => tr.find("td").text());
  const press = async (w: Mounted, label: string) => {
    await w.findAll("button").find((b) => b.text() === label)!.trigger("click");
    await flushPromises();
  };

  it("walks forward a server page at a time, back without asking, and never writes the page", async () => {
    walk.pages.value = [serverPage(1, 50, "c1")];
    walk.next = [serverPage(51, 7, null)];
    const { w, query } = await mountAt("/assignments?queue=history");
    expect(names(w)).toHaveLength(50);
    expect(names(w)[0]).toBe("Driver 1");
    expect(w.text()).not.toContain("Load more");

    await press(w, "Next");
    expect(names(w)).toEqual(Array.from({ length: 7 }, (_, i) => `Driver ${51 + i}`));
    expect(w.text()).toContain("Showing 51–57");
    expect(w.findAll("button").find((b) => b.text() === "Next")!.attributes("disabled")).toBeDefined();
    expect(query()).toEqual({ queue: "history" });

    await press(w, "Prev");
    expect(names(w)[0]).toBe("Driver 1");
    expect(walk.pages.value).toHaveLength(2);
  });

  it("starts again at page 1 when a filter changes", async () => {
    walk.pages.value = [serverPage(1, 50, "c1")];
    walk.next = [serverPage(51, 7, null)];
    const { w } = await mountAt("/assignments?queue=history");
    await press(w, "Next");
    expect(names(w)[0]).toBe("Driver 51");
    driver(w).vm.$emit("update:modelValue", DRIVER);
    await flushPromises();
    expect(names(w)[0]).toBe("Driver 1");
  });
});

import { describe, it, expect, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { ref } from "vue";

/**
 * D-US2 (2026-10-12) — the attention tiles and the fleet table share ONE filter model, the URL.
 *
 * Until that day the page held the tiles' filter in two refs and the table mirrored them into the
 * URL through four watches. Now the page reads `state` and `due` through `useQueryState` and the
 * table reads the same two keys, so a tile click is a URL write and a pasted link lights its tile
 * with nothing in between to fall out of step.
 */

const overview = ref({
  drivers: [
    {
      driver_id: "e", driver_name: "Ellen Expired", driver_status: "active", state: "in_progress",
      counts: { expired: 1, expiring: 0, missing: 0, current: 3 }, soonest: -5, attention: [],
    },
  ],
  includesHazmat: true,
  truncated: false,
});
vi.mock("@/composables/useCompliance", () => ({
  useComplianceOverviewQuery: () => ({ data: overview, isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false) }),
  useCertificationsQuery: () => ({ data: ref([]), isLoading: ref(false), isError: ref(false) }),
}));
vi.mock("@/composables/useDqExports", () => ({ useRequestBinder: () => ({ mutateAsync: vi.fn(), isPending: ref(false) }) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ restrictedAccess: false, orgId: "o", can: () => false, canView: () => true }) }));

import CompliancePage from "./CompliancePage.vue";
import StatCard from "@/components/ui/StatCard.vue";

async function mountAt(url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:any(.*)*", component: { template: "<div/>" }, meta: { title: "Qualification" } }] });
  await router.push(url);
  await router.isReady();
  const w = mount(CompliancePage, {
    global: { plugins: [router], stubs: { QualificationFleetTable: true, ExportHistory: true, CertManager: true, SlideOver: true } },
  });
  await flushPromises();
  return { w, query: () => router.currentRoute.value.query };
}
const tile = (w: Awaited<ReturnType<typeof mountAt>>["w"], label: string) =>
  w.findAllComponents(StatCard).find((c) => c.props("label") === label)!;

describe("the qualification page's tiles write and read the URL", () => {
  it("lights the tile a pasted link names", async () => {
    const { w } = await mountAt("/compliance?state=expired");
    expect(tile(w, "Expired").props("pressed")).toBe(true);
    expect(tile(w, "Due in 30 days").props("pressed")).toBe(false);
  });

  it("writes a tile's filter to the URL, and a second click takes it off", async () => {
    const { w, query } = await mountAt("/compliance");
    tile(w, "Due in 30 days").vm.$emit("toggle");
    await flushPromises();
    expect(query()).toMatchObject({ due: "30" });
    expect(query().state).toBeUndefined();

    tile(w, "Due in 30 days").vm.$emit("toggle");
    await flushPromises();
    expect(query().due).toBeUndefined();
  });

  it("opens on the view a link names", async () => {
    const { w } = await mountAt("/compliance?tab=exports");
    expect(w.findComponent({ name: "ExportHistory" }).exists()).toBe(true);
  });
});

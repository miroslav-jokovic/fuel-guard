import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { AnomalyFilters } from "@/features/anomalies/useAnomalies";

/**
 * FUEL-C3, D-FUI8 — Alerts is sendable, and `?vehicle=` is now WRITTEN as well as read.
 *
 * ── THE HALF-ADOPTED SHAPE THIS FINISHES ────────────────────────────────────────────────────────
 * `/anomalies?vehicle=<id>` was already a deep link: a flagged row on the Fuel Log sends a reviewer
 * here. But it was read ONCE at setup and never written back, so the moment the reviewer changed the
 * truck in the picker the address bar described a different screen than the one in front of them.
 * Seeding from a link is not the same capability as producing one, and C3 is where the second half
 * lands.
 *
 * ── ⚠ AND THE PART THAT IS EASY TO BREAK WHILE DOING IT ─────────────────────────────────────────
 * An absent `status` means two different things on this page. With no truck it means the WORK QUEUE
 * (`open`); with a truck it means that truck's whole history, resolved cases included, because a
 * reviewer following a link to a case must see it even if somebody has already closed it. So "the
 * reader chose All" cannot also be absence — it is `status=all`. Three states, three spellings, and
 * this file is what stops a later refactor collapsing them back to two.
 */

const seen = vi.hoisted(() => ({ filters: null as { value: AnomalyFilters } | null }));

const anomalyRow = {
  id: "a1", org_id: "o1", vehicle_id: "v-654", transaction_id: null, rule_id: "fuel.theft",
  severity: "high", status: "open", message: "Possible theft", created_at: "2026-08-15T14:00:00Z",
  fueled_at: "2026-08-15T14:00:00Z", version: 1,
};

vi.mock("@/features/anomalies/useAnomalies", () => ({
  useAnomaliesQuery: (f: { value: AnomalyFilters }) => {
    seen.filters = f;
    return {
      data: ref([anomalyRow]),
      isLoading: ref(false), isError: ref(false), error: ref(null), refetch: vi.fn(), isFetching: ref(false),
    };
  },
  useAnomalyTransition: () => ({ mutateAsync: vi.fn() }),
  useAnomalyTxnDrivers: () => ({ data: ref({}) }),
}));
vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => ({ data: ref([{ id: "v-654", unit_number: "654" }, { id: "v-999", unit_number: "999" }]) }),
}));
vi.mock("@/composables/useTrailers", () => ({ useTrailersQuery: () => ({ data: ref([]) }) }));
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => ({ data: ref([]) }) }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => true, canView: () => true, admin: true }) }));
// See the other C3 suites: without the desktop breakpoint `DataTable` renders as cards and there is
// no `<th>` at all, so a header-click assertion would pass by finding nothing to click.
vi.mock("@vueuse/core", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useMediaQuery: () => ref(true) };
});

import AnomaliesPage from "./AnomaliesPage.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";

async function mountAt(url: string) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/anomalies", component: { template: "<div/>" }, meta: { title: "Alerts" } }],
  });
  await router.push(url);
  await router.isReady();
  const pinia = createPinia();
  setActivePinia(pinia);
  const w = mount(AnomaliesPage, { global: { plugins: [router, pinia] } });
  await flushPromises();
  return { w, router, query: () => router.currentRoute.value.query };
}

type Mounted = Awaited<ReturnType<typeof mountAt>>["w"];
const at = (w: Mounted, label: string) => {
  const control = w.findAllComponents(FilterSelect).find((c) => c.props("label") === label);
  expect(control, `no "${label}" filter on this page`).toBeTruthy();
  return control!;
};
const pick = async (w: Mounted, label: string, value: string) => {
  at(w, label).vm.$emit("update:modelValue", value);
  await flushPromises();
};
const settle = () => flushPromises();

beforeEach(() => { seen.filters = null; });

describe("the Alerts page's filters round-trip through the query string", () => {
  it("writes the truck back, which is the half the deep link never had", async () => {
    const { w, query } = await mountAt("/anomalies");
    expect(query().vehicle).toBeUndefined();
    await pick(w, "Unit", "v-999");
    expect(query().vehicle).toBe("v-999");
    expect(seen.filters?.value.vehicleId).toBe("v-999");
  });

  it("puts severity in the URL and refuses one that is not a severity", async () => {
    const { w, query } = await mountAt("/anomalies");
    await pick(w, "Severity", "critical");
    expect(query().severity).toBe("critical");
    expect(seen.filters?.value.severity).toBe("critical");

    await mountAt("/anomalies?severity=apocalyptic");
    expect(seen.filters?.value.severity).toBeUndefined();
  });

  /**
   * ⚠ The two-`v-model`-in-one-tick case. `DateRangeFilter` emits `update:from` and `update:to` back
   * to back; without `useQueryState`'s buffer the second navigation reads the pre-change query and
   * drops the first, which is exactly how the spend page's picker came to look welded to 90 days.
   */
  it("keeps both ends of a window set in one tick", async () => {
    const { w, query } = await mountAt("/anomalies");
    const picker = w.findComponent(DateRangeFilter);
    picker.vm.$emit("update:from", "2026-08-01");
    picker.vm.$emit("update:to", "2026-08-31");
    await settle();
    expect(query()).toMatchObject({ from: "2026-08-01", to: "2026-08-31" });
    expect(seen.filters?.value.from).toBe("2026-08-01");
    expect(seen.filters?.value.to).toBe("2026-08-31");
  });

  it("keeps the reefer view in the URL, so the tab is part of the link", async () => {
    const { w, query } = await mountAt("/anomalies");
    expect(seen.filters?.value.reeferOnly).toBeUndefined();
    const reefer = w.findAll("button").find((b) => b.text().trim() === "Reefer fueling");
    await reefer!.trigger("click");
    await settle();
    expect(query().reefer).toBe("1");
    expect(seen.filters?.value.reeferOnly).toBe(true);

    await mountAt("/anomalies?reefer=1");
    expect(seen.filters?.value.reeferOnly).toBe(true);
  });
});

/**
 * The three states of `status`, which is where this page's deep link and its filter bar meet.
 */
describe("Alerts keeps the deep link's meaning while making the status filter linkable", () => {
  it("shows the work queue when nothing is asked for", async () => {
    await mountAt("/anomalies");
    expect(seen.filters?.value.status).toBe("open");
  });

  it("shows a linked truck's WHOLE history, resolved cases included", async () => {
    await mountAt("/anomalies?vehicle=v-654");
    expect(seen.filters?.value.vehicleId).toBe("v-654");
    // Not "open": the case somebody was sent to look at may already have been closed.
    expect(seen.filters?.value.status).toBeUndefined();
  });

  it("distinguishes the reader choosing All from the URL saying nothing", async () => {
    const { w, query } = await mountAt("/anomalies");
    expect(seen.filters?.value.status).toBe("open");

    // "" is what the "All (active)" option is worth to the control; `all` is what it is worth in a URL.
    await pick(w, "Status", "");
    expect(query().status).toBe("all");
    expect(seen.filters?.value.status).toBeUndefined();

    await mountAt("/anomalies?status=all");
    expect(seen.filters?.value.status).toBeUndefined();
  });

  it("carries an explicitly chosen status, and refuses one that is not a status", async () => {
    const { w, query } = await mountAt("/anomalies");
    await pick(w, "Status", "investigating");
    expect(query().status).toBe("investigating");
    expect(seen.filters?.value.status).toBe("investigating");

    await mountAt("/anomalies?status=whenever");
    expect(seen.filters?.value.status).toBe("open");
  });

  /**
   * `Clear filters` clears the parameter rather than writing `open` into it. That is what makes it
   * correct from BOTH entry points: the truck goes too, so absence resolves to the work queue either
   * way, and the URL is left saying nothing rather than saying the default out loud.
   */
  it("returns to the work queue from a truck link, leaving no parameters behind", async () => {
    const { w, query } = await mountAt("/anomalies?vehicle=v-654&severity=high&from=2026-08-01");
    const clear = w.findAll("button").find((b) => b.text().trim() === "Clear filters");
    expect(clear, "no Clear filters button — it only renders when a filter is active").toBeTruthy();
    await clear!.trigger("click");
    await settle();

    expect(seen.filters?.value.status).toBe("open");
    for (const key of ["vehicle", "severity", "from", "status"]) expect(query()[key], key).toBeUndefined();
  });
});

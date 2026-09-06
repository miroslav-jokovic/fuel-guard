import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { createPinia } from "pinia";
import { ref } from "vue";

/**
 * FUEL-C3, D-FUI8 — the card inventory survives a refresh and can be pasted into a ticket.
 *
 * ── WHY THIS PAGE PARTICULARLY ──────────────────────────────────────────────────────────────────
 * "Which cards can currently buy fuel outside their limits" is the question an auditor opens this
 * page to answer, and it is `?override=active` — one filter, one link. Until this step it was a
 * screenshot: nine `ref("")`s, nothing in the address bar, and a refresh mid-audit lost the lot.
 *
 * ⚠ **A `ref` could only ever hold what its own dropdown offered; a URL parameter holds whatever
 * somebody typed.** `status` is forwarded to the vendor-facing API as a filter, so it is checked
 * against `EFS_CARD_STATUSES` — the shared catalogue rather than a list retyped on this page — and
 * the three yes/no facets against their own two values. That check did not need to exist while the
 * value could only come from a click; it does now.
 */

const seenQuery: Array<{ search: string; status: string }> = [];

vi.mock("@/features/fuelCards/useEfsCards", () => ({
  useEfsCards: (f: { search: { value: string }; status: { value: string } }) => {
    // The route filters, captured live: `search` and `status` are the two the API applies, and a
    // link that changed neither would be a link that changed nothing.
    seenQuery.push({ get search() { return f.search.value; }, get status() { return f.status.value; } } as never);
    return {
      data: ref({
        cards: [
          { id: "c1", maskedRef: "••1234", last4: "1234", status: "Active", driverName: "Ann Lee", unitPrompt: "101", driverIdPrompt: "7", policyNumber: 3, overrideUses: 2, fuelCardId: "f1", syncError: null, syncedAt: new Date().toISOString(), absentSince: null, capabilities: {}, limits: [] },
          { id: "c2", maskedRef: "••5678", last4: "5678", status: "Hold", driverName: "Bo Ray", unitPrompt: "202", driverIdPrompt: "8", policyNumber: 4, overrideUses: 0, fuelCardId: null, syncError: "boom", syncedAt: new Date().toISOString(), absentSince: null, capabilities: {}, limits: [] },
        ],
        staleAfterMinutes: 1440,
        truncated: false,
      }),
      isLoading: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false), refetch: () => {},
    };
  },
}));
vi.mock("@/features/jobs/useJob", () => ({
  useJob: () => ({ latest: ref(null), lastDone: ref(null), isRunning: ref(false), refetch: () => {} }),
}));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(async () => ({ ok: true, data: null })) }));
// `DataTable` swaps to a card layout below 768px and jsdom reports no `matchMedia` at all, so
// without this there is no `<tbody>` and every row count below is 0 — passing or failing for a
// reason that has nothing to do with filters. The desktop breakpoint is stubbed.
vi.mock("@vueuse/core", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useMediaQuery: () => ref(true) };
});

import FuelCardsPage from "./FuelCardsPage.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import FilterBar from "@/components/ui/FilterBar.vue";

async function mountAt(url: string) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/fuel-cards", component: { template: "<div/>" }, meta: { title: "Fuel Cards" } }],
  });
  await router.push(url);
  await router.isReady();
  seenQuery.length = 0;
  const w = mount(FuelCardsPage, {
    global: {
      plugins: [router, VueQueryPlugin, createPinia()],
      stubs: { ActiveOverridesPanel: true, UnitMileageDrawer: true, KebabMenu: true },
    },
  });
  await flushPromises();
  return { w, router, query: () => router.currentRoute.value.query };
}

type Mounted = Awaited<ReturnType<typeof mountAt>>["w"];
const pick = async (w: Mounted, label: string, value: string) => {
  const control = w.findAllComponents(FilterSelect).find((c) => c.props("label") === label);
  expect(control, `no "${label}" filter on this page`).toBeTruthy();
  control!.vm.$emit("update:modelValue", value);
  await flushPromises();
};
/** How many card rows the table is showing — the client-side facets are what this proves. */
const rowCount = (w: Mounted) => w.findAll("tbody tr").length;
const settle = () => flushPromises();

describe("the fuel cards page's filters round-trip through the query string", () => {
  it("puts a server-side facet in the URL and sends it to the route", async () => {
    const { w, query } = await mountAt("/fuel-cards");
    await pick(w, "Status", "Hold");
    expect(query().status).toBe("Hold");
    expect(seenQuery[0]!.status).toBe("Hold");
  });

  // Driver rather than Exception, because the secondary facets live behind FilterBar's "Filters"
  // popover and are not in the DOM until it opens. `override` is covered by the link below, which is
  // the direction that matters for it anyway.
  it("puts a client-side facet in the URL and narrows the table with it", async () => {
    const { w, query } = await mountAt("/fuel-cards");
    expect(rowCount(w)).toBe(2);
    await pick(w, "Driver", "Bo Ray");
    expect(query().driver).toBe("Bo Ray");
    expect(rowCount(w)).toBe(1);
  });

  it("reads a link back without the reader touching a control — the auditor's one link", async () => {
    const { w } = await mountAt("/fuel-cards?override=active");
    expect(rowCount(w)).toBe(1);
    expect(w.text()).toContain("••1234");
  });

  /**
   * ⚠ The check that only became necessary when the value stopped coming from a click. `status` is
   * passed to `/api/fuel-cards` as a vendor filter; a value outside the shared catalogue reads as no
   * choice at all rather than being forwarded.
   */
  it("refuses a status that is not in the shared EFS catalogue", async () => {
    await mountAt("/fuel-cards?status=Whatever");
    expect(seenQuery[0]!.status).toBe("");
  });

  /**
   * ⚠ Asserted on the CHIP and not on the row count, because the row count cannot tell the two
   * outcomes apart: `override=perhaps` matches neither of the two branches in the row filter either
   * way, so the list is unnarrowed whether the value was refused or merely not understood. What
   * differs is what the page CLAIMS — without the vocabulary the bar renders "Exception: None" over
   * a list that has not been narrowed, which is a filter chip describing a filter that is not on.
   */
  it("refuses a yes/no facet whose value is neither, and claims no filter it did not apply", async () => {
    const { w } = await mountAt("/fuel-cards?override=perhaps&linked=maybe&health=fine");
    expect(rowCount(w)).toBe(2);
    expect(w.findComponent(FilterBar).props("chips")).toEqual([]);
  });

  /**
   * The two-writes-in-one-tick guarantee, in the form this page can hit it: two facets changed
   * before the router has settled. Without `useQueryState`'s buffer the second `replace` reads the
   * pre-change query and drops the first — silently, and only when a reader moves quickly.
   */
  it("keeps two facets set in the same tick", async () => {
    const { w, query } = await mountAt("/fuel-cards");
    const at = (label: string) => w.findAllComponents(FilterSelect).find((c) => c.props("label") === label)!;
    at("Status").vm.$emit("update:modelValue", "Hold");
    at("Driver").vm.$emit("update:modelValue", "Bo Ray");
    await settle();
    expect(query()).toMatchObject({ status: "Hold", driver: "Bo Ray" });
  });

  it("sorts by a column, in the URL, and keeps the sort when the filters are cleared", async () => {
    const { w, query } = await mountAt("/fuel-cards?override=active&driver=Ann%20Lee");
    const header = w.findAll("th button").find((b) => b.text().trim().startsWith("Driver"));
    await header!.trigger("click");
    await settle();
    expect(query()).toMatchObject({ sort: "driverName", dir: "asc" });

    w.findComponent(FilterBar).vm.$emit("clearAll");
    await settle();
    expect(query().override).toBeUndefined();
    expect(query().driver).toBeUndefined();
    // The sort survives: it is how the list is ordered, not how it is narrowed.
    expect(query().sort).toBe("driverName");
  });

  /**
   * ⚠ The fixture is built so the two outcomes are DISTINGUISHABLE, which the obvious version of
   * this test is not: an unrecognised key falls through `value()`'s `default` to `last4`, so with
   * `dir=desc` an accepted `fueled_at` would put ••5678 on top. The default order — both cards are
   * assigned, so the tiebreak is card order ascending — puts ••1234 there. One row apart, and the
   * assertion fails if the vocabulary is dropped.
   */
  it("falls back to the default order when a link names a column this table does not sort by", async () => {
    const sorted = await mountAt("/fuel-cards?sort=driverName&dir=desc");
    expect(sorted.w.findAll("tbody tr")[0]!.text()).toContain("Bo Ray");

    const { w } = await mountAt("/fuel-cards?sort=fueled_at&dir=desc");
    expect(w.findAll("tbody tr").length).toBe(2);
    expect(w.findAll("tbody tr")[0]!.text()).toContain("••1234");
  });
});

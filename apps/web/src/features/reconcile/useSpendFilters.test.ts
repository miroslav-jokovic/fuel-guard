import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { useSpendFilters, DEFAULT_DAYS } from "./useSpendFilters";

/**
 * The regression these exist for shipped to production and looked like a broken control rather than a
 * bug: the fuel-spend date picker was permanently stuck on the last 90 days. Picking a range appeared
 * to do nothing at all.
 *
 * The cause was that `router.replace` is asynchronous. `DateRangeFilter` emits `update:from` and
 * `update:to` in the same tick, both setters read the same not-yet-updated `route.query`, and the
 * second navigation overwrote the first — so `to` was applied, `from` was silently dropped, and the
 * getter fell back to its 90-day default. Nothing threw, and both halves worked in isolation, which is
 * why unit tests that set one filter at a time all passed.
 */
async function mountFilters(): Promise<{ f: ReturnType<typeof useSpendFilters>; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/fuel-reconciliation", component: { template: "<div/>" } }],
  });
  let f!: ReturnType<typeof useSpendFilters>;
  const C = defineComponent({
    setup() {
      f = useSpendFilters();
      return () => h("div");
    },
  });
  await router.push("/fuel-reconciliation");
  await router.isReady();
  mount(C, { global: { plugins: [router] } });
  return { f, router };
}

/**
 * Drain the microtask queue completely. `nextTick()` is not enough: a vue-router navigation resolves
 * through several promise links, so a fixed number of ticks reads the URL before the router has
 * finished with it and every assertion below passes or fails for the wrong reason.
 */
const settle = () => flushPromises();

describe("useSpendFilters", () => {
  it("keeps BOTH halves of a date range set in one tick", async () => {
    const { f, router } = await mountFilters();
    f.from.value = "2026-08-01";
    f.to.value = "2026-08-20";
    await settle();

    expect(f.from.value).toBe("2026-08-01");
    expect(f.to.value).toBe("2026-08-20");
    // …and both must reach the URL, or the view cannot be linked or refreshed.
    expect(router.currentRoute.value.query.from).toBe("2026-08-01");
    expect(router.currentRoute.value.query.to).toBe("2026-08-20");
  });

  it("reads back the new range immediately, without waiting a tick for the router", async () => {
    const { f } = await mountFilters();
    f.from.value = "2026-08-01";
    f.to.value = "2026-08-20";
    // No await: a control bound to these must not flash the old value between emit and navigation.
    expect(f.range.value).toEqual({ from: "2026-08-01", to: "2026-08-20" });
  });

  it("does not lose a filter of a different kind set in the same tick", async () => {
    const { f, router } = await mountFilters();
    f.from.value = "2026-08-01";
    f.vehicleIds.value = ["a", "b"];
    f.grain.value = "day";
    await settle();

    expect(router.currentRoute.value.query.from).toBe("2026-08-01");
    expect(router.currentRoute.value.query.trucks).toBe("a,b");
    expect(router.currentRoute.value.query.grain).toBe("day");
  });

  it("falls back to the default window only when the URL really carries no dates", async () => {
    const { f } = await mountFilters();
    expect(f.from.value).toBe(
      new Date(Date.now() - DEFAULT_DAYS * 86_400_000).toISOString().slice(0, 10),
    );
    expect(f.active.value).toBe(false);
  });

  it("reports the filters as active once a range is applied", async () => {
    const { f } = await mountFilters();
    f.from.value = "2026-08-01";
    f.to.value = "2026-08-20";
    await settle();
    expect(f.active.value).toBe(true);
  });

  it("clears every narrowing filter at once and returns to the default window", async () => {
    const { f, router } = await mountFilters();
    f.from.value = "2026-08-01";
    f.to.value = "2026-08-20";
    f.vehicleIds.value = ["a"];
    await settle();

    f.reset();
    await settle();
    expect(router.currentRoute.value.query.from).toBeUndefined();
    expect(router.currentRoute.value.query.to).toBeUndefined();
    expect(router.currentRoute.value.query.trucks).toBeUndefined();
    expect(f.active.value).toBe(false);
  });

  it("keeps the tab when the dates change, so the reader is not thrown back to the first one", async () => {
    const { f, router } = await mountFilters();
    f.tab.value = "discount";
    f.from.value = "2026-08-01";
    f.to.value = "2026-08-20";
    await settle();
    expect(router.currentRoute.value.query.tab).toBe("discount");
    expect(router.currentRoute.value.query.from).toBe("2026-08-01");
  });

  it("sends the whole window to the server, not just the half that survived", async () => {
    const { f } = await mountFilters();
    f.from.value = "2026-08-01";
    f.to.value = "2026-08-20";
    await settle();
    const q = new URLSearchParams(f.asQuery.value);
    expect(q.get("from")).toBe("2026-08-01");
    expect(q.get("to")).toBe("2026-08-20");
  });
});

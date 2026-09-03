import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { useSpendFilters } from "./useSpendFilters";
import { defaultWindow } from "@silvicom/shared";

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
async function mountFilters(url = "/fuel-spend"): Promise<{ f: ReturnType<typeof useSpendFilters>; router: Router }> {
  let f!: ReturnType<typeof useSpendFilters>;
  // The one component in this file: it is both the route's view and the host of the composable, so
  // the harness needs no second stub (`vue/one-component-per-file` counts route stubs too).
  const C = defineComponent({
    setup() {
      f = useSpendFilters();
      return () => h("div");
    },
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/fuel-spend", component: C }],
  });
  await router.push(url);
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
    const d = defaultWindow(new Date().toISOString().slice(0, 10));
    expect(f.range.value).toEqual(d);
    expect(f.active.value).toBe(false);
  });

  it("reports the filters as active once a range is applied", async () => {
    const { f } = await mountFilters();
    f.from.value = "2026-08-01";
    f.to.value = "2026-08-20";
    await settle();
    expect(f.active.value).toBe(true);
  });

  // ── the window is one fact, and cannot be left half-set ─────────────────────────────────────
  it("writes both ends in a single navigation", async () => {
    const { f, router } = await mountFilters();
    f.setWindow("2026-08-05", "2026-08-12");
    await settle();
    expect(router.currentRoute.value.query.from).toBe("2026-08-05");
    expect(router.currentRoute.value.query.to).toBe("2026-08-12");
  });

  it("swaps a backwards range instead of reporting an empty fleet", async () => {
    const { f } = await mountFilters();
    f.setWindow("2026-08-12", "2026-08-05");
    await settle();
    expect(f.range.value).toEqual({ from: "2026-08-05", to: "2026-08-12" });
  });

  it("normalises a hand-edited link before anything queries against it", async () => {
    const { f } = await mountFilters("/fuel-spend?from=2031-01-01&to=not-a-date");

    expect(f.range.value.from <= f.range.value.to).toBe(true);
    expect(f.range.value.to <= new Date().toISOString().slice(0, 10)).toBe(true);
    // and it SAYS it corrected something, rather than quietly showing a different period
    expect(f.windowNotice.value).toBeTruthy();
  });



  it("does not light up Clear for a link that merely pins the default window", async () => {
    // Pressing Clear here used to leave the screen identical, which reads as a broken button.
    const d = defaultWindow(new Date().toISOString().slice(0, 10));
    const { f } = await mountFilters();
    f.setWindow(d.from, d.to);
    await settle();
    expect(f.active.value).toBe(false);
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

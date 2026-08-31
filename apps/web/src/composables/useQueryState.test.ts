import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { useQueryState, oneParam, type QueryState } from "./useQueryState";

/**
 * The buffer promoted out of `features/reconcile/useSpendFilters.ts` at R3a (D-ROS14).
 *
 * The guarantee it exists for was pinned there against DATES, because that is where the bug was seen:
 * a date picker welded to the last 90 days, because `router.replace` is asynchronous and the second of
 * two setters in one tick overwrote the first. The hazard was never about dates. Now that the roster
 * writes columns through the same buffer, it is pinned here in the general form — any two parameters,
 * any two writers, one tick.
 */
async function mountState(initial = "/t"): Promise<{ s: QueryState; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/t", component: { template: "<div/>" } }],
  });
  let s!: QueryState;
  const C = defineComponent({
    setup() {
      s = useQueryState();
      return () => h("div");
    },
  });
  await router.push(initial);
  await router.isReady();
  mount(C, { global: { plugins: [router] } });
  return { s, router };
}

/** Drain the microtask queue: a vue-router navigation resolves through several promise links. */
const settle = () => flushPromises();

describe("useQueryState", () => {
  it("keeps every parameter written in one tick, not just the last one", async () => {
    const { s, router } = await mountState();
    s.set({ a: "1" });
    s.set({ b: "2" });
    s.set({ c: "3" });
    await settle();

    expect(router.currentRoute.value.query).toMatchObject({ a: "1", b: "2", c: "3" });
  });

  it("reads back a value before the router has settled, so no control flashes its old state", async () => {
    const { s } = await mountState();
    s.set({ cols: "name,status" });
    // No await: the getter must not lag its own setter by a tick.
    expect(s.one("cols")).toBe("name,status");
  });

  it("does not lose a value to a write that lands while its navigation is in flight", async () => {
    const { s, router } = await mountState();
    s.set({ a: "1" });
    await settle();
    s.set({ b: "2" });
    await settle();
    expect(router.currentRoute.value.query).toMatchObject({ a: "1", b: "2" });
  });

  it("removes a parameter written as undefined, and keeps the others", async () => {
    const { s, router } = await mountState("/t?a=1&b=2");
    s.set({ a: undefined });
    await settle();
    expect(router.currentRoute.value.query.a).toBeUndefined();
    expect(router.currentRoute.value.query.b).toBe("2");
  });

  it("reads a comma-joined parameter as a list, and an absent one as not-narrowed", async () => {
    const { s } = await mountState("/t?cols=name,status&empty=");
    expect(s.list("cols")).toEqual(["name", "status"]);
    // Empty means "the reader has not narrowed this", never "no columns".
    expect(s.list("empty")).toEqual([]);
    expect(s.list("absent")).toEqual([]);
  });

  it("collapses a repeated parameter to its first value", async () => {
    const { s } = await mountState("/t?a=1&a=2");
    expect(s.one("a")).toBe("1");
  });
});

describe("oneParam", () => {
  it("treats an empty string the same as an absent parameter", () => {
    // `?cols=` is what a cleared filter leaves behind, and it must not read as a real value.
    expect(oneParam("")).toBeUndefined();
    expect(oneParam(undefined)).toBeUndefined();
    expect(oneParam(["x", "y"])).toBe("x");
    expect(oneParam("x")).toBe("x");
  });
});

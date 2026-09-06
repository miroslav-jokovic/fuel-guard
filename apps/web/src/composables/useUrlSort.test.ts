import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { useQueryState } from "./useQueryState";
import { useUrlSort, SORT_DIRECTIONS } from "./useUrlSort";

/**
 * The sort, in the URL (FUEL-C3).
 *
 * Sort is the half of "sendable" that is easiest to leave behind, because a list looks right in
 * either order. It is not: the interesting row is usually the first one, which is a property of the
 * sort rather than of the filters, so a link that dropped it arrives showing something else.
 *
 * The assertions below are the whole contract — the cycle is `lib/sort.ts`'s and pinned there; what
 * is pinned HERE is that each state survives a round trip through the address bar, and that the
 * cleared state leaves no parameter behind describing a table that is no longer sorted.
 */
const COLUMNS = ["unit", "declined_at", "driver_name"] as const;

async function mountSort(initial = "/t"): Promise<{ s: ReturnType<typeof useUrlSort>; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/t", component: { template: "<div/>" } }],
  });
  let s!: ReturnType<typeof useUrlSort>;
  const C = defineComponent({
    setup() {
      const q = useQueryState();
      s = useUrlSort(q.param("sort", COLUMNS), q.param("dir", SORT_DIRECTIONS));
      return () => h("div");
    },
  });
  await router.push(initial);
  await router.isReady();
  mount(C, { global: { plugins: [router] } });
  return { s, router };
}

const settle = () => flushPromises();

describe("useUrlSort", () => {
  it("starts unsorted when the URL says nothing", async () => {
    expect((await mountSort()).s.sort.value).toEqual({ key: null, dir: "asc" });
  });

  it("puts a sorted column in the URL, both halves", async () => {
    const { s, router } = await mountSort();
    s.onSort("unit");
    await settle();
    expect(s.sort.value).toEqual({ key: "unit", dir: "asc" });
    expect(router.currentRoute.value.query).toMatchObject({ sort: "unit", dir: "asc" });
  });

  it("reads a sorted column back out of the URL", async () => {
    expect((await mountSort("/t?sort=declined_at&dir=desc")).s.sort.value).toEqual({
      key: "declined_at",
      dir: "desc",
    });
  });

  /**
   * The third press of the cycle. Leaving `?dir=asc` behind on a table that is no longer sorted is
   * the shape of parameter somebody later tries to make mean something.
   */
  it("clears BOTH parameters when the cycle returns to unsorted", async () => {
    const { s, router } = await mountSort("/t?sort=unit&dir=desc");
    s.onSort("unit");
    await settle();
    expect(s.sort.value.key).toBeNull();
    expect(router.currentRoute.value.query.sort).toBeUndefined();
    expect(router.currentRoute.value.query.dir).toBeUndefined();
  });

  /**
   * ⚠ The reason both halves go through `param`'s vocabulary. This value is a column name reaching
   * PostgREST's `.order()`; unlike every other filter, an unrecognised one is not an empty list but
   * a failed query. `fueled_at` is the real case — it is the fills tab's default sort, one tab away.
   */
  it("refuses a column name that belongs to another table's URL", async () => {
    expect((await mountSort("/t?sort=fueled_at&dir=desc")).s.sort.value.key).toBeNull();
  });

  it("treats a direction it does not recognise as ascending, like an absent one", async () => {
    expect((await mountSort("/t?sort=unit&dir=sideways")).s.sort.value.dir).toBe("asc");
  });
});

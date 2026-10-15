import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import DataWorkspace from "../components/DataWorkspace.vue";
import FilterBar from "../components/FilterBar.vue";
import DataTable from "../components/DataTable.vue";

/**
 * F15 (US6b) — a toolbar list's count is printed only once its table has answered. The browser pass
 * found every toolbar list saying "0 vehicles" while loading and after a failed read, because the
 * count is the length of rows a list that has not answered does not have.
 */
function list(state: { loading?: boolean; error?: string | null; rows?: { id: string }[] }) {
  const loading = ref(state.loading ?? false);
  const error = ref(state.error ?? null);
  const rows = ref(state.rows ?? []);
  const Page = defineComponent({
    setup: () => () =>
      h(DataWorkspace, null, () => [
        h(FilterBar, { count: rows.value.length, countLabel: "vehicles" }),
        h(DataTable, {
          columns: [{ key: "id", label: "Unit" }],
          rows: rows.value,
          loading: loading.value,
          error: error.value,
          emptyText: "No vehicles match.",
        }),
      ]),
  });
  return { w: mount(Page), loading, error, rows };
}

describe("a toolbar's count waits for its table's answer (F15)", () => {
  // The table reports during its own setup, after the toolbar's first render; the toolbar redraws in
  // the same tick, before the browser paints — hence the one `nextTick`.
  it("prints no count while the table is loading", async () => {
    const { w } = list({ loading: true });
    await w.vm.$nextTick();
    expect(w.text()).not.toContain("0 vehicles");
  });

  it("prints no count when the table's read failed", async () => {
    const { w } = list({ error: "Could not load the vehicles." });
    await w.vm.$nextTick();
    expect(w.text()).toContain("Could not load the vehicles.");
    expect(w.text()).not.toContain("0 vehicles");
  });

  it("prints the count — zero included — once the table has answered", async () => {
    const { w, loading, rows } = list({ loading: true });
    loading.value = false;
    await w.vm.$nextTick();
    expect(w.text()).toContain("0 vehicles");
    rows.value = [{ id: "a" }, { id: "b" }];
    await w.vm.$nextTick();
    expect(w.text()).toContain("2 vehicles");
  });

  it("a report's standalone bar, outside a workspace, prints what it is given", () => {
    const w = mount(FilterBar, { props: { count: 0, countLabel: "trucks" } });
    expect(w.text()).toContain("0 trucks");
  });
});

import { describe, expect, it } from "vitest";
import { nextTick, ref } from "vue";
import { useClientPage } from "./useClientPage";

/** F26 (US6b) — one page of a list the browser already holds in full. */
describe("useClientPage", () => {
  it("slices the page it is on, and says it pages only past one page", () => {
    const rows = ref(Array.from({ length: 45 }, (_, i) => i));
    const p = useClientPage(rows);
    expect(p.pageRows.value).toEqual(rows.value.slice(0, 20));
    expect(p.paged.value).toBe(true);
    p.page.value = 3;
    expect(p.pageRows.value).toEqual([40, 41, 42, 43, 44]);
    expect(useClientPage(ref([1, 2, 3])).paged.value).toBe(false);
  });

  it("never strands the reader past the end when the list shrinks", async () => {
    const rows = ref(Array.from({ length: 45 }, (_, i) => i));
    const p = useClientPage(rows);
    p.page.value = 3;
    rows.value = rows.value.slice(0, 25);
    await nextTick();
    expect(p.page.value).toBe(2);
    expect(p.pageRows.value).toEqual([20, 21, 22, 23, 24]);
    rows.value = [];
    await nextTick();
    expect(p.page.value).toBe(1);
  });
});

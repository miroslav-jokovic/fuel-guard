import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import { mount } from "@vue/test-utils";
import ColumnPicker from "@/components/ui/ColumnPicker.vue";
import type { TableColumns } from "@/composables/useTableColumns";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";

/**
 * The toolbar half of column management (R3b). `useTableColumns` owns the rules and is tested on its
 * own; what is pinned here is what a reader can and cannot reach with a keyboard and a mouse.
 *
 * The panel is teleported to `<body>`, so every assertion reads `document.body` rather than the
 * wrapper — a query against the wrapper alone would find nothing and pass for the wrong reason.
 */
const COLUMNS: DataTableColumn[] = [
  { key: "full_name", label: "Name" },
  { key: "phone", label: "Phone" },
];

function stubColumns(overrides: Partial<TableColumns> = {}): TableColumns {
  const hidden = ref<string[]>([]);
  return {
    visible: computed(() => COLUMNS.filter((c) => !hidden.value.includes(c.key))),
    choices: computed(() =>
      COLUMNS.map((column, i) => ({
        column,
        shown: !hidden.value.includes(column.key),
        locked: i === 0,
      })),
    ),
    hiddenCount: computed(() => hidden.value.length),
    toggle: vi.fn((key: string) => hidden.value.push(key)),
    showAll: vi.fn(() => (hidden.value = [])),
    ...overrides,
  };
}

/**
 * Mounted wrappers are tracked and torn down, because the panel is teleported to `<body>` and a
 * wrapper left mounted leaves its panel there. A later test querying `document.body` would then find
 * an earlier test's panel and assert against it — passing or failing for a reason that has nothing
 * to do with the test being read. This suite found that on itself.
 */
const mounted: ReturnType<typeof mount>[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const openPicker = async (columns = stubColumns()) => {
  const w = mount(ColumnPicker, { props: { columns }, attachTo: document.body });
  mounted.push(w);
  await w.find("button").trigger("click");
  return { w, columns };
};

describe("ColumnPicker", () => {
  it("lists every column, and marks the identifier one as always shown", async () => {
    await openPicker();
    const panel = document.body.querySelector('[role="dialog"]')!;
    expect(panel.textContent).toContain("Name");
    expect(panel.textContent).toContain("Phone");
    expect(panel.textContent).toContain("Always");

    const boxes = panel.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes[0]!.disabled).toBe(true);
    expect(boxes[1]!.disabled).toBe(false);
  });

  it("asks the composable to toggle, rather than deciding anything itself", async () => {
    const { columns } = await openPicker();
    const boxes = document.body.querySelectorAll<HTMLInputElement>('[role="dialog"] input');
    boxes[1]!.dispatchEvent(new Event("change"));
    expect(columns.toggle).toHaveBeenCalledWith("phone");
  });

  it("closes on Escape pressed inside the panel, not only on the trigger", async () => {
    // The panel is teleported out of the component, so a handler on the trigger never hears this.
    await openPicker();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("offers Show all only once something is hidden", async () => {
    await openPicker();
    expect(document.body.textContent).not.toContain("Show all columns");

    const hidden = stubColumns();
    hidden.toggle("phone");
    await openPicker(hidden);
    expect(document.body.textContent).toContain("Show all columns");
  });
});

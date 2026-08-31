import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import { useTableColumns, type TableColumns } from "@/composables/useTableColumns";

/**
 * Column visibility (R3b, D-ROS3/D-ROS15).
 *
 * The rule this suite exists for is that the stored set is what is HIDDEN. It reads as an
 * implementation detail and is not one: R4 adds CDL, medical and hazmat expiry columns to this very
 * table. Under a stored VISIBLE-list, every reader who had ever opened the column picker would
 * silently not get them — the readers who customise most would be the ones missing the columns a
 * §391.51 file depends on. "Shows a column added after the reader last chose" is that rule.
 *
 * This suite installs its own storage: the repo's jsdom has none at all, so the no-storage path is
 * what CI otherwise runs.
 */
function installStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, String(v)),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: () => null,
      get length() {
        return map.size;
      },
    } as Storage,
  });
  return map;
}

const COLUMNS: DataTableColumn[] = [
  { key: "full_name", label: "Name" },
  { key: "phone", label: "Phone" },
  { key: "status", label: "Status" },
];

async function mountColumns(
  initial = "/drivers",
  columns = ref<DataTableColumn[]>([...COLUMNS]),
): Promise<{ c: TableColumns; router: Router; columns: typeof columns }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/drivers", component: { template: "<div/>" } }],
  });
  let c!: TableColumns;
  const C = defineComponent({
    setup() {
      c = useTableColumns("roster.drivers", () => columns.value);
      return () => h("div");
    },
  });
  await router.push(initial);
  await router.isReady();
  mount(C, { global: { plugins: [router] } });
  return { c, router, columns };
}

const settle = () => flushPromises();
const keys = (c: TableColumns) => c.visible.value.map((col) => col.key);

beforeEach(() => installStorage());
afterEach(() => Reflect.deleteProperty(globalThis, "localStorage"));

describe("useTableColumns", () => {
  it("shows every column until somebody says otherwise", async () => {
    const { c } = await mountColumns();
    expect(keys(c)).toEqual(["full_name", "phone", "status"]);
    expect(c.hiddenCount.value).toBe(0);
  });

  it("hides a column, and brings it back", async () => {
    const { c } = await mountColumns();
    c.toggle("phone");
    await settle();
    expect(keys(c)).toEqual(["full_name", "status"]);
    expect(c.hiddenCount.value).toBe(1);

    c.toggle("phone");
    await settle();
    expect(keys(c)).toEqual(["full_name", "phone", "status"]);
  });

  it("refuses to hide the identifier column, and does not even record the attempt", async () => {
    const { c, router } = await mountColumns();
    c.toggle("full_name");
    await settle();
    expect(keys(c)).toContain("full_name");
    // Not merely filtered back in on the way out — it never reaches the URL or storage at all.
    expect(router.currentRoute.value.query.hide).toBeUndefined();
    expect(c.choices.value[0]!.locked).toBe(true);
    expect(c.choices.value[1]!.locked).toBe(false);
  });

  it("ignores a hand-edited link that tries to hide the identifier column", async () => {
    // A linkable URL is one a person can type into, and this one would leave a table of rows with
    // no names on them.
    const { c } = await mountColumns("/drivers?hide=full_name,phone");
    expect(keys(c)).toEqual(["full_name", "status"]);
  });

  it("shows a column added after the reader last chose", async () => {
    // The whole reason the stored set is the HIDDEN one. R4 adds four columns to this table.
    const columns = ref<DataTableColumn[]>([...COLUMNS]);
    const { c } = await mountColumns("/drivers", columns);
    c.toggle("phone");
    await settle();

    columns.value = [...COLUMNS, { key: "medical_expires_at", label: "Medical" }];
    expect(keys(c)).toEqual(["full_name", "status", "medical_expires_at"]);
  });

  it("writes the choice to the URL and to storage together, so they cannot disagree", async () => {
    const store = installStorage();
    const { c, router } = await mountColumns();
    c.toggle("phone");
    await settle();

    expect(router.currentRoute.value.query.hide).toBe("phone");
    expect(JSON.parse(store.get("fg.cols.roster.drivers")!)).toEqual(["phone"]);
  });

  it("clears the parameter rather than leaving an empty one behind", async () => {
    const { c, router } = await mountColumns("/drivers?hide=phone");
    c.showAll();
    await settle();
    expect(router.currentRoute.value.query.hide).toBeUndefined();
    expect(keys(c)).toEqual(["full_name", "phone", "status"]);
  });

  it("lets a link's columns win for the visit without rewriting the reader's own default", async () => {
    const store = installStorage({ "fg.cols.roster.drivers": JSON.stringify(["status"]) });
    const { c } = await mountColumns("/drivers?hide=phone");
    // The link said phone; the reader's own preference said status. For this visit, the link wins…
    expect(keys(c)).toEqual(["full_name", "status"]);
    // …and following somebody's link has not silently reshaped this reader's table forever.
    expect(JSON.parse(store.get("fg.cols.roster.drivers")!)).toEqual(["status"]);
  });

  it("falls back to the reader's own choice when the link expresses none", async () => {
    installStorage({ "fg.cols.roster.drivers": JSON.stringify(["status"]) });
    const { c } = await mountColumns("/drivers");
    expect(keys(c)).toEqual(["full_name", "phone"]);
  });

  it("drops a stored key for a column that no longer exists", async () => {
    const store = installStorage({
      "fg.cols.roster.drivers": JSON.stringify(["phone", "samsara_username"]),
    });
    const { c } = await mountColumns();
    c.toggle("status");
    await settle();
    // `samsara_username` is not a column any more; it must not haunt the preference forever.
    expect(JSON.parse(store.get("fg.cols.roster.drivers")!)).toEqual(["phone", "status"]);
  });

  it("still applies a choice when there is no storage at all", async () => {
    Reflect.deleteProperty(globalThis, "localStorage");
    const { c } = await mountColumns();
    // Safari private mode throws on access; this repo's jsdom has none. Neither may break the page.
    expect(() => c.toggle("phone")).not.toThrow();
    await settle();
    expect(keys(c)).toEqual(["full_name", "status"]);
  });
});

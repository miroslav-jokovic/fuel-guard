import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";

/**
 * Column alignment (D-DS1).
 *
 * These exist because the defect they pin was invisible to every other check. `alignCls` used to
 * fall through to `text-center`, and `apps/web/CLAUDE.md` instructed authors to omit `align`, so
 * 376 of 387 column definitions rendered centred — money, gallons and MPG included — while the
 * component's own docstring claimed words-left/numbers-right. Reading the file did not reveal it;
 * mounting it did. Alignment is layout, so `lint:tokens` (colour) will never catch a regression
 * here. This file is the only thing that will.
 */

const mountTable = (columns: DataTableColumn[]) =>
  mount(DataTable, {
    props: {
      columns,
      rows: [{ unit: "Unit 204", gallons: 118.4, amount: "$412.86", flag: "ok" }],
      rowKey: "unit",
    },
    global: {
      stubs: { RouterLink: true, AppIcon: true, TableSkeleton: true, ErrorState: true },
    },
  });

const headerClasses = (wrapper: ReturnType<typeof mountTable>) =>
  wrapper.findAll("thead th").map((th) => th.attributes("class") ?? "");
const cellClasses = (wrapper: ReturnType<typeof mountTable>) =>
  wrapper.findAll("tbody td").map((td) => td.attributes("class") ?? "");

describe("DataTable column alignment", () => {
  it("left-aligns a text column that declares no alignment", () => {
    const wrapper = mountTable([{ key: "unit", label: "Unit" }]);
    expect(cellClasses(wrapper)[0]).toContain("text-left");
    expect(cellClasses(wrapper)[0]).not.toContain("text-center");
  });

  it("right-aligns a numeric column and gives it tabular figures", () => {
    const wrapper = mountTable([{ key: "gallons", label: "Gallons", numeric: true }]);
    expect(cellClasses(wrapper)[0]).toContain("text-right");
    expect(cellClasses(wrapper)[0]).toContain("tabular-nums");
    expect(cellClasses(wrapper)[0]).not.toContain("text-center");
  });

  it("lets an explicit align override the default in both directions", () => {
    const wrapper = mountTable([
      { key: "unit", label: "Unit", align: "right" },
      { key: "gallons", label: "Gallons", numeric: true, align: "left" },
    ]);
    const [text, numeric] = cellClasses(wrapper);
    expect(text).toContain("text-right");
    expect(numeric).toContain("text-left");
    // an explicit align changes position only — a numeric column keeps its figures tabular
    expect(numeric).toContain("tabular-nums");
  });

  it("centres a column only when it explicitly asks, for control columns", () => {
    const wrapper = mountTable([{ key: "flag", label: "", align: "center" }]);
    expect(cellClasses(wrapper)[0]).toContain("text-center");
  });

  it("gives a header the same alignment as its column", () => {
    const wrapper = mountTable([
      { key: "unit", label: "Unit" },
      { key: "gallons", label: "Gallons", numeric: true },
      { key: "flag", label: "Flag", align: "center" },
    ]);
    expect(headerClasses(wrapper).map((c) => c.match(/text-(left|right|center)/)?.[0])).toEqual([
      "text-left",
      "text-right",
      "text-center",
    ]);
  });

  it("never centres by default, for any combination the contract allows", () => {
    const wrapper = mountTable([
      { key: "unit", label: "Unit" },
      { key: "gallons", label: "Gallons", numeric: true },
      { key: "amount", label: "Amount", numeric: true, sortable: true },
      { key: "flag", label: "Flag", cellClass: "font-medium" },
    ]);
    for (const cls of [...headerClasses(wrapper), ...cellClasses(wrapper)]) {
      expect(cls).not.toContain("text-center");
    }
  });
});

import { describe, expect, it } from "vitest";
import { columnsWithData } from "./dataTable";

const cols = [{ key: "title" }, { key: "price" }, { key: "used" }, { key: "note" }];
const keys = (c: { key: string }[]) => c.map((x) => x.key);

describe("columnsWithData", () => {
  it("drops a column every row leaves blank, keeps one any row fills", () => {
    const rows = [{ title: "A", price: null, used: 3, note: "" }, { title: "B", price: 4.5, used: 0, note: null }];
    expect(keys(columnsWithData(cols, rows))).toEqual(["title", "price", "used"]);
  });

  it("keeps the named columns even when blank", () => {
    expect(keys(columnsWithData(cols, [{ title: null }], { keep: ["title"] }))).toEqual(["title"]);
  });

  it("lets a column say what empty means for it — a 0 count is no data", () => {
    const rows = [{ title: "A", used: 0 }, { title: "B", used: 0 }];
    expect(keys(columnsWithData(cols, rows, { keep: ["title"], empty: { used: (v) => !v } }))).toEqual(["title"]);
  });

  it("keeps every column while no rows have arrived", () => {
    expect(keys(columnsWithData(cols, []))).toEqual(["title", "price", "used", "note"]);
  });
});

import { describe, expect, it } from "vitest";
import { DASHBOARD_WIDGETS } from "@silvicom/shared";
import { layoutSegments } from "./packing";

const tab = (key: string) => DASHBOARD_WIDGETS.filter((w) => w.tab === key);
const shape = (spans: (number | "workspace")[]) =>
  layoutSegments(spans.map((span) => ({ span }) as { span: 4 })).map((s) => [s.packed, s.widgets.length]);

describe("layoutSegments", () => {
  it("lays Operations as its full-width strip on the grid, then every other card packed in threes", () => {
    const ops = layoutSegments(tab("ops"));
    expect(ops.map((s) => [s.packed, s.widgets.map((w) => w.key)])).toEqual([
      [null, ["ops.fleet-now"]],
      [4, tab("ops").slice(1).map((w) => w.key)],
    ]);
  });

  it("leaves Fleet overview one grid: a mixed run and a pair that fits one row have nothing to pack", () => {
    const fleet = layoutSegments(tab("fleet"));
    expect(fleet).toHaveLength(1);
    expect(fleet[0]!.packed).toBeNull();
    expect(fleet[0]!.widgets.map((w) => w.key)).toEqual(tab("fleet").map((w) => w.key));
  });

  it("packs a run only once it wraps — more cards of one span than one row takes", () => {
    expect(shape([4, 4, 4, 4])).toEqual([[4, 4]]);
    expect(shape([4, 4, 4])).toEqual([[null, 3]]);
    expect(shape([6, 6, 6])).toEqual([[6, 3]]);
    expect(shape([6, 6])).toEqual([[null, 2]]);
    expect(shape([6, 4, 6, 4])).toEqual([[null, 4]]);
  });

  it("cuts the tab at each full-width card and keeps the order across the cut", () => {
    expect(shape([4, 4, 4, 4, 12, 3, 3, 3, 3, 3])).toEqual([[4, 4], [null, 1], [3, 5]]);
    expect(shape([12, 6, 6, 12])).toEqual([[null, 4]]);
  });

  it("leaves a lone card, full-width cards, a workspace and an empty tab on the grid", () => {
    expect(shape([4])).toEqual([[null, 1]]);
    expect(shape([12, 12])).toEqual([[null, 2]]);
    expect(shape(["workspace", "workspace"])).toEqual([[null, 2]]);
    expect(shape([])).toEqual([]);
  });
});

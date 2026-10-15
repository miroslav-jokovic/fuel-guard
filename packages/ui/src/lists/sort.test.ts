import { describe, it, expect } from "vitest";
import { sortRows } from "./sort";

describe("sortRows — absent values sort last under both directions", () => {
  const rows = [
    { unit: "a", rate: 30 },
    { unit: "b", rate: null },
    { unit: "c", rate: 10 },
    { unit: "d", rate: undefined },
  ];
  it("ascending: present values first, blanks after", () => {
    expect(sortRows(rows, { key: "rate", dir: "asc" }).map((r) => r.unit)).toEqual(["c", "a", "b", "d"]);
  });
  it("descending: the largest value leads and blanks still trail — never at the top", () => {
    expect(sortRows(rows, { key: "rate", dir: "desc" }).map((r) => r.unit)).toEqual(["a", "c", "b", "d"]);
  });
  it("no key: the rows come back untouched", () => {
    expect(sortRows(rows, { key: null, dir: "asc" })).toBe(rows);
  });
});

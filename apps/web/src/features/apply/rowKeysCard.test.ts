import { describe, expect, it } from "vitest";
import { questionnaireForApplicant } from "@silvicom/shared";
import { applicantFactRows } from "./applicantFactRows";
import { correctionFor } from "./factCorrection";
import { rowChange } from "./factRowLists";
import { rowText } from "./fieldLabels";

/**
 * Q-AM15 (a) on the office's card and the driver's 3.1: a row of a keyed list is corrected and removed BY
 * ITS KEY, and a correction is marked on the row that holds its key now — wherever the driver has moved it.
 */
const K1 = "11111111-1111-4111-8111-111111111111";
const K2 = "22222222-2222-4222-8222-222222222222";
const GARY = { line1: "9 Old Rd", line2: "", city: "Gary", state: "IN", postal_code: "46401", from: "2019-01", to: "2022-12", key: K1 };
const HOME = { line1: "1 Main St", line2: "", city: "Joliet", state: "IL", postal_code: "60431", from: "2023-01", to: "", key: K2 };

const rowsOf = (addresses: unknown[], edits: Array<{ path: Array<string | number>; before?: unknown; after?: unknown }> = []) =>
  applicantFactRows({
    payload: { addresses },
    partOne: null,
    edits: edits as never,
    questionnaire: questionnaireForApplicant(),
  });
const cityRow = (rows: ReturnType<typeof rowsOf>, at: number) =>
  rows.find((r) => r.path[0] === "addresses" && r.path[1] === at && r.path[2] === "city")!;

describe("the card sends a keyed row by its key", () => {
  it("corrects an address by its key, not its place", () => {
    const rows = rowsOf([GARY, HOME]);
    const c = correctionFor(cityRow(rows, 0), "Gary West", { revision: 3, partOne: null, rows, addresses: [GARY, HOME], payload: { addresses: [GARY, HOME] } });
    expect(c).toEqual({ door: "draft", edit: { path: ["addresses", K1, "city"], value: "Gary West", revision: 3 } });
  });

  it("still sends a place for a row the draft holds without a key — the API's AW1 rule takes it", () => {
    const { key: _k, ...keyless } = GARY;
    const rows = rowsOf([keyless, HOME]);
    const c = correctionFor(cityRow(rows, 0), "Gary West", { revision: 3, partOne: null, rows, addresses: [keyless, HOME], payload: { addresses: [keyless, HOME] } });
    expect(c).toMatchObject({ edit: { path: ["addresses", 0, "city"] } });
  });

  it("removes a keyed row by its key", () => {
    const change = rowChange("addresses", { remove: 0 }, { revision: 3, partOne: null, addresses: [GARY, HOME], payload: { addresses: [GARY, HOME] } });
    expect(change).toEqual({ door: "draft", edit: { op: "remove_row", list: "addresses", key: K1, revision: 3 } });
  });

  it("removes an other name by its place — strings have no key (Q-AM22)", () => {
    const change = rowChange("other_names", { remove: 0 }, { revision: 3, partOne: null, addresses: [], payload: { other_names: ["Sue"] } });
    expect(change).toEqual({ door: "draft", edit: { op: "remove_row", list: "other_names", index: 0, revision: 3 } });
  });
});

describe("the card marks the corrected row where it is now", () => {
  const corrected = [{ path: ["addresses", K1, "city"], before: "Gary", after: "Gary West" }];

  it("⚠ marks the row that holds the key after the DRIVER reordered the list", () => {
    const rows = rowsOf([HOME, { ...GARY, city: "Gary West" }], corrected);
    expect(cityRow(rows, 1).corrected).toBe(true);
    expect(cityRow(rows, 0).corrected).toBe(false);
  });

  it("marks nothing once the driver deleted the corrected row", () => {
    const rows = rowsOf([HOME], corrected);
    expect(rows.some((r) => r.corrected)).toBe(false);
  });
});

describe("what the driver reads on 3.1", () => {
  it("never reads a row's key out as one of their answers", () => {
    expect(rowText(GARY)).toBe("9 Old Rd, Gary, IN, 46401, 2019-01, 2022-12");
  });
});

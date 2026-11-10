import { describe, expect, it } from "vitest";
import { applicationEditSchema } from "./applicationReviewContract.js";
import { applyApplicationEdit, isEditRefusal, type AppliedEdit } from "./applicationReviewEdits.js";
import { currentEditPaths } from "./applicationEditReplay.js";

/**
 * F3c part 2 (E2): the office adds and removes rows of the positional lists — addresses, other names,
 * licences, equipment, accidents, convictions — each as ONE correction the driver reads on 3.1.
 */
const HOME = { line1: "1 Main St", line2: "", city: "Joliet", state: "IL", postal_code: "60431", from: "2023-01", to: "" };
const OLD = { line1: "9 Old Rd", line2: "", city: "Gary", state: "IN", postal_code: "46401", from: "2019-01", to: "2022-12" };
const OLDER = { ...OLD, city: "Hammond", from: "2015-01", to: "2018-12" };
const PAYLOAD = { addresses: [HOME, OLD, OLDER], declares_no_accidents: true, accidents: [], other_names: ["Sue Smith"] };

const apply = (edit: unknown, payload: Record<string, unknown> = PAYLOAD) =>
  applyApplicationEdit(payload, payload, applicationEditSchema.parse(edit));

describe("adding a row", () => {
  it("appends the whole row and logs it at its new position, before nothing", () => {
    const row = { ...OLD, city: "Gary West" };
    const done = apply({ op: "add_row", list: "addresses", row, revision: 3 }) as AppliedEdit;
    expect((done.payload.addresses as unknown[]).length).toBe(4);
    expect(done).toMatchObject({ logPath: ["addresses", 3], before: null, after: row });
  });

  it("adds a plain string to a list of strings", () => {
    const done = apply({ op: "add_row", list: "other_names", row: "Susan G", revision: 3 }) as AppliedEdit;
    expect(done.payload.other_names).toEqual(["Sue Smith", "Susan G"]);
    expect(done.logPath).toEqual(["other_names", 1]);
  });

  it("⚠ refuses an accident while the applicant's answer is still that they had none", () => {
    const refused = apply({ op: "add_row", list: "accidents", row: { occurred_on: "2024-03-01", nature: "x" }, revision: 3 });
    expect(isEditRefusal(refused) && refused.message).toMatch(/no accidents/);
    const allowed = apply(
      { op: "add_row", list: "accidents", row: { occurred_on: "2024-03-01", nature: "x" }, revision: 3 },
      { ...PAYLOAD, declares_no_accidents: false },
    );
    expect(isEditRefusal(allowed)).toBe(false);
  });

  it("refuses a list the op does not name", () => {
    expect(applicationEditSchema.safeParse({ op: "add_row", list: "employers", row: {}, revision: 1 }).success).toBe(false);
  });
});

describe("removing a row", () => {
  it("takes the row out and logs the row it took, after nothing", () => {
    const done = apply({ op: "remove_row", list: "addresses", index: 1, revision: 3 }) as AppliedEdit;
    expect(done.payload.addresses).toEqual([HOME, OLDER]);
    expect(done).toMatchObject({ logPath: ["addresses", 1], before: OLD, after: null });
  });

  it("⚠ never removes the current home, wherever it sits in the list", () => {
    const refused = apply({ op: "remove_row", list: "addresses", index: 1, revision: 3 }, { addresses: [OLD, HOME] });
    expect(isEditRefusal(refused) && refused.message).toMatch(/live now/);
  });

  it("refuses a row that is no longer there", () => {
    expect(isEditRefusal(apply({ op: "remove_row", list: "other_names", index: 4, revision: 3 }))).toBe(true);
  });
});

describe("where each correction points after a removal", () => {
  const at = (path: (string | number)[], before: unknown, after: unknown, editedAt: string) => ({ path, before, after, editedAt });

  it("moves a correction to a later row up by one, and marks one to the removed row gone", () => {
    const edits = [
      at(["addresses", 2, "city"], "Hammond", "Hammond IN", "2026-11-10T10:00:00Z"),
      at(["addresses", 1, "city"], "Gary", "Gary IN", "2026-11-10T10:01:00Z"),
      at(["addresses", 1], OLD, null, "2026-11-10T10:02:00Z"),
    ];
    expect(currentEditPaths(edits)).toEqual([
      { path: ["addresses", 1, "city"], gone: false, removal: false },
      { path: ["addresses", 1, "city"], gone: true, removal: false },
      { path: ["addresses", 1], gone: true, removal: true },
    ]);
  });

  it("leaves a correction made AFTER the removal where it was recorded, and other lists alone", () => {
    const edits = [
      at(["addresses", 1, "city"], "Hammond", "Hammond IN", "2026-11-10T10:03:00Z"),
      at(["accidents", 2, "nature"], "a", "b", "2026-11-10T10:00:00Z"),
      at(["addresses", 1], OLD, null, "2026-11-10T10:02:00Z"),
    ];
    const now = currentEditPaths(edits);
    expect(now[0]).toEqual({ path: ["addresses", 1, "city"], gone: false, removal: false });
    expect(now[1]!.path).toEqual(["accidents", 2, "nature"]);
  });

  it("reads the review's newest-first order the same as 3.1's oldest-first", () => {
    const oldest = [
      at(["addresses", 2, "city"], "a", "b", "2026-11-10T10:00:00Z"),
      at(["addresses", 1], OLD, null, "2026-11-10T10:02:00Z"),
    ];
    expect(currentEditPaths([...oldest].reverse()).reverse()).toEqual(currentEditPaths(oldest));
  });

  it("treats an added row as an ordinary correction, not a removal", () => {
    const [added] = currentEditPaths([at(["addresses", 3], null, OLD, "2026-11-10T10:00:00Z")]);
    expect(added).toEqual({ path: ["addresses", 3], gone: false, removal: false });
  });
});

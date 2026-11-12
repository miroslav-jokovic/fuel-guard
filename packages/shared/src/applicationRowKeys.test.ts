import { describe, expect, it } from "vitest";
import { applicationEditSchema } from "./applicationReviewContract.js";
import { applyApplicationEdit, isEditRefusal, withRowKeys, type AppliedEdit } from "./applicationReviewEdits.js";
import { currentEditPaths } from "./applicationEditReplay.js";
import { applicationDraftPayloadSchema, driverApplicationObject } from "./applicationContract.js";

/**
 * Q-AM15 (a), owner 2026-11-11: every row of the office's object lists (addresses, licences, equipment,
 * accidents, convictions) carries a stable `key`, and an office correction names the row by it. The case
 * the ruling is about: the DRIVER deletes or reorders rows on their phone after the office corrected one,
 * which nothing logs. A position would then point the card and screen 3.1 at the neighbour; a key cannot.
 */
const K1 = "11111111-1111-4111-8111-111111111111";
const K2 = "22222222-2222-4222-8222-222222222222";
const K3 = "33333333-3333-4333-8333-333333333333";
const HOME = { line1: "1 Main St", line2: "", city: "Joliet", state: "IL", postal_code: "60431", from: "2023-01", to: "", key: K1 };
const OLD = { line1: "9 Old Rd", line2: "", city: "Gary", state: "IN", postal_code: "46401", from: "2019-01", to: "2022-12", key: K2 };
const OLDER = { ...OLD, city: "Hammond", from: "2015-01", to: "2018-12", key: K3 };
const KEYED = { addresses: [HOME, OLD, OLDER], other_names: ["Sue Smith"] };

let minted = 0;
const mint = () => `minted-${++minted}`;
const apply = (edit: unknown, payload: Record<string, unknown> = KEYED) =>
  applyApplicationEdit(withRowKeys(payload, mint), payload, applicationEditSchema.parse(edit), mint);
const strip = ({ key: _key, ...row }: Record<string, unknown>) => row;

describe("withRowKeys", () => {
  it("keys every keyless row of the five object lists, and leaves the rest alone", () => {
    const before = {
      addresses: [strip(HOME), OLD],
      accidents: [{ occurred_on: "2024-01-02", nature: "Backed into a pole" }],
      other_names: ["Sue Smith"],
      employers: [{ name: "Acme" }],
    };
    const keyed = withRowKeys(before, () => "fresh");
    expect((keyed.addresses as Array<{ key: string }>).map((a) => a.key)).toEqual(["fresh", K2]);
    expect((keyed.accidents as Array<{ key: string }>)[0]!.key).toBe("fresh");
    // The other names are strings (Q-AM22); the employers have their own minting (`withEmployerKeys`).
    expect(keyed.other_names).toEqual(["Sue Smith"]);
    expect(keyed.employers).toEqual([{ name: "Acme" }]);
    expect((before.addresses[0] as Record<string, unknown>).key).toBeUndefined();
  });

  it("returns the very payload when every row already has a key", () => {
    expect(withRowKeys(KEYED, mint)).toBe(KEYED);
  });
});

describe("a correction names its row by key", () => {
  it("writes at the row's place and logs its key", () => {
    const done = apply({ path: ["addresses", K2, "city"], value: "Gary West", revision: 1 }) as AppliedEdit;
    expect((done.payload.addresses as Array<{ city: string }>)[1]!.city).toBe("Gary West");
    expect(done).toMatchObject({ logPath: ["addresses", K2, "city"], before: "Gary", after: "Gary West" });
  });

  it("reaches a row that was keyless when read by its place, and logs it under the key it was just given", () => {
    const legacy = { addresses: [strip(HOME), strip(OLD)] };
    const done = apply({ path: ["addresses", 1, "city"], value: "Gary West", revision: 1 }, legacy) as AppliedEdit;
    expect(done.logPath[0]).toBe("addresses");
    expect(String(done.logPath[1])).toMatch(/^minted-/);
    expect((done.payload.addresses as Array<{ key: string }>)[1]!.key).toBe(done.logPath[1]);
  });

  it("⚠ refuses a place for a row that has a key — the place may be somebody else's by now", () => {
    const refused = apply({ path: ["addresses", 1, "city"], value: "Gary West", revision: 1 });
    expect(isEditRefusal(refused) && refused.message).toMatch(/own reference/);
  });

  it("refuses a key that is no longer on the application", () => {
    const gone = "44444444-4444-4444-8444-444444444444";
    expect(isEditRefusal(apply({ path: ["addresses", gone, "city"], value: "x", revision: 1 }))).toBe(true);
  });

  it("keeps the row's key when the whole row is replaced", () => {
    const done = apply({ path: ["addresses", K3], value: { ...strip(OLDER), city: "Munster" }, revision: 1 }) as AppliedEdit;
    expect((done.payload.addresses as Array<{ key: string; city: string }>)[2]).toMatchObject({ key: K3, city: "Munster" });
  });
});

describe("adding and removing a keyed row", () => {
  it("removes by key and logs the key, with the row it took", () => {
    const done = apply({ op: "remove_row", list: "addresses", key: K2, revision: 1 }) as AppliedEdit;
    expect(done.payload.addresses).toEqual([HOME, OLDER]);
    expect(done).toMatchObject({ logPath: ["addresses", K2], before: OLD, after: null });
  });

  it("keeps the form's own key on an added row, and refuses one already there", () => {
    const row = { ...strip(OLD), city: "Gary West", key: "55555555-5555-4555-8555-555555555555" };
    expect(apply({ op: "add_row", list: "addresses", row, revision: 1 })).toMatchObject({ logPath: ["addresses", row.key] });
    expect(isEditRefusal(apply({ op: "add_row", list: "addresses", row: { ...row, key: K1 }, revision: 1 }))).toBe(true);
  });

  it("refuses a row of a keyed list that is not an object", () => {
    expect(isEditRefusal(apply({ op: "add_row", list: "accidents", row: "a crash", revision: 1 }, { declares_no_accidents: false }))).toBe(true);
  });

  it("still names an other name by its place — a list of strings has nowhere to hold a key (Q-AM22)", () => {
    const done = apply({ op: "remove_row", list: "other_names", index: 0, revision: 1 }) as AppliedEdit;
    expect(done.logPath).toEqual(["other_names", 0]);
  });
});

describe("where a keyed correction points now (currentEditPaths)", () => {
  const corrected = { path: ["addresses", K3, "city"] as ["addresses", string, string], before: "Hammond", after: "Munster" };

  it("⚠ follows its row when the DRIVER deletes an earlier one — the case positions got wrong", () => {
    // The driver removed address 2 on their phone after the office corrected address 3. Nothing logged it.
    const now = currentEditPaths([corrected], { addresses: [HOME, OLDER] });
    expect(now).toEqual([{ path: ["addresses", 1, "city"], gone: false, removal: false }]);
  });

  it("follows its row when the driver reorders the list", () => {
    expect(currentEditPaths([corrected], { addresses: [OLDER, HOME, OLD] })[0]!.path).toEqual(["addresses", 0, "city"]);
  });

  it("is gone when the driver deleted the corrected row itself", () => {
    expect(currentEditPaths([corrected], { addresses: [HOME, OLD] })[0]).toMatchObject({ gone: true, removal: false });
  });

  it("names a keyed removal as one, gone", () => {
    const removal = { path: ["addresses", K2] as ["addresses", string], before: OLD, after: null };
    expect(currentEditPaths([removal], KEYED)[0]).toMatchObject({ gone: true, removal: true });
  });

  it("leaves a keyed path as recorded when the reader holds no draft to look it up in", () => {
    expect(currentEditPaths([corrected])[0]).toEqual({ path: ["addresses", K3, "city"], gone: false, removal: false });
  });
});

describe("the contract", () => {
  it("takes a key on a row of each of the five lists, in the draft and the certified document", () => {
    const rows = {
      addresses: [HOME],
      additional_licences: [{ issuing_authority: "OH", number: "OH-1", expires_at: "2027-01-01", key: K1 }],
      equipment_experience: [{ equipment_class: "tractor_semi_trailer", from: "2020-01", key: K1 }],
      accidents: [{ occurred_on: "2024-01-02", nature: "Pole", key: K1 }],
      violations: [{ occurred_on: "2024-01-02", offence: "Speeding", key: K1 }],
    };
    expect(applicationDraftPayloadSchema.safeParse(rows).success).toBe(true);
    expect(driverApplicationObject.pick({ addresses: true, additional_licences: true, equipment_experience: true, accidents: true, violations: true })
      .safeParse(rows).success).toBe(true);
  });

  it("still refuses any other unknown key on a row (A3's `.strict()`)", () => {
    expect(applicationDraftPayloadSchema.safeParse({ addresses: [{ ...HOME, smuggled: "x" }] }).success).toBe(false);
  });

  it("removes a row by key or by place, never by neither", () => {
    expect(applicationEditSchema.safeParse({ op: "remove_row", list: "addresses", revision: 1 }).success).toBe(false);
  });
});

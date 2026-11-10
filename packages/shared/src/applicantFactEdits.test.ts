import { describe, expect, it } from "vitest";
import { identityEdits, partOneCorrectionWith, partOneEdits, type FactEditRow } from "./applicantFactEdits.js";
import { composeFiledApplication, type PartOneFacts, type PartOneLicence } from "./applicationComposition.js";
import type { PartOneCorrection } from "./applicantScreeningContract.js";

const INTAKE: PartOneFacts = {
  phone: "3125550100",
  address_line1: "1 Main St",
  address_line2: null,
  city: "Joliet",
  state: "IL",
  postal_code: "60431",
  prior_positive_2y: false,
  cdl_class: "A",
};
const LICENCES: PartOneLicence[] = [
  { position: 0, state_code: "IL", agency: null, licence_number: "D1234567", expires_on: "2028-05-01" },
  { position: 1, state_code: "IN", agency: null, licence_number: "IN-998", expires_on: "2027-01-01" },
];
const AS_OF = "2026-11-10";

/** A draft whose SECOND address is the current one, so the index is not the trivial 0. */
const DRAFT = {
  phone: "", addresses: [
    { line1: "9 Old Rd", line2: null, city: "Gary", state: "IN", postal_code: "46401", from: "2019-01", to: "2022-12" },
    { line1: "", line2: null, city: "", state: "", postal_code: "", from: "2023-01", to: null },
  ],
  cdl_number: "", cdl_state: "", cdl_class: null, cdl_expires_at: "", additional_licences: [],
  prior_failed_pre_employment_test: null,
} as const;
const CURRENT = 1;

const correction = (over: Partial<PartOneCorrection> = {}): PartOneCorrection => ({
  phone: INTAKE.phone!, address_line1: INTAKE.address_line1!, address_line2: INTAKE.address_line2,
  city: INTAKE.city!, state: INTAKE.state!, postal_code: INTAKE.postal_code!, cdl_class: "A",
  licences: LICENCES.map(({ state_code, agency, licence_number, expires_on }) => ({ state_code, agency, licence_number, expires_on: expires_on! })),
  ...over,
});

/** What the filed application says once Part 1 holds `c`. */
const filedWith = (c: PartOneCorrection) => {
  const { licences, ...intake } = c;
  return composeFiledApplication(
    JSON.parse(JSON.stringify(DRAFT)) as never,
    { ...INTAKE, ...intake },
    licences.map((l, position) => ({ position, ...l, agency: l.agency ?? null, expires_on: l.expires_on ?? null })),
    AS_OF,
  ).application as Record<string, unknown>;
};

const at = (doc: Record<string, unknown>, path: FactEditRow["path"]): unknown =>
  path.reduce<unknown>((v, seg) => (v as Record<string | number, unknown> | undefined)?.[seg], doc);

const before = { intake: INTAKE, licences: LICENCES };

describe("partOneEdits", () => {
  it("records nothing when nothing changed — an unchanged save is not a correction the driver must read", () => {
    expect(partOneEdits(before, correction(), CURRENT)).toEqual([]);
  });

  it("treats a blank second line and an absent one as the same answer", () => {
    expect(partOneEdits(before, correction({ address_line2: "  " }), CURRENT)).toEqual([]);
  });

  /**
   * The test the header's ⚠ cites: every Part 1 change is addressed where composition files it.
   * For each single-field change, the row's path is a place in the composed application, and the
   * composed application before and after holds exactly the row's `before` and `after` there.
   */
  it.each<[string, Partial<PartOneCorrection>]>([
    ["phone", { phone: "3125550199" }],
    ["street", { address_line1: "22 New Ave" }],
    ["unit", { address_line2: "Apt 4" }],
    ["city", { city: "Aurora" }],
    ["state", { state: "WI" }],
    ["ZIP", { postal_code: "53001" }],
    ["CDL class", { cdl_class: "B" }],
    ["CDL number", { licences: [{ ...correction().licences[0]!, licence_number: "D7654321" }, correction().licences[1]!] }],
    ["CDL state", { licences: [{ ...correction().licences[0]!, state_code: "WI" }, correction().licences[1]!] }],
    ["CDL expiry", { licences: [{ ...correction().licences[0]!, expires_on: "2029-05-01" }, correction().licences[1]!] }],
  ])("every Part 1 change is addressed where composition files it: %s", (_name, change) => {
    const rows = partOneEdits(before, correction(change), CURRENT);
    expect(rows).toHaveLength(1);
    const [row] = rows as [FactEditRow];
    expect(at(filedWith(correction()), row.path)).toEqual(row.before);
    expect(at(filedWith(correction(change)), row.path)).toEqual(row.after);
  });

  it("logs another licence as the row the application files, at its place in Part 1's list", () => {
    const next = correction({
      licences: [correction().licences[0]!, { state_code: "IN", agency: null, licence_number: "IN-999", expires_on: "2027-01-01" }],
    });
    const rows = partOneEdits(before, next, CURRENT);
    expect(rows).toEqual([{
      path: ["additional_licences", 0],
      before: { issuing_authority: "IN", number: "IN-998", expires_at: "2027-01-01" },
      after: { issuing_authority: "IN", number: "IN-999", expires_at: "2027-01-01" },
    }]);
    // …and that row is exactly what composition files there.
    const filed = at(filedWith(next), ["additional_licences", 0]) as Record<string, unknown>;
    expect({ issuing_authority: filed.issuing_authority, number: filed.number, expires_at: filed.expires_at }).toEqual(rows[0]!.after);
  });

  it("logs an added licence with no before, and a removed one with no after", () => {
    const added = correction({
      licences: [...correction().licences, { state_code: "WI", agency: null, licence_number: "W1", expires_on: "2030-01-01" }],
    });
    expect(partOneEdits(before, added, CURRENT)).toEqual([
      { path: ["additional_licences", 1], before: null, after: { issuing_authority: "WI", number: "W1", expires_at: "2030-01-01" } },
    ]);
    const removed = correction({ licences: [correction().licences[0]!] });
    expect(partOneEdits(before, removed, CURRENT)).toEqual([
      { path: ["additional_licences", 0], before: { issuing_authority: "IN", number: "IN-998", expires_at: "2027-01-01" }, after: null },
    ]);
  });

  it("reports several changes as several rows, so 3.1 shows each one", () => {
    const rows = partOneEdits(before, correction({ phone: "3125550199", city: "Aurora" }), CURRENT);
    expect(rows.map((r) => r.path)).toEqual([["phone"], ["addresses", CURRENT, "city"]]);
  });
});

describe("identityEdits", () => {
  const was = { date_of_birth: "1985-10-01", cdl_number: "D1234567", cdl_state: "IL" };

  it("records only what changed", () => {
    expect(identityEdits(was, { ...was, date_of_birth: "1985-01-10" })).toEqual([
      { path: ["date_of_birth"], before: "1985-10-01", after: "1985-01-10" },
    ]);
  });

  it("records a first value as a change from nothing", () => {
    expect(identityEdits({}, was).map((r) => r.path)).toEqual([["date_of_birth"], ["cdl_number"], ["cdl_state"]]);
  });

  it("records nothing for the same three values", () => {
    expect(identityEdits(was, was)).toEqual([]);
  });
});

describe("partOneCorrectionWith", () => {
  const view = { intake: INTAKE, licences: LICENCES };

  /** The ⚠ in its header: a path it accepts is one `partOneEdits` logs back at the same place. */
  it.each<[FactEditRow["path"], string]>([
    [["phone"], "3125550199"],
    [["cdl_class"], "B"],
    [["addresses", CURRENT, "line1"], "22 New Ave"],
    [["addresses", CURRENT, "line2"], "Apt 4"],
    [["addresses", CURRENT, "city"], "Aurora"],
    [["addresses", CURRENT, "state"], "WI"],
    [["addresses", CURRENT, "postal_code"], "53001"],
    [["cdl_number"], "D7654321"],
    [["cdl_state"], "WI"],
    [["cdl_expires_at"], "2029-05-01"],
  ])("round-trips every Part 1 path: %j", (path, value) => {
    const body = partOneCorrectionWith(view, path, value, CURRENT) as PartOneCorrection | null;
    expect(body).not.toBeNull();
    expect(partOneEdits(before, body!, CURRENT)).toEqual([{ path, before: at(filedWith(correction()), path) ?? null, after: value }]);
  });

  it("round-trips another licence's columns as a change to that licence's row", () => {
    const body = partOneCorrectionWith(view, ["additional_licences", 0, "number"], "IN-999", CURRENT) as PartOneCorrection;
    const [row] = partOneEdits(before, body, CURRENT);
    expect(row!.path).toEqual(["additional_licences", 0]);
    expect((row!.after as { number: string }).number).toBe("IN-999");
  });

  it.each<[FactEditRow["path"]]>([
    [["email"]],
    [["addresses", 0, "line1"]], // a PREVIOUS home is the draft's, never Part 1's
    [["addresses", CURRENT, "from"]], // the month they moved in is the driver's draft answer
    [["additional_licences", 5, "number"]],
    [["prior_failed_pre_employment_test"]], // a statement, not this door (Q-AM13)
  ])("answers null for a path Part 1 does not hold: %j", (path) => {
    expect(partOneCorrectionWith(view, path, "x", CURRENT)).toBeNull();
  });
});

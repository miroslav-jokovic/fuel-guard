import { describe, it, expect } from "vitest";
import {
  compareFleetParity,
  describeParityFinding,
  isSoldAwaitingPickup,
  parityFindingKey,
  type DerivedMakeModel,
  type ParityOurRow,
} from "./fleetParity.js";
import type { TmsTrailerInput, TmsVehicleInput } from "./tms.js";

/** McLeod's 506 as the agent reads it, and our row the sweep wrote from it (0399 derived). */
const tractor = (o: Partial<TmsVehicleInput> = {}): TmsVehicleInput => ({
  external_id: "506",
  unit_number: "506",
  vin: "3AKJHHDR0LSLL7398",
  make: "FRHT",
  model: "CA",
  year: 2020,
  purchased_at: "2020-07-01",
  in_shop: false,
  ...o,
});
const ours = (o: Partial<ParityOurRow> = {}): ParityOurRow => ({
  id: "v-506",
  unit_number: "506",
  link: "506",
  status: "active",
  vin: "3AKJHHDR0LSLL7398",
  year: 2020,
  purchased_at: "2020-07-01",
  make: "Freightliner",
  model: "Cascadia",
  samsara_name: "506",
  ...o,
});
const derivedFor = (...ids: string[]): DerivedMakeModel =>
  new Map(ids.map((id) => [id, { make: "Freightliner", model: "Cascadia" }]));
const run = (m: TmsVehicleInput[], o: ParityOurRow[], trailers: { m?: TmsTrailerInput[]; o?: ParityOurRow[] } = {}) =>
  compareFleetParity({
    tractors: { mcleod: m, ours: o, derived: derivedFor(...m.map((t) => t.external_id)) },
    trailers: { mcleod: trailers.m ?? [], ours: trailers.o ?? [] },
  });

describe("fleet parity (FL2, D-FL2)", () => {
  it("is silent when the two lists agree — McLeod's FRHT/CA and our derived names are one truck", () => {
    expect(run([tractor()], [ours()])).toEqual({ findings: [], known: [] });
  });

  it("reports a McLeod truck no row of ours carries", () => {
    const r = run([tractor(), tractor({ external_id: "811", unit_number: "811" })], [ours()]);
    expect(r.findings).toEqual([{ entity: "tractor", kind: "missing_here", unit: "811", externalId: "811" }]);
  });

  it("reports a live row McLeod no longer lists, and a live row with no McLeod link at all", () => {
    const r = run([tractor()], [ours(), ours({ id: "v-9", unit_number: "999", link: "999" }), ours({ id: "v-x", unit_number: "G6AA-5HS", link: null })]);
    expect(r.findings.map((f) => [f.kind, f.unit])).toEqual([
      ["not_in_mcleod", "999"],
      ["not_in_mcleod", "G6AA-5HS"],
    ]);
  });

  it("does not report an ordered or a retired row missing from the list — P4 cannot contain them", () => {
    const r = run([tractor()], [ours(), ours({ id: "v-814", unit_number: "814", link: "814", status: "ordered" }), ours({ id: "v-r", unit_number: "183", link: "183", status: "retired" })]);
    expect(r.findings).toEqual([]);
  });

  it("reports two of our rows on one McLeod id, and no field verdict for that pair", () => {
    const r = run([tractor({ vin: "DIFFERENT" })], [ours(), ours({ id: "v-old", unit_number: "506 - OLD" })]);
    expect(r.findings).toEqual([{ entity: "tractor", kind: "duplicate_link", unit: "506", externalId: "506", rowIds: ["v-506", "v-old"] }]);
  });

  it("reports each field that differs, McLeod's value beside ours", () => {
    const r = run([tractor({ vin: "3AKJHHDR0LSLL7399", year: 2021, purchased_at: "2020-08-01" })], [ours()]);
    expect(r.findings.map((f) => (f.kind === "mismatch" ? `${f.field}:${f.mcleod}:${f.ours}` : f.kind))).toEqual([
      "vin:3AKJHHDR0LSLL7399:3AKJHHDR0LSLL7398",
      "year:2021:2020",
      "purchased_at:2020-08-01:2020-07-01",
    ]);
  });

  it("compares make and model on the derived values, not McLeod's spelling", () => {
    const r = compareFleetParity({
      tractors: { mcleod: [tractor()], ours: [ours({ model: "LT625" })], derived: derivedFor("506") },
      trailers: { mcleod: [], ours: [] },
    });
    expect(r.findings).toMatchObject([{ kind: "mismatch", field: "model", mcleod: "Cascadia", ours: "LT625" }]);
  });

  it("treats a field McLeod leaves empty as no claim", () => {
    const r = run([tractor({ vin: null, year: null, purchased_at: "2020-07-01" })], [ours()]);
    expect(r.findings).toEqual([]);
  });

  it("derives McLeod's status with the sweep's own rule: in the shop is maintenance", () => {
    expect(run([tractor({ in_shop: true })], [ours()]).findings).toMatchObject([{ field: "status", mcleod: "maintenance", ours: "active" }]);
    // The agent did not read the sub-status, so it cannot say the truck has LEFT the shop.
    expect(run([tractor({ in_shop: undefined })], [ours({ status: "maintenance" })]).findings).toEqual([]);
  });

  it("lists a Samsara-SOLD truck McLeod still carries as a known state, with what differs, not as an alarm", () => {
    const r = run([tractor({ external_id: "632", unit_number: "632" })], [ours({ id: "v-632", unit_number: "632", link: "632", status: "retired", samsara_name: "632 - SOLD" })]);
    expect(r.findings).toEqual([]);
    expect(r.known).toMatchObject([{ unit: "632", reason: "sold_awaiting_pickup", findings: [{ field: "status", mcleod: "active", ours: "retired" }] }]);
  });

  it("does not call a truck known because of the name alone once McLeod has let it go", () => {
    const r = run([], [ours({ samsara_name: "506 - SOLD" })]);
    expect(r.known).toEqual([]);
    expect(r.findings).toMatchObject([{ kind: "not_in_mcleod", unit: "506" }]);
  });

  it("checks trailers by link, VIN, year, purchase date and presence", () => {
    const t: TmsTrailerInput = { external_id: "532159", unit_number: "532159", vin: "1JJV532W0KL000001", year: 2019, purchased_at: "2019-05-01" };
    const mine: ParityOurRow = { id: "t-1", unit_number: "R532159", link: "532159", status: "active", vin: "1JJV532W0KL000001", year: 2019, purchased_at: "2019-05-01" };
    expect(run([], [], { m: [t], o: [mine] }).findings).toEqual([]);
    expect(run([], [], { m: [t], o: [{ ...mine, status: "retired" }] }).findings).toMatchObject([{ entity: "trailer", field: "status", mcleod: "active", ours: "retired" }]);
  });
});

describe("the Samsara SOLD name", () => {
  it.each([
    ["568 - SOLD", true],
    ["568-sold", true],
    ["183 - SOLD ", true],
    ["568 - OLD", false],
    ["SOLDIER 1", false],
    [null, false],
  ])("%s → %s", (name, expected) => expect(isSoldAwaitingPickup(name)).toBe(expected));
});

describe("finding keys and words", () => {
  it("gives a changed value a new key, so it alerts again", () => {
    const a = run([tractor({ year: 2021 })], [ours()]).findings[0]!;
    const b = run([tractor({ year: 2022 })], [ours()]).findings[0]!;
    expect(parityFindingKey(a)).not.toBe(parityFindingKey(b));
  });

  it("says each finding in plain words", () => {
    const [f] = run([tractor({ year: 2021 })], [ours()]).findings;
    expect(describeParityFinding(f!)).toBe("Truck 506: model year is 2021 in McLeod, 2020 here.");
  });
});

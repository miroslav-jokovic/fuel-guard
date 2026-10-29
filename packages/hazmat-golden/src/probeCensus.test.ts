import { describe, expect, it } from "vitest";
import { evaluateLoad, UNEVALUATED_INPUTS, UNEVALUATED_LINE_INPUTS, type LoadInput, type Verdict } from "@hazmat/engine";
import { loadDataset } from "@hazmat/data";

/**
 * The coverage statement held to the rules (TWO-CLICK-READER-PLAN TC0.4, D-TC11). `UNEVALUATED_INPUTS` and
 * `UNEVALUATED_LINE_INPUTS` say "the engine accepts this input and no rule reads it", and a provided value becomes a
 * `not_evaluated:<path>` conditional that blocks auto-clear. A claim like that rots silently: on 2026-10-29 two
 * entries were found contradicting the rules beside them — a residue line excluded from the §172.504(c) aggregate
 * AND reported as not evaluated (E5), and the vessel question read by the marine-pollutant rule AND reported as
 * not evaluated (E6), so a dispatcher answering "No" blocked every load.
 *
 * The census asks the rules directly, never a copy of them: every entry of the shipped table, alone, as bulk on a
 * cargo tank and as 1,500 lb non-bulk in a van, is evaluated without the input and then with each value the probe
 * would report — and the verdict with the input audit taken out (its `not_evaluated:*` findings, and the eligibility
 * status they move) must be identical. If a rule reads the input, some entry's verdict moves and the probe is stale.
 */
const ds = loadDataset();
const refs = ds.entries.flatMap((e) => e.pgRows.map((r) => `${e.entryId}#${r.pg ?? "none"}`));

const BASES = [
  { vehicle: "cargo_tank", kind: "bulk", lb: 500 },
  { vehicle: "van_or_flatbed", kind: "non_bulk", lb: 1500 },
] as const;
type Base = (typeof BASES)[number];

const load = (ref: string, b: Base): LoadInput =>
  ({
    evaluatedAt: "2026-10-29T00:00:00Z",
    dataset: ds as unknown,
    vehicle: { kind: b.vehicle, cargoTankCapacityGal: null, compartments: null },
    tankState: "loaded",
    otherFreightAboard: true,
    lines: [{ hmtRef: ref, packagingKind: b.kind, grossWeightLb: b.lb, packageCount: b.kind === "bulk" ? 1 : 20, quantity: { value: b.lb, unit: "lb" } }],
  }) as unknown as LoadInput;

type Line = LoadInput["lines"][number];
type Mutate = (l: LoadInput) => void;
type MutateLine = (line: Line) => void;
/**
 * Every value a probe would report, per probe path. Keyed by the lists' own paths, and checked against them below,
 * so a probe added without a mutation here fails this census rather than passing it unexamined.
 */
const LOAD_VALUES: Record<string, Mutate[]> = {
  policy: [(l) => (l.policy = { requireDriverAck: true })],
  "vehicle.cargoTankCapacityGal": [(l) => (l.vehicle.cargoTankCapacityGal = 9000)],
  "vehicle.compartments": [(l) => (l.vehicle.compartments = [{ index: 0, capacityGal: 3000 }, { index: 1, capacityGal: 6000 }])],
  "tankState=residue_uncleaned": [(l) => (l.tankState = "residue_uncleaned")],
  "claimedExceptions.shipperClaimsNoPlacards": [(l) => (l.claimedExceptions = { shipperClaimsNoPlacards: true, claimedSpecialPermits: [] })],
  "claimedExceptions.claimedSpecialPermits": [(l) => (l.claimedExceptions = { shipperClaimsNoPlacards: false, claimedSpecialPermits: ["DOT-SP 20000"] })],
  "portContext.imdgPapers": [true, false].map((v) => (l: LoadInput) => (l.portContext = { vesselConnected: null, imdgPapers: v })),
  "tripContext.previousOrCurrentBusinessDayIds": [(l) => (l.tripContext = { previousOrCurrentBusinessDayIds: ["UN1203"], carrierRelationship: "unknown" })],
};
const LINE_VALUES: Record<string, MutateLine[]> = {
  flashPointF: [50, 150].map((v) => (line: Line) => (line.flashPointF = v)),
  ethanolPct: [10, 85].map((v) => (line: Line) => (line.ethanolPct = v)),
  compartmentIndex: [(line) => (line.compartmentIndex = 0)],
};
/**
 * The two inputs that left the lists in 0.23.0 because rules read them (E5, E6) — kept here as the census's positive
 * controls: if it stopped seeing these verdicts move, it would be passing everything vacuously.
 */
const READ_BY_RULES = {
  vessel: [true, false].map((v) => (l: LoadInput) => (l.portContext = { vesselConnected: v, imdgPapers: null })),
  residue: [(line: Line) => (line.isResidueLine = true)],
};

/** A whole-table sweep is ~1 s locally and ~7 s on CI's runner (2026-10-29); vitest's 5 s default is not a census's. */
const SWEEP_MS = 600_000;

const isAudit = (ruleId: string) => ruleId.startsWith("not_evaluated:");
/** The verdict with the input audit removed — what the rules decided, which a probed input must not move. */
const decided = (v: Verdict) => JSON.stringify({
  placards: v.placards,
  notices: v.notices,
  segregation: v.segregation,
  bol: v.bol,
  blocks: v.eligibility.blocks.filter((f) => !isAudit(f.ruleId)),
});

/** Every entry × base where giving the probe a value moved what the rules decided, as `ref @ vehicle`. */
function moved<T>(mutations: Array<(t: T) => void>, at: (l: LoadInput) => T): string[] {
  const out: string[] = [];
  for (const ref of refs) {
    for (const b of BASES) {
      const before = decided(evaluateLoad(load(ref, b)));
      for (const m of mutations) {
        const l = load(ref, b);
        m(at(l));
        const v = evaluateLoad(l);
        if (decided(v) !== before) out.push(`${ref} @ ${b.vehicle}`);
      }
    }
  }
  return out;
}

describe("the coverage statement against the rules — no probed input moves a verdict (TC0.4, D-TC11)", () => {
  it("has a value for every probe the engine lists, and no value for a probe it does not", () => {
    expect(Object.keys(LOAD_VALUES).sort()).toEqual(UNEVALUATED_INPUTS.map((p) => p.path).sort());
    expect(Object.keys(LINE_VALUES).sort()).toEqual(UNEVALUATED_LINE_INPUTS.map((p) => p.key).sort());
  });

  it("runs over the whole shipped table", () => {
    expect(refs.length).toBeGreaterThan(3000);
  });

  // The census would pass vacuously if a mutation never reached the audit: each one must raise its own finding.
  it("raises a not_evaluated finding for every value it gives, so each mutation is one the audit sees", () => {
    const ref = refs[0]!;
    for (const [path, ms] of Object.entries(LOAD_VALUES)) {
      for (const m of ms) {
        const l = load(ref, BASES[1]);
        m(l);
        expect(evaluateLoad(l).eligibility.blocks.map((f) => f.ruleId), path).toContain(`not_evaluated:${path}`);
      }
    }
    for (const [key, ms] of Object.entries(LINE_VALUES)) {
      for (const m of ms) {
        const l = load(ref, BASES[1]);
        m(l.lines[0]!);
        expect(evaluateLoad(l).eligibility.blocks.map((f) => f.ruleId), key).toContain(`not_evaluated:lines[0].${key}`);
      }
    }
  });

  it("sees a verdict move when a rule does read the input — the vessel question and a residue line, on many entries", () => {
    expect(UNEVALUATED_INPUTS.map((p) => p.path)).not.toContain("portContext.vesselConnected");
    expect(UNEVALUATED_LINE_INPUTS.map((p) => p.key as string)).not.toContain("isResidueLine");
    expect(moved(READ_BY_RULES.vessel, (l) => l).length).toBeGreaterThan(10);
    expect(moved(READ_BY_RULES.residue, (l) => l.lines[0]!).length).toBeGreaterThan(10);
  }, SWEEP_MS);

  for (const probe of UNEVALUATED_INPUTS) {
    it(`no rule reads ${probe.path}: giving it a value moves no verdict on any entry`, () => {
      expect(moved(LOAD_VALUES[probe.path] ?? [], (l) => l).slice(0, 5)).toEqual([]);
    }, SWEEP_MS);
  }
  for (const probe of UNEVALUATED_LINE_INPUTS) {
    it(`no rule reads a line's ${probe.key}: giving it a value moves no verdict on any entry`, () => {
      expect(moved(LINE_VALUES[probe.key] ?? [], (l) => l.lines[0]!).slice(0, 5)).toEqual([]);
    }, SWEEP_MS);
  }
});

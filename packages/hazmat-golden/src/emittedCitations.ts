import { evaluateLoad, type LoadInput, type Verdict } from "@hazmat/engine";
import { loadDataset } from "@hazmat/data";

/**
 * Every `cfr` string the engine emits over the shipped table (TWO-CLICK-READER-PLAN TC0.5, D-TC10): each entry row
 * alone at the placard census's four loads on a van and as bulk on a cargo tank, each row with each claim the
 * form can make (limited quantity, residue, a vessel leg), and seeded pairs — so the segregation grid, the
 * §172.505 subsidiaries, the ID-display ladder and the paper rules all speak. Read from the WHOLE verdict
 * (placards, findings, notices, segregation, paper lines, trace), wherever a `cfr` key appears.
 */
const ds = loadDataset();
const refs = ds.entries.flatMap((e) => e.pgRows.map((r) => `${e.entryId}#${r.pg ?? "none"}`));

type Kind = "bulk" | "non_bulk";
interface Pick { ref: string; kind: Kind; lb: number; lq?: boolean; residue?: boolean }

const load = (picks: Pick[], vehicle: "van_or_flatbed" | "cargo_tank", vessel: boolean | null = null): LoadInput =>
  ({
    evaluatedAt: "2026-10-29T00:00:00Z",
    dataset: ds as unknown,
    vehicle: { kind: vehicle, cargoTankCapacityGal: null, compartments: null },
    tankState: "loaded",
    otherFreightAboard: picks.length > 1 ? true : null,
    portContext: { vesselConnected: vessel, imdgPapers: null },
    lines: picks.map((p) => ({
      hmtRef: p.ref, packagingKind: p.kind, grossWeightLb: p.lb, packageCount: p.kind === "bulk" ? 1 : 20,
      quantity: { value: p.lb, unit: "lb" }, isLimitedQuantity: p.lq ?? false, isResidueLine: p.residue ?? false,
    })),
  }) as unknown as LoadInput;

function collect(v: unknown, into: Map<string, string>, where: string): void {
  if (Array.isArray(v)) for (const x of v) collect(x, into, where);
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (k === "cfr" && typeof x === "string") { if (!into.has(x)) into.set(x, where); }
      else collect(x, into, where);
    }
  }
}

/** Seeded (mulberry32), so a failure names a load that reproduces. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** cfr string → the first load that emitted it (for a failure message). */
export function emittedCitations(pairs = 4000): Map<string, string> {
  const out = new Map<string, string>();
  const run = (l: LoadInput, where: string) => collect(evaluateLoad(l) as Verdict, out, where);
  for (const ref of refs) {
    run(load([{ ref, kind: "bulk", lb: 500 }], "cargo_tank"), `${ref} bulk tank`);
    for (const lb of [500, 1500, 9000]) run(load([{ ref, kind: "non_bulk", lb }], "van_or_flatbed"), `${ref} ${lb} lb van`);
    run(load([{ ref, kind: "non_bulk", lb: 1500, lq: true }], "van_or_flatbed"), `${ref} LQ`);
    run(load([{ ref, kind: "non_bulk", lb: 1500, residue: true }], "van_or_flatbed"), `${ref} residue`);
    run(load([{ ref, kind: "non_bulk", lb: 1500 }], "van_or_flatbed", true), `${ref} vessel leg`);
  }
  const r = rng(20261029);
  for (let i = 0; i < pairs; i++) {
    const a = refs[Math.floor(r() * refs.length)]!;
    const b = refs[Math.floor(r() * refs.length)]!;
    run(load([{ ref: a, kind: "non_bulk", lb: 1500 }, { ref: b, kind: "non_bulk", lb: 1500 }], "van_or_flatbed"), `${a} + ${b}`);
  }
  // A cleaned tank and a load with no hazmat take the engine's two early exits.
  run({ ...load([{ ref: refs[0]!, kind: "bulk", lb: 500 }], "cargo_tank"), tankState: "cleaned_and_purged" } as LoadInput, "cleaned tank");
  run(load([], "van_or_flatbed"), "no hazmat");
  return out;
}

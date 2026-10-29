import { describe, expect, it } from "vitest";
import { evaluateLoad, type LoadInput } from "@hazmat/engine";
import { loadDataset } from "@hazmat/data";

/**
 * The placard census: the engine against the WHOLE shipped Hazardous Materials Table, held to rules read
 * from the CFR rather than restated from the engine. The 2026-10-19 Mayo Products BOL lost UN1830 from the
 * answer through a fault no five-material fixture could show was absent elsewhere; this is the check that
 * would have found it on any pair of entries. Every row of every entry is run alone at four loads, then
 * seeded random loads of two and three lines drawn from the whole table.
 *
 * What a verdict must never do, whichever entries it is given (each is a CFR sentence):
 *   1 §172.504(c)    — a bulk line, or ≥1,001 lb of non-bulk Table 2 material, leaves its placard required.
 *   2 §172.331(c)    — every bulk line's identification number is displayed.
 *   3 §172.332(c)    — a number rides only on a required placard of its own material.
 *   4 §172.334(d)    — a placard that carries numbers carries every number of its class aboard.
 *   5 (display)      — a number on no placard is not recommended `on_placard`.
 *   6 §172.504       — no required placard that no line aboard asked for (a §172.505 subsidiary is asked for).
 * A line the engine refuses (Table 1, explosives, an ambiguous class) withholds the WHOLE verdict — no
 * placards at all — which is checked instead of 1–6.
 */
const ds = loadDataset();

type Kind = "bulk" | "non_bulk";
interface Pick { ref: string; kind: Kind; lb: number }
const LOADS: Array<{ kind: Kind; lb: number }> = [
  { kind: "bulk", lb: 500 }, { kind: "non_bulk", lb: 500 }, { kind: "non_bulk", lb: 1500 }, { kind: "non_bulk", lb: 9000 },
];
const refs = ds.entries.flatMap((e) => e.pgRows.map((r) => `${e.entryId}#${r.pg ?? "none"}`));

const load = (picks: Pick[]): LoadInput =>
  ({
    evaluatedAt: "2026-10-19T00:00:00Z",
    dataset: ds as unknown,
    vehicle: { kind: "van_or_flatbed", cargoTankCapacityGal: null, compartments: null },
    tankState: "loaded",
    otherFreightAboard: true,
    lines: picks.map((p) => ({
      hmtRef: p.ref, packagingKind: p.kind, grossWeightLb: p.lb, packageCount: p.kind === "bulk" ? 1 : 20,
      quantity: { value: p.lb, unit: "lb" },
    })),
  }) as unknown as LoadInput;

/** The placard and ID each pick gets when it rides ALONE as bulk — its own answer, the reference for mixes. */
const alone = new Map<string, { placard: string | null; id: string | null; withheld: boolean }>();
function own(ref: string) {
  let a = alone.get(ref);
  if (!a) {
    const v = evaluateLoad(load([{ ref, kind: "bulk", lb: 500 }]));
    const req = v.placards.required.map((p) => p.placard);
    a = { placard: req[0] ?? null, id: v.placards.idDisplays[0]?.idNumber ?? null, withheld: req.length === 0 };
    alone.set(ref, a);
  }
  return a;
}


/** Seeded (mulberry32), so a failure names a load that reproduces. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function violations(picks: Pick[]): string[] {
  const v = evaluateLoad(load(picks));
  const out: string[] = [];
  const req = new Set<string>(v.placards.required.map((p) => p.placard));
  const owns = picks.map((p) => ({ ...p, ...own(p.ref) }));
  if (owns.some((o) => o.withheld)) {
    // A refused line refuses the load. Some entries take no placard at all (6.2, ORM-D…): those are not refusals.
    return [];
  }
  const sub = new Set(v.trace.filter((t) => t.ruleId === "subsidiary_placard_172_505").flatMap((t) => (t.inputs.placard ? [String(t.inputs.placard)] : [])));
  const nonBulkLb = new Map<string, number>();
  for (const o of owns) if (o.kind === "non_bulk" && o.placard) nonBulkLb.set(o.placard, (nonBulkLb.get(o.placard) ?? 0) + o.lb);
  const totalNonBulk = [...nonBulkLb.values()].reduce((s, x) => s + x, 0);
  for (const o of owns) {
    if (!o.placard) continue;
    if ((o.kind === "bulk" || totalNonBulk >= 1001) && !req.has(o.placard) && !v.placards.optionalSubstitutions.some((s) => s.instead === o.placard))
      out.push(`1 ${o.ref} ${o.kind} → ${o.placard} not required`);
    if (o.kind === "bulk" && o.id && !v.placards.idDisplays.some((d) => d.idNumber === o.id)) out.push(`2 ${o.ref} → ${o.id} not displayed`);
  }
  const placardOfId = new Map(owns.filter((o) => o.id).map((o) => [o.id!, o.placard]));
  for (const d of v.placards.idDisplays) {
    for (const p of d.onPlacards) {
      if (p !== placardOfId.get(d.idNumber)) out.push(`3 ${d.idNumber} on ${p}, its own is ${placardOfId.get(d.idNumber)}`);
      if (!req.has(p)) out.push(`3 ${d.idNumber} on ${p}, not required`);
    }
    if (d.format === "on_placard" && d.onPlacards.length === 0) out.push(`5 ${d.idNumber} on_placard with no placard`);
  }
  for (const p of req) {
    const carried = new Set(v.placards.idDisplays.filter((d) => d.format === "on_placard" && (d.onPlacards as string[]).includes(p)).map((d) => d.idNumber));
    if (carried.size === 0) continue;
    const aboard = new Set(owns.filter((o) => o.placard === p && o.id).map((o) => o.id!));
    for (const id of aboard) if (!carried.has(id)) out.push(`4 ${p} carries ${[...carried]} but not ${id}`);
  }
  const asked = new Set(owns.map((o) => o.placard));
  for (const p of req) if (!asked.has(p) && !sub.has(p) && p !== "DANGEROUS") out.push(`6 ${p} required, no line asked for it`);
  return out;
}

describe("the placard census — the whole Hazardous Materials Table", () => {
  it("every row alone, at four loads", () => {
    const bad: string[] = [];
    for (const ref of refs) for (const l of LOADS) for (const x of violations([{ ref, ...l }])) bad.push(`${ref} ${l.kind} ${l.lb}: ${x}`);
    expect(refs.length).toBeGreaterThan(2400);
    expect(bad.slice(0, 20)).toEqual([]);
  }, 300_000);

  it("20,000 seeded loads of two and three lines from the whole table", () => {
    const r = rng(20261019);
    const bad: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) {
      const n = 2 + Math.floor(r() * 2);
      const picks = Array.from({ length: n }, () => ({ ref: refs[Math.floor(r() * refs.length)]!, ...LOADS[Math.floor(r() * LOADS.length)]! }));
      seen.add(JSON.stringify(picks));
      for (const x of violations(picks)) bad.push(`${JSON.stringify(picks)}: ${x}`);
    }
    expect(seen.size).toBeGreaterThan(19_900);
    expect(bad.slice(0, 20)).toEqual([]);
  }, 600_000);

  // §172.505(c): "Each transport vehicle … that contains a material which has a subsidiary hazard of being dangerous
  // when wet … shall be placarded with DANGEROUS WHEN WET placards" (cited as (b) until 2026-10-29 — E4). The engine read the entries' subsidiary list
  // for this since 2026-08 and the list was empty on every entry of every cut until 2026-10-26 (D-PC1), so this
  // placard had never once been asked for on the real table — and invariant 6 above, which allows a §172.505
  // placard, was vacuous. The count is the guard: a dataset that lists no 4.3 subsidiary fails here, not silently.
  it("every entry whose column (6) lists a 4.3 subsidiary raises DANGEROUS WHEN WET, non-bulk at 500 lb and bulk alike (§172.505(c))", () => {
    const dww = ds.entries.filter((e) => e.hazardClass !== "4.3" && e.subsidiaryClasses.includes("4.3"));
    expect(dww.length).toBeGreaterThan(10);
    const bad: string[] = [];
    for (const e of dww) {
      for (const row of e.pgRows) {
        const ref = `${e.entryId}#${row.pg ?? "none"}`;
        for (const l of [{ kind: "non_bulk" as const, lb: 500 }, { kind: "bulk" as const, lb: 500 }]) {
          const v = evaluateLoad(load([{ ref, ...l }]));
          if (v.placards.required.length === 0) continue; // the line itself refused (Table 1 subsidiary, zone)
          if (!v.placards.required.some((p) => p.placard === "DANGEROUS_WHEN_WET")) bad.push(`${ref} ${l.kind}: ${v.placards.required.map((p) => p.placard).join("+")}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  // Segregation, subsidiary hazards included, moved to segregationCensus.test.ts on 2026-10-29 (TWO-CLICK-READER-PLAN
  // TC1.1). The test that stood here collapsed every grid label to its class number ("6.1 liquids PG I zone A" → "6.1")
  // with a helper of its own — the engine's simplification restated — and so demanded the false violations of E1.

  it("same-class pairs — the Mayo shape, two bulk materials of one class — across every class", () => {
    const r = rng(1824_1830);
    const byPlacard = new Map<string, string[]>();
    for (const ref of refs) {
      const o = own(ref);
      if (o.placard && o.id) byPlacard.set(o.placard, [...(byPlacard.get(o.placard) ?? []), ref]);
    }
    const bad: string[] = [];
    for (const [, rs] of byPlacard) {
      for (let i = 0; i < 300; i++) {
        const a = rs[Math.floor(r() * rs.length)]!, b = rs[Math.floor(r() * rs.length)]!;
        const picks: Pick[] = [{ ref: a, kind: "bulk", lb: 20000 }, { ref: b, kind: r() < 0.5 ? "bulk" : "non_bulk", lb: 5000 }];
        for (const x of violations(picks)) bad.push(`${JSON.stringify(picks)}: ${x}`);
      }
    }
    expect(byPlacard.size).toBeGreaterThan(8);
    expect(bad.slice(0, 20)).toEqual([]);
  }, 300_000);
});

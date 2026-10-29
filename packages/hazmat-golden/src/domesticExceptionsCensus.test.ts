import { describe, expect, it } from "vitest";
import { evaluateLoad, type LoadInput, type Verdict } from "@hazmat/engine";
import { loadDataset } from "@hazmat/data";

/**
 * §172.504(f)(9) and §173.150(f)(2) over every row they reach (TWO-CLICK-READER-PLAN TC1.2, D-TC9; E2, E3).
 *
 * Every Class 9 row, and every combustible-liquid row — NA1993 "Comb liq", and each Class 3 row as the shipper may
 * reclass it under §173.150(f)(1) — in bulk on a cargo tank, in bulk in a van, and non-bulk at 500, 1,500 and 9,000 lb,
 * alone and beside 500 lb of paint (UN1263, Class 3 PG II, which on its own is under the 1,001-lb aggregate):
 *
 *   (f)(9)  CLASS 9 is never a required placard, bulk or not; a bulk Class 9 line's ID number is still displayed, and
 *           never on a placard nobody must display; Class 9 non-bulk weight still counts toward the aggregate, so
 *           ≥501 lb of it beside the paint requires FLAMMABLE — the waiver is of the placard, not of the material.
 *   (f)(2)  a non-bulk combustible liquid takes no placard and adds nothing to the aggregate: beside the paint, at any
 *           weight, FLAMMABLE is not required. In bulk it placards COMBUSTIBLE, as before.
 */
const ds = loadDataset();
type Kind = "bulk" | "non_bulk";
interface Pick { ref: string; kind: Kind; lb: number; reclassed?: boolean }

const load = (picks: Pick[], vehicle: "cargo_tank" | "van_or_flatbed"): LoadInput =>
  ({
    evaluatedAt: "2026-10-29T00:00:00Z", dataset: ds as unknown, tankState: "loaded", otherFreightAboard: true,
    vehicle: { kind: vehicle, cargoTankCapacityGal: null, compartments: null },
    lines: picks.map((p) => ({
      hmtRef: p.ref, packagingKind: p.kind, grossWeightLb: p.lb, packageCount: p.kind === "bulk" ? 1 : 20,
      quantity: { value: p.lb, unit: "lb" }, reclassedCombustible: p.reclassed ?? false,
    })),
  }) as unknown as LoadInput;

const refOf = (e: (typeof ds.entries)[number]) => e.pgRows.map((r) => `${e.entryId}#${r.pg ?? "none"}`);
const class9 = ds.entries.filter((e) => e.hazardClass === "9" && e.subsidiaryClasses.length === 0).flatMap(refOf);
const combLiq = ds.entries.filter((e) => /comb/i.test(e.hazardClass ?? "")).flatMap(refOf);
const class3 = ds.entries.filter((e) => e.hazardClass === "3" && e.subsidiaryClasses.length === 0).flatMap(refOf);
const paint = refOf(ds.entries.find((e) => e.idPrefix === "UN" && e.idNumber === "1263")!).find((r) => r.endsWith("#II"))!;

const required = (v: Verdict) => v.placards.required.map((p) => p.placard as string);
const withheld = (v: Verdict) => v.eligibility.blocks.some((b) => b.ruleId === "placard_determination_withheld");
const SHAPES: Array<{ kind: Kind; lb: number; vehicle: "cargo_tank" | "van_or_flatbed" }> = [
  { kind: "bulk", lb: 500, vehicle: "cargo_tank" }, { kind: "bulk", lb: 500, vehicle: "van_or_flatbed" },
  { kind: "non_bulk", lb: 500, vehicle: "van_or_flatbed" }, { kind: "non_bulk", lb: 1500, vehicle: "van_or_flatbed" },
  { kind: "non_bulk", lb: 9000, vehicle: "van_or_flatbed" },
];

describe("§172.504(f)(9) — CLASS 9 is never a required placard in domestic transportation", () => {
  it("reaches every Class 9 row of the table", () => {
    expect(class9.length).toBeGreaterThan(40);
  });

  it("never requires CLASS 9, alone or beside paint, and displays a bulk line's ID number off any placard", () => {
    const bad: string[] = [];
    let bulkIds = 0;
    for (const ref of class9) for (const s of SHAPES) {
      const v = evaluateLoad(load([{ ref, kind: s.kind, lb: s.lb }], s.vehicle));
      if (withheld(v)) continue;
      if (required(v).includes("CLASS_9")) bad.push(`${ref} ${s.kind} ${s.lb}: CLASS_9 required`);
      if ((s.kind === "bulk" || s.lb >= 1001) && !v.placards.permitted.some((p) => p.placard === "CLASS_9")) bad.push(`${ref} ${s.kind} ${s.lb}: CLASS_9 not offered as permitted`);
      if (s.kind === "bulk") {
        const id = v.placards.idDisplays.find((d) => d.idNumber.endsWith(ref.split("-")[0]!.slice(2)));
        if (!id) bad.push(`${ref} bulk: ID number not displayed`);
        else { bulkIds++; if (id.onPlacards.length > 0) bad.push(`${ref} bulk: ID on ${id.onPlacards.join(",")}`); }
      }
      const mixed = evaluateLoad(load([{ ref, kind: s.kind, lb: s.lb }, { ref: paint, kind: "non_bulk", lb: 500 }], "van_or_flatbed"));
      if (required(mixed).includes("CLASS_9")) bad.push(`${ref} + paint: CLASS_9 required`);
    }
    expect(bulkIds).toBeGreaterThan(40);
    expect(bad.slice(0, 20)).toEqual([]);
  }, 300_000);

  it("still counts Class 9 non-bulk weight toward the aggregate: 1,500 lb of it beside 500 lb of paint requires FLAMMABLE", () => {
    const bad: string[] = [];
    for (const ref of class9) {
      const v = evaluateLoad(load([{ ref, kind: "non_bulk", lb: 1500 }, { ref: paint, kind: "non_bulk", lb: 500 }], "van_or_flatbed"));
      if (withheld(v)) continue;
      if (!required(v).includes("FLAMMABLE")) bad.push(`${ref}: FLAMMABLE not required (${required(v).join(",")})`);
    }
    expect(bad.slice(0, 20)).toEqual([]);
  }, 300_000);
});

describe("§173.150(f)(2) — a non-bulk combustible liquid is not regulated on the highway", () => {
  // NA1993 "Comb liq" as listed, and every plain Class 3 row as the shipper reclassed it.
  const combustibles: Pick[] = [...combLiq.map((ref) => ({ ref, kind: "non_bulk" as Kind, lb: 0 })), ...class3.map((ref) => ({ ref, kind: "non_bulk" as Kind, lb: 0, reclassed: true }))];

  it("reaches NA1993 and every Class 3 row reclassed", () => {
    expect(combLiq.length).toBeGreaterThan(0);
    expect(combustibles.length).toBeGreaterThan(200);
  });

  it("takes no placard and adds nothing to the aggregate in non-bulk, at any weight; placards COMBUSTIBLE in bulk", () => {
    const bad: string[] = [];
    for (const c of combustibles) for (const s of SHAPES) {
      const v = evaluateLoad(load([{ ...c, kind: s.kind, lb: s.lb }], s.vehicle));
      if (withheld(v)) continue;
      if (s.kind === "non_bulk" && required(v).length > 0) bad.push(`${c.ref} non-bulk ${s.lb}: ${required(v).join(",")} required`);
      if (s.kind === "bulk" && !required(v).includes("COMBUSTIBLE")) bad.push(`${c.ref} bulk ${s.vehicle}: COMBUSTIBLE not required (${required(v).join(",")})`);
      if (s.kind === "non_bulk") {
        const mixed = evaluateLoad(load([{ ...c, kind: "non_bulk", lb: s.lb }, { ref: paint, kind: "non_bulk", lb: 500 }], "van_or_flatbed"));
        if (required(mixed).length > 0) bad.push(`${c.ref} ${s.lb} lb + 500 lb paint: ${required(mixed).join(",")} required`);
      }
    }
    expect(bad.slice(0, 20)).toEqual([]);
  }, 300_000);
});

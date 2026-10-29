import { describe, expect, it } from "vitest";
import { evaluateLoad, type LoadInput } from "@hazmat/engine";
import { loadDataset, loadReferenceText, type Dataset } from "@hazmat/data";

/**
 * The segregation census (TWO-CLICK-READER-PLAN TC1.1, D-TC8; E1): every row of the shipped table beside a plain
 * material of every row of the §177.848(d) grid, judged by an oracle that does NOT share the engine's reading.
 *
 * Its predecessor in placardCensus.test.ts collapsed every grid label to its class number with a `baseOf()` of its
 * own — the engine's simplification, restated — so it certified the engine's false violation on 3 + 6.1 PG III. Here
 * each label's qualifiers are written out by hand from the row titles §177.848(d) prints ("Poisonous liquids PG I
 * Zone A", "Corrosive liquids", "Poisonous gas Zone B"), and each material's facts come from different witnesses
 * than the engine's: its hazard ZONE from the text of §172.102(c)(1) in the reference store (which provision says
 * "Hazard Zone A"), and its PHASE from the words of its shipping name ("solid", "liquid", "solution"). A name that
 * states no phase — "Acetic acid, glacial", "Acetyl chloride" — falls back to column 9's units (litres or kilograms),
 * the witness the engine uses; that fallback is itself held to the shipping names on every row where both speak
 * (the second test below), so it is a checked witness, not the engine agreeing with itself. Where the oracle still
 * cannot tell a fact, it allows any answer up to the most severe row the material might be on.
 *
 * What must hold, on every pair:
 *   1 never a `segregation_prohibited` violation the oracle cannot prove from rows the materials are on;
 *   2 every violation the oracle proves is there;
 *   3 no finding at all where no row the materials might be on restricts them, and none more severe than the worst.
 * Explosives (Class 1) are left out: the engine refuses them before any of this matters (D4-revised).
 */
const ds = loadDataset() as Dataset;
type Entry = Dataset["entries"][number];

/** §177.848(d)'s row titles, by the label the dataset prints, as the qualifiers they state. */
const ROWS: Record<string, { cls: string; phase?: "gas" | "liquid"; pg?: string; zone?: string }> = {
  "2.1": { cls: "2.1" }, "2.2": { cls: "2.2" },
  "2.3 gas zone A": { cls: "2.3", phase: "gas", zone: "A" }, "2.3 gas Zone B": { cls: "2.3", phase: "gas", zone: "B" },
  "3": { cls: "3" }, "4.1": { cls: "4.1" }, "4.2": { cls: "4.2" }, "4.3": { cls: "4.3" }, "5.1": { cls: "5.1" }, "5.2": { cls: "5.2" },
  "6.1 liquids PG I zone A": { cls: "6.1", phase: "liquid", pg: "I", zone: "A" },
  "7": { cls: "7" },
  "8 liquids only": { cls: "8", phase: "liquid" },
};

/** Special provision → hazard zone, read from §172.102(c)(1)'s own text; a provision that says "If this material
 * meets the definition … poisonous by inhalation" makes the zone unknowable. */
const spText = (() => {
  const s = loadReferenceText().sections["172.102"]!;
  return s.paragraphs.map((p) => p.text).join("\n");
})();
const ZONE_BY_SP = new Map<string, string | "?">();
for (let n = 1; n <= 9; n++) {
  const at = spText.search(new RegExp(`(^|\\s)${n} (This material is poisonous by inhalation|If this material meets the definition)`));
  if (at < 0) continue;
  const chunk = spText.slice(at, at + 400);
  const zone = /Hazard Zone ([A-D])/.exec(chunk)?.[1];
  ZONE_BY_SP.set(String(n), /If this material meets/.test(chunk) ? "?" : zone ?? "?");
}

type Tri = boolean | null;
function zoneOf(e: Entry, pg: string | null): string | null {
  const row = e.pgRows.find((r) => (r.pg ?? null) === pg) ?? e.pgRows[0];
  const z = (row?.specialProvisions ?? []).map((sp) => ZONE_BY_SP.get(sp)).filter((x): x is string => x !== undefined);
  if (z.includes("?") || z.length > 1) return null;
  if (z.length === 1) return z[0]!;
  return /inhalation/i.test(e.psnPrinted) ? null : "none";
}
/** The phase the shipping name states, or null. "Solids containing corrosive liquid" is a solid. */
function namedPhase(e: Entry): string | null {
  if (/\bsolids?\b/i.test(e.psnPrinted)) return "solid";
  if (/\b(liquids?|solutions?)\b/i.test(e.psnPrinted)) return "liquid";
  return null;
}
/** Column 9's quantity limits: litres for a liquid, kilograms for a solid; null when it states neither or both. */
function columnNinePhase(e: Entry, pg: string | null): string | null {
  const row = e.pgRows.find((r) => (r.pg ?? null) === pg) ?? e.pgRows[0];
  const units = new Set(Object.values(row?.quantityLimits ?? {}).flatMap((v) => {
    const m = /(\d)\s*(m?L|k?g)\b/.exec(v ?? "");
    return m ? [m[2]!.endsWith("L") ? "liquid" : "solid"] : [];
  }));
  return units.size === 1 ? [...units][0]! : null;
}
/** A fact of the material, whichever of its hazards is being placed: a Class 2 material is a gas. */
function phaseOf(e: Entry, cls: string, pg: string | null): string | null {
  if (cls.startsWith("2") || e.hazardClass!.startsWith("2")) return "gas";
  const z = zoneOf(e, pg);
  // Hazard zones are assigned only to gases (§173.116(a)) and the vapour of liquids (§173.133(a)): zoned, not a gas → liquid.
  if (z !== null && z !== "none") return "liquid";
  return namedPhase(e) ?? columnNinePhase(e, pg);
}
function onRow(label: string, e: Entry, cls: string, pg: string | null): Tri {
  const r = ROWS[label]!;
  if (r.cls !== cls) return false;
  let unknown = false;
  const need = (want: string | undefined, have: string | null): boolean => {
    if (want === undefined) return true;
    if (have === null) { unknown = true; return true; }
    return want === have;
  };
  // 2.3 is a gas by definition and a zoned poison gas; a zone A/B row needs its zone.
  const zone = cls === "2.3" && zoneOf(e, pg) === "none" ? null : zoneOf(e, pg);
  if (!need(r.phase, phaseOf(e, cls, pg)) || !need(r.pg, pg) || !need(r.zone, zone)) return false;
  return unknown ? null : true;
}

const base = (c: string) => /^(\d(?:\.\d)?)/.exec(c)?.[1] ?? c;
const SEV = { O: 1, "*": 2, X: 3 } as const;
type Cell = keyof typeof SEV;
const cell = (a: string, b: string): Cell | null =>
  (ds.segregation.find((c) => (c.rowClass === a && c.colClass === b) || (c.rowClass === b && c.colClass === a))?.value as Cell | undefined) ?? null;

interface Line { e: Entry; pg: string | null }
/** The oracle: per pair of classes on the load, the worst cell they are certainly on, and the worst they might be. */
/** §177.848 keeps MATERIALS apart: two rows restrict a load only when two different materials are on them. */
function oracle(lines: Line[]): Map<string, { sure: Cell | null; most: Cell | null }> {
  const placed = new Map<string, Array<{ label: string; material: number; sure: boolean }>>();
  lines.forEach(({ e, pg }, material) => {
    for (const raw of [e.hazardClass, ...e.subsidiaryClasses]) {
      if (!raw) continue;
      const cls = base(raw);
      const list = placed.get(cls) ?? placed.set(cls, []).get(cls)!;
      for (const label of Object.keys(ROWS)) {
        const m = onRow(label, e, cls, pg);
        if (m !== false) list.push({ label, material, sure: m === true });
      }
    }
  });
  const worst = (a: string, b: string, sureOnly: boolean): Cell | null => {
    let w: Cell | null = null;
    for (const pa of placed.get(a)!) for (const pb of placed.get(b)!) {
      if (pa.material === pb.material || (sureOnly && !(pa.sure && pb.sure))) continue;
      const v = cell(pa.label, pb.label);
      if (v && (!w || SEV[v] > SEV[w])) w = v;
    }
    return w;
  };
  const out = new Map<string, { sure: Cell | null; most: Cell | null }>();
  const classes = [...placed.keys()];
  for (let i = 0; i < classes.length; i++) for (let j = i + 1; j < classes.length; j++) {
    const [a, b] = [classes[i]!, classes[j]!];
    out.set([a, b].sort().join("|"), { sure: worst(a, b, true), most: worst(a, b, false) });
  }
  return out;
}

const RULE_VALUE: Record<string, Cell> = { segregation_prohibited: "X", segregation_away_from: "O", segregation_special: "*" };
function engine(lines: Line[]): Map<string, { rule: string; value: Cell }> {
  const v = evaluateLoad({
    evaluatedAt: "2026-10-29T00:00:00Z", dataset: ds as unknown, otherFreightAboard: true, tankState: "loaded",
    vehicle: { kind: "van_or_flatbed", cargoTankCapacityGal: null, compartments: null },
    lines: lines.map(({ e, pg }) => ({ hmtRef: `${e.entryId}#${pg ?? "none"}`, packagingKind: "non_bulk", grossWeightLb: 800, packageCount: 10, quantity: { value: 800, unit: "lb" } })),
  } as unknown as LoadInput);
  const out = new Map<string, { rule: string; value: Cell }>();
  for (const f of v.segregation) {
    const ev = f.evidence as { classA?: string; classB?: string; value?: Cell };
    if (!ev.classA || !ev.classB) continue;
    out.set([ev.classA, ev.classB].sort().join("|"), { rule: f.ruleId, value: RULE_VALUE[f.ruleId] ?? ev.value! });
  }
  return out;
}

const rows: Line[] = ds.entries
  .filter((e) => e.hazardClass && !e.hazardClass.startsWith("1") && !e.subsidiaryClasses.some((s) => s.startsWith("1")))
  .flatMap((e) => e.pgRows.map((r) => ({ e, pg: r.pg ?? null })));
/** One plain material (no subsidiary) the oracle puts CERTAINLY on each grid row and on no other row of its class. */
const partners: Array<{ label: string; line: Line }> = Object.keys(ROWS).flatMap((label) => {
  const cls = ROWS[label]!.cls;
  const hit = rows.find(({ e, pg }) => e.subsidiaryClasses.length === 0 && base(e.hazardClass!) === cls
    && Object.keys(ROWS).every((l) => onRow(l, e, cls, pg) === (l === label)));
  return hit ? [{ label, line: hit }] : [];
});
/** A plain material of each qualified row's class that is on NO row of the grid — the E1 shape. */
const offRow = ["6.1", "8"].flatMap((cls) => {
  const hit = rows.find(({ e, pg }) => e.subsidiaryClasses.length === 0 && base(e.hazardClass!) === cls
    && Object.keys(ROWS).every((l) => onRow(l, e, cls, pg) === false));
  return hit ? [{ label: `${cls} on no row`, line: hit }] : [];
});

describe("the segregation census — rows matched by their own qualifiers, over the whole table (TC1.1, D-TC8)", () => {
  it("reads the hazard zones from §172.102's own text", () => {
    expect(ZONE_BY_SP.get("1")).toBe("A");
    expect(ZONE_BY_SP.get("2")).toBe("B");
    expect(ZONE_BY_SP.get("5")).toBe("?");
  });

  it("column 9's phase agrees with the shipping name on every row where both state one", () => {
    let both = 0;
    const disagree: string[] = [];
    // Class 2 is a gas whatever its name says ("Nitrogen, refrigerated liquid", measured in kg) — never read by phase.
    for (const { e, pg } of rows.filter(({ e }) => !e.hazardClass!.startsWith("2"))) {
      const named = namedPhase(e), col9 = columnNinePhase(e, pg);
      if (!named || !col9) continue;
      both++;
      if (named !== col9) disagree.push(`${e.entryId}#${pg ?? "none"}: name ${named}, column 9 ${col9}`);
    }
    expect(both).toBeGreaterThan(300);
    expect(disagree).toEqual([]);
  });

  it("has a partner on every row of the grid, and a 6.1 and an 8 on no row", () => {
    expect(partners.map((p) => p.label).sort()).toEqual(Object.keys(ROWS).sort());
    expect(offRow).toHaveLength(2);
  });

  it("never a violation the rows cannot prove, never a proven violation missed, never a finding worse than the worst row", () => {
    const bad: string[] = [];
    let pairs = 0, proven = 0, unresolved = 0;
    for (const r of rows) {
      for (const p of [...partners, ...offRow]) {
        const lines = [r, p.line];
        const want = oracle(lines);
        const got = engine(lines);
        const name = `${r.e.entryId}#${r.pg ?? "none"} + ${p.line.e.entryId} (${p.label})`;
        for (const [pair, w] of want) {
          pairs++;
          const g = got.get(pair);
          if (w.sure === "X") proven++;
          if (g?.rule === "segregation_unresolved") unresolved++;
          if (g?.rule === "segregation_prohibited" && w.sure !== "X") bad.push(`${name} ${pair}: violation the rows do not prove`);
          if (w.sure === "X" && g?.rule !== "segregation_prohibited") bad.push(`${name} ${pair}: proven violation missed (${g?.rule ?? "nothing"})`);
          if (g && (!w.most || SEV[g.value] > SEV[w.most])) bad.push(`${name} ${pair}: ${g.rule} ${g.value} beyond the worst row (${w.most ?? "none"})`);
        }
        for (const pair of got.keys()) if (!want.has(pair)) bad.push(`${name} ${pair}: a finding for a pair the load does not have`);
      }
    }
    expect(pairs).toBeGreaterThan(50_000);
    expect(proven).toBeGreaterThan(4_000); // 4,195 on 2026.07.1
    expect(unresolved).toBeGreaterThan(0);
    expect(bad.slice(0, 20)).toEqual([]);
  }, 600_000);

  it("never segregates a material from its own subsidiary hazard — acrolein (6.1 PG I zone A, subsidiary 3) alone", () => {
    const acrolein = rows.find(({ e }) => e.entryId.startsWith("UN1092-"))!;
    expect(engine([acrolein]).size).toBe(0);
  });

  it("puts no restriction on paint (3, PG II) beside trichloroethylene (6.1, PG III) — E1", () => {
    const find = (un: string, pg: string) => rows.find(({ e, pg: p }) => `${e.idPrefix}${e.idNumber}` === un && p === pg)!;
    const got = engine([find("UN1263", "II"), find("UN1710", "III")]);
    expect([...got.values()]).toEqual([]);
  });
});

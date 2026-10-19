import { describe, expect, it } from "vitest";
import { loadDataset } from "@hazmat/data";
import { alignLines } from "./alignLines.js";

/**
 * The pairing over every misread a reader can make (READER-CORRECTNESS-PLAN RC3, D-RC1). Not the owner's one
 * BOL: a few hundred papers drawn from the whole table, seeded so every run draws the same, plus the owner's
 * seven-line corrosives BOL of 2026-10-19 (two lines printed with the same bare 1760). For every line of every
 * paper and every one-character misread of its id, name, count or weight by the second reader — and for the
 * second reader dropping the line — the line must stay ONE line, paired with itself, and every other line
 * with its own. And two different products read on their own by one reader each must never be paired.
 */
type Line = { tag: string; idText: string; psn: string; packageCount: number; grossWeightLb: number };

const dataset = loadDataset();
const ids = dataset.entries.map((e) => ({ id: `${e.idPrefix}${e.idNumber}`, psn: e.psnPrinted }));

/** mulberry32 — deterministic, so a failure names the same paper every run. */
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function paper(seed: number): Line[] {
  const r = rng(seed);
  const n = 1 + Math.floor(r() * 8);
  return Array.from({ length: n }, (_, k) => {
    const e = ids[Math.floor(r() * ids.length)]!;
    return { tag: `p${seed}l${k}`, idText: e.id, psn: e.psn, packageCount: 1 + Math.floor(r() * 40), grossWeightLb: 50 + Math.floor(r() * 9000) };
  });
}

const OWNER: Line[] = [
  { tag: "o0", idText: "1760", psn: "Corrosive liquid N.O.S. (alkali metal salt)", packageCount: 30, grossWeightLb: 1731 },
  { tag: "o1", idText: "1760", psn: "Corrosive liquid N.O.S. (alkali metal salt)", packageCount: 31, grossWeightLb: 1815 },
  { tag: "o2", idText: "UN3264", psn: "CORROSIVE LIQUID, ACIDIC, INORGANIC, N.O.S. (PHOSPHORIC ACID, SULFURIC ACID)", packageCount: 38, grossWeightLb: 2052 },
  { tag: "o3", idText: "UN1993", psn: "FLAMMABLE LIQUID, N.O.S. (ISOPROPYL ALCOHOL)", packageCount: 27, grossWeightLb: 1555 },
  { tag: "o4", idText: "UN1760", psn: "CORROSIVE LIQUID, N.O.S. (PHOSPHORIC ACID, DODECYLBENZENE SULFONIC ACID)", packageCount: 32, grossWeightLb: 1800 },
  { tag: "o5", idText: "UN3266", psn: "CORROSIVE LIQUID, BASIC, INORGANIC, N.O.S. (SODIUM HYDROXIDE, POTASSIUM HYDROXIDE)", packageCount: 36, grossWeightLb: 2088 },
  { tag: "o6", idText: "UN3264", psn: "CORROSIVE LIQUID, ACIDIC, INORGANIC, N.O.S. (PHOSPHORIC ACID, SULFURIC ACID)", packageCount: 38, grossWeightLb: 2052 },
];

const PAPERS: Line[][] = [OWNER, ...Array.from({ length: 300 }, (_, s) => paper(s + 1))];

/** Two lines printed alike — the one a reader paired is indistinguishable from the other on the paper. */
const same = (x: Line, y: Line) => x.idText === y.idText && x.psn === y.psn && x.packageCount === y.packageCount && x.grossWeightLb === y.grossWeightLb;

/** Every one-character misread of one field of a line. */
function misreads(l: Line): Array<{ field: string; line: Line }> {
  const out: Array<{ field: string; line: Line }> = [];
  const digits = "0123456789";
  [...l.idText].forEach((c, i) => {
    if (!digits.includes(c)) return;
    for (const d of digits) if (d !== c) out.push({ field: "idText", line: { ...l, idText: l.idText.slice(0, i) + d + l.idText.slice(i + 1) } });
  });
  for (let i = 0; i + 1 < l.idText.length; i++) {
    const s = l.idText;
    if (digits.includes(s[i]!) && digits.includes(s[i + 1]!) && s[i] !== s[i + 1]) out.push({ field: "idText", line: { ...l, idText: s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2) } });
  }
  out.push({ field: "idText", line: { ...l, idText: "" } });
  out.push({ field: "packageCount", line: { ...l, packageCount: l.packageCount + 1 } });
  out.push({ field: "grossWeightLb", line: { ...l, grossWeightLb: l.grossWeightLb + 10 } });
  out.push({ field: "psn", line: { ...l, psn: l.psn.slice(0, -1) + (l.psn.endsWith("X") ? "Y" : "X") } });
  return out;
}

describe("alignLines over every one-character misread (RC3)", () => {
  it("keeps every misread line one line, paired with itself, and every other line with its own", () => {
    const split: string[] = [];
    let cases = 0;
    for (const a of PAPERS) {
      for (const [i, l] of a.entries()) {
        for (const m of misreads(l)) {
          cases++;
          const b = a.map((x, k) => (k === i ? m.line : x));
          const { aligned, extra } = alignLines(a, b);
          const wrong = aligned.flatMap((p, k) => (p && same(p, k === i ? m.line : a[k]!) ? [] : [k]));
          if (wrong.length || extra.length) split.push(`${l.tag} ${m.field} ${l.idText}→${m.line.idText}: unpaired/mispaired ${wrong.join(",")}, extra ${extra.length}`);
        }
      }
    }
    expect(cases).toBeGreaterThan(30_000);
    expect(split.slice(0, 20)).toEqual([]);
  });

  it("leaves a dropped line unpaired and every other line paired with its own", () => {
    const wrong: string[] = [];
    for (const a of PAPERS) {
      for (const [i] of a.entries()) {
        const b = a.filter((_, k) => k !== i);
        const { aligned, extra } = alignLines(a, b);
        // The unpaired line is the dropped one, or a line printed exactly like it (the paper's two UN3264 lines).
        const gone = aligned.flatMap((p, k) => (p === null ? [k] : []));
        const misPaired = aligned.some((p, k) => p !== null && !same(p, a[k]!));
        if (gone.length !== 1 || !same(a[gone[0]!]!, a[i]!) || extra.length || misPaired) wrong.push(`${a[i]!.tag}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("never pairs two different products that each reader read alone", () => {
    const paired: string[] = [];
    for (let s = 0; s < 2000; s++) {
      const [x, y] = paper(10_000 + s).concat(paper(20_000 + s));
      if (!x || !y || x.idText === y.idText) continue;
      const { aligned } = alignLines([x], [y]);
      if (aligned[0] !== null && x.psn !== y.psn && x.packageCount !== y.packageCount && x.grossWeightLb !== y.grossWeightLb) paired.push(`${x.idText}/${y.idText}`);
    }
    expect(paired).toEqual([]);
  });

  it("pairs the owner's UN3254 / UN3264 line as one line, the ids in dispute", () => {
    const b = OWNER.map((l) => (l.tag === "o2" ? { ...l, idText: "UN3254" } : l));
    const { aligned, extra } = alignLines(b, OWNER);
    expect(extra).toEqual([]);
    expect(aligned.every((l, k) => l !== null && same(l, OWNER[k]!))).toBe(true);
    expect(aligned[2]!.idText).toBe("UN3264");
  });
});

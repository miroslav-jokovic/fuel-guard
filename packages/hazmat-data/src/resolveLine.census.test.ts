import { describe, expect, it } from "vitest";
import { loadDataset } from "./index";
import { buildDatasetIndex, normalizePsnForMatch, resolveHmtLine } from "./resolveLine";
import type { HmtEntry, PackingGroup } from "./schema";

/**
 * The table census (READER-CORRECTNESS-PLAN RC1, D-RC1): every entry of the shipped dataset, printed every
 * way §172.101(c) lets a shipper print it, must resolve to THAT entry — never to another, and never be
 * refused unless the paper itself cannot say which row it is. The resolver's unit tests pin chosen cases;
 * this pins all of them, so a normalisation change that breaks one product anywhere in the table fails here,
 * not on a BOL a dispatcher happens to read (owner, 2026-10-19: "work every time, not this one case").
 *
 * Measured when written (2026-10-19, before the same-name narrowing): 2,479 entries, ≈21,700 printings,
 * 0 wrong picks, 33 printings of ten numbers refused although printed exactly (UN1950, UN1005, UN3318, …).
 */
const dataset = loadDataset();
const index = buildDatasetIndex(dataset);

const classText = (e: HmtEntry) => (e.subsidiaryClasses.length ? `${e.hazardClass} (${e.subsidiaryClasses.join(", ")})` : e.hazardClass);

/** A word printed in the singular: "liquids" → "liquid", leaving words whose -s is not a plural ("gas", "acids'" stem aside). */
const singular = (name: string) => name.split(" ").map((w) => w.replace(/^([A-Za-z]{3,}[^sui])s(,?)$/, "$1$2")).join(" ");

/** Every printing of one name a shipping paper may legally carry, with what it varies. */
function printings(e: HmtEntry, name: string): Array<{ kind: string; idText: string; psn: string }> {
  const id = `${e.idPrefix}${e.idNumber}`;
  const out = [
    { kind: "as printed", idText: id, psn: name },
    { kind: "upper case", idText: id, psn: name.toUpperCase() },
    { kind: "RQ in front", idText: id, psn: `RQ, ${name}` },
    { kind: "id spaced", idText: `${e.idPrefix} ${e.idNumber}`, psn: name },
    { kind: "NOS spelled out", idText: id, psn: name.replace(/n\.o\.s\.?/i, "NOS") },
  ];
  const sing = singular(name);
  if (sing !== name) out.push({ kind: "singular", idText: id, psn: sing.toUpperCase() });
  if (e.symbols.includes("G")) out.push({ kind: "technical name (G)", idText: id, psn: `${name} (XYLENE, TOLUENE)` });
  out.push({ kind: "bare number", idText: e.idNumber, psn: name });
  return out;
}

/** The bare number cannot say which key space it is in when the other one holds the same name. */
function otherSpaceHoldsName(e: HmtEntry, psn: string): boolean {
  const other = index.byId.get(`${e.idPrefix === "UN" ? "NA" : "UN"}${e.idNumber}`) ?? [];
  const n = normalizePsnForMatch(psn, false);
  return other.some((o) => [o.psnPrinted, ...o.psnAlternates].some((a) => normalizePsnForMatch(a, false) === n));
}

/**
 * The resolved row is one the paper describes: same id, a row that carries the printed name (its own or an
 * alternate — rows printing one name with one class and PG are what the paper cannot tell apart), the same
 * class and subsidiaries, and the printed PG.
 */
function isThisRow(e: HmtEntry, name: string, pg: PackingGroup | null, entryId: string, resolvedPg: PackingGroup | null): boolean {
  const got = dataset.entries.find((x) => x.entryId === entryId);
  if (!got) return false;
  const n = normalizePsnForMatch(name, false);
  return (
    got.idPrefix === e.idPrefix && got.idNumber === e.idNumber &&
    [got.psnPrinted, ...got.psnAlternates].some((a) => normalizePsnForMatch(a, false) === n) &&
    got.hazardClass === e.hazardClass &&
    got.subsidiaryClasses.slice().sort().join() === e.subsidiaryClasses.slice().sort().join() &&
    resolvedPg === pg
  );
}

describe("the table census — every entry, every legal printing (RC1)", () => {
  const wrong: string[] = [];
  const refused: string[] = [];
  let tried = 0;
  for (const e of dataset.entries) {
    for (const row of e.pgRows) {
      for (const name of [e.psnPrinted, ...e.psnAlternates]) {
        for (const p of printings(e, name)) {
          tried++;
          const r = resolveHmtLine(index, { idText: p.idText, psn: p.psn, hazardClass: classText(e), pg: row.pg });
          const what = `${p.kind}: ${p.idText} | ${p.psn} | ${classText(e)} ${row.pg ?? ""}`;
          if (r.ok) {
            if (!isThisRow(e, name, row.pg, r.entryId, r.pg)) wrong.push(`${what} → ${r.hmtRef}`);
          } else if (!(p.kind === "bare number" && r.reason === "id_prefix_ambiguous" && otherSpaceHoldsName(e, name))) {
            refused.push(`${what} → ${r.reason}`);
          }
        }
      }
    }
  }

  it("covers the whole table", () => {
    expect(dataset.entries.length).toBeGreaterThan(2000);
    expect(tried).toBeGreaterThan(20000);
  });

  it("never resolves a printing to another row of the table", () => {
    expect(wrong).toEqual([]);
  });

  it("never refuses a correct printing the paper can be resolved from", () => {
    expect(refused).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { settledReading, type FieldEvidence } from "@silvicom/shared";
import { hmtVerdict, witnessDataset } from "./hmtWitness.js";
import { settledDescription, settledId } from "./idWitness.js";
import type { OcrPage } from "./rowWitness.js";

/**
 * Q-RC7 over the whole table (READER-CORRECTNESS-PLAN): every HMT entry, printed correctly, against every one-digit
 * misread of its number that is also a table entry — the misread a reader makes (UN3264 → UN3254) and the one an
 * OCR can make the same way. For each pair, either reader may be the one that misread, and the page's OCR may print
 * the true number, the misread one, both, or the true number on a row that is not this line's. What must hold:
 *   - P1: the page never settles a number the paper does not print — in particular never the misread one when the
 *     OCR misread it too, which is also the case of a shipper who MISPRINTED it (the readers then split the same
 *     way, and only a person may say which was meant);
 *   - it settles the printed number whenever the table fits it and not the misread one, and the line's own row
 *     shows it — the 16 stops of the Sonny's BOL, everywhere in the table;
 *   - it says nothing when the row is another line's, when the misread number is printed too, or with no OCR.
 */

const { dataset } = witnessDataset();
const byId = new Map<string, typeof dataset.entries>();
for (const e of dataset.entries) {
  const id = `${e.idPrefix}${e.idNumber}`;
  byId.set(id, [...(byId.get(id) ?? []), e]);
}

/** Every one-digit neighbour of an id that is itself an entry. */
function neighbours(id: string): string[] {
  const [prefix, digits] = [id.slice(0, 2), id.slice(2)];
  const out: string[] = [];
  for (let k = 0; k < digits.length; k++) {
    for (const d of "0123456789") {
      if (d === digits[k]) continue;
      const n = `${prefix}${digits.slice(0, k)}${d}${digits.slice(k + 1)}`;
      if (byId.has(n)) out.push(n);
    }
  }
  return out;
}

const OTHER = "UN1203, GASOLINE, 3, II";
/** One page: this line's row printing `rowText`, another line's row below it, and anything `extra` printed elsewhere. */
function page(rowText: string | null, extra: string[] = []): OcrPage[] {
  const item = (text: string, y: number) => ({ text, box: { x: 40, y, width: 900, height: 20 } });
  const items = [item("BILL OF LADING", 10), item(OTHER, 300), ...extra.map((t, k) => item(t, 600 + 100 * k))];
  if (rowText) items.push(item(rowText, 150));
  return [{ page: 1, width: 1000, height: 1400, items }];
}

const ENTRIES = dataset.entries.filter((e) => e.hazardClass && !/combustible/i.test(e.hazardClass));
const PAIRS = ENTRIES.flatMap((e) => {
  const truth = `${e.idPrefix}${e.idNumber}`;
  const pg = e.pgRows[0]!.pg;
  const cls = e.subsidiaryClasses.length ? `${e.hazardClass} (${e.subsidiaryClasses.join(", ")})` : e.hazardClass!;
  return neighbours(truth).map((misread) => ({ e, truth, misread, psn: e.psnPrinted, cls, pg }));
});

type Pair = (typeof PAIRS)[number];
function settle(p: Pair, misreader: "passA" | "passB", rowText: string | null, extra: string[] = []) {
  const line = (idText: string) => ({ idText, psn: p.psn, hazardClass: p.cls, pg: p.pg });
  const [a, b] = misreader === "passA" ? [line(p.misread), line(p.truth)] : [line(p.truth), line(p.misread)];
  const verdict = { ...hmtVerdict(a), passB: hmtVerdict(b) };
  return { s: settledId(page(rowText, extra), a, b, verdict, ["UN1203"], 0), verdict };
}
const printed = (p: Pair, id: string) => `${id}, ${p.psn.toUpperCase()}, ${p.cls}${p.pg ? `, ${p.pg}` : ""}`;

describe("the page settling a split UN/NA number, over every table entry and its one-digit neighbours (Q-RC7)", () => {
  it("covers the table", () => {
    expect(ENTRIES.length).toBeGreaterThan(2_000);
    expect(PAIRS.length).toBeGreaterThan(10_000);
  });

  it("never settles a number the paper does not print — not when the OCR misread it too, nor on a misprint", () => {
    const wrong: string[] = [];
    let settled = 0;
    for (const p of PAIRS) for (const who of ["passA", "passB"] as const) {
      // The OCR read the true number: settled to it, or nothing.
      const t = settle(p, who, printed(p, p.truth)).s;
      if (t && t.value !== p.truth) wrong.push(`${p.truth}/${p.misread} ${who}: settled ${t.value} with the true number printed`);
      if (t) settled++;
      // The OCR misread it the same way (or the shipper printed it so): never settled to it.
      const m = settle(p, who, printed(p, p.misread)).s;
      if (m) wrong.push(`${p.truth}/${p.misread} ${who}: settled ${m.value} with the misread number printed`);
    }
    expect(wrong.slice(0, 10), `${wrong.length} of ${PAIRS.length * 4}`).toEqual([]);
    expect(settled).toBeGreaterThan(PAIRS.length);
  }, 120_000);

  it("settles the printed number whenever the table fits it and not the misread one, whichever reader misread", () => {
    const missed: string[] = [];
    let fits = 0;
    for (const p of PAIRS) for (const who of ["passA", "passB"] as const) {
      const { s, verdict } = settle(p, who, printed(p, p.truth));
      const truthFits = (who === "passA" ? verdict.passB : verdict)?.consistent === true;
      const misreadFits = (who === "passA" ? verdict : verdict.passB)?.consistent === true;
      if (!truthFits || misreadFits) continue;
      fits++;
      if (s?.value !== p.truth) missed.push(`${p.truth}/${p.misread} ${who}`);
    }
    expect(missed.slice(0, 10), `${missed.length} of ${fits}`).toEqual([]);
    expect(fits).toBeGreaterThan(10_000);
  }, 120_000);

  it("says nothing when both numbers are printed, when the row is another line's, or with no OCR", () => {
    const wrong: string[] = [];
    for (const p of PAIRS) for (const who of ["passA", "passB"] as const) {
      if (settle(p, who, printed(p, p.truth), [printed(p, p.misread)]).s) wrong.push(`${p.truth}/${p.misread} ${who}: both printed`);
      if (settle(p, who, `${p.truth}, ZZZ QQQ, 9`).s) wrong.push(`${p.truth}/${p.misread} ${who}: row without the name`);
      if (settle(p, who, null).s) wrong.push(`${p.truth}/${p.misread} ${who}: nothing printed`);
    }
    const p = PAIRS[0]!;
    const line = { idText: p.truth, psn: p.psn, hazardClass: p.cls, pg: p.pg };
    expect(settledId(null, { ...line, idText: p.misread }, line, { ...hmtVerdict({ ...line, idText: p.misread }), passB: hmtVerdict(line) }, [], 0)).toBeNull();
    expect(wrong.slice(0, 10), `${wrong.length}`).toEqual([]);
  }, 120_000);

  it("says nothing when the readers split on the name, class or PG too", () => {
    const p = PAIRS.find((x) => x.truth === "UN3264" && x.misread === "UN3254")!;
    const a = { idText: "UN3254", psn: p.psn, hazardClass: p.cls, pg: p.pg };
    const b = { idText: "UN3264", psn: p.psn, hazardClass: p.cls, pg: p.pg };
    const verdict = { ...hmtVerdict(a), passB: hmtVerdict(b) };
    const rows = page(printed(p, "UN3264"));
    expect(settledId(rows, a, b, verdict, ["UN1203"], 0)?.value).toBe("UN3264");
    expect(settledId(rows, { ...a, hazardClass: "4.2" }, b, verdict, ["UN1203"], 0)).toBeNull();
    expect(settledId(rows, { ...a, pg: "III" }, b, verdict, ["UN1203"], 0)).toBeNull();
    expect(settledId(rows, { ...a, psn: "CORROSIVE LIQUID, BASIC, INORGANIC, N.O.S." }, b, verdict, ["UN1203"], 0)).toBeNull();
  });

  it("binds a number two lines carry to the row that prints this line's name", () => {
    const p = PAIRS.find((x) => x.truth === "UN3264" && x.misread === "UN3254")!;
    const a = { idText: "UN3254", psn: p.psn, hazardClass: p.cls, pg: p.pg };
    const b = { idText: "UN3264", psn: p.psn, hazardClass: p.cls, pg: p.pg };
    const verdict = { ...hmtVerdict(a), passB: hmtVerdict(b) };
    // Another line, read first, carries UN3264 too: this line's row is the second UN3264 printed.
    const pages = page(printed(p, "UN3264"), ["UN3264, CORROSIVE LIQUID, ACIDIC, INORGANIC, N.O.S. (NITRIC ACID), 8, II"]);
    expect(settledId(pages, a, b, verdict, ["UN3264", "UN1203"], 1)?.row.items.some((i) => i.text.includes("NITRIC"))).toBe(true);
    // As many UN3264 rows as lines carrying it is required: one too few, and nothing is settled.
    expect(settledId(page(printed(p, "UN3264")), a, b, verdict, ["UN3264", "UN1203"], 1)).toBeNull();
  });

  it("settles the description with the number only when the two differ in nothing else", () => {
    const s = { value: "UN3264", reader: "passB" as const, row: { page: 1, bbox: { x: 0, y: 0, w: 1, h: 1 }, items: [] } };
    const a = "UN3254, CORROSIVE LIQUID, ACIDIC, INORGANIC, N.O.S. (PHOSPHORIC ACID, SULFURIC ACID), 8, II";
    const b = "UN3264, CORROSIVE LIQUID, ACIDIC, INORGANIC, N.O.S. (PHOSPHORIC ACID, SULFURIC ACID), 8, II";
    expect(settledDescription(s, a, b, "UN3254", "UN3264")).toBe(b);
    expect(settledDescription(s, a.replace("PHOSPHORIC", "NITRIC"), b, "UN3254", "UN3264")).toBeNull();
    expect(settledDescription(s, a.replace("UN3254", "UN 3254"), b, "UN3254", "UN3264")).toBe(b);
    expect(settledDescription({ ...s, reader: "passA", value: "UN3254" }, a, b, "UN3254", "UN3264")).toBe(a);
  });

  it("is read off the evidence only on a split number or description, and only as a reading a reader read", () => {
    const ev = (path: string, a: unknown, b: unknown, ocr: unknown): Pick<FieldEvidence, "path" | "sources"> => ({
      path,
      sources: [
        { reader: "passA", page: null, bbox: null, value: a as never },
        { reader: "passB", page: null, bbox: null, value: b as never },
        { reader: "ocr", page: 1, bbox: null, value: ocr as never },
      ],
    });
    expect(settledReading(ev("hazmat.lines[2].idText", "UN3254", "UN3264", "UN3264"))).toBe("UN3264");
    expect(settledReading(ev("hazmat.lines[2].descriptionText", "UN3254, X", "UN3264, X", "UN3264, X"))).toBe("UN3264, X");
    // A value no reader read is never a settlement.
    expect(settledReading(ev("hazmat.lines[2].idText", "UN3254", "UN3264", "UN3274"))).toBeUndefined();
    // A count the row backs keeps the person's click (owner, 2026-10-15): a row witness there settles nothing.
    expect(settledReading(ev("hazmat.lines[2].packageCount", 6, 9, 6))).toBeUndefined();
    // Readers that agree have nothing to settle.
    expect(settledReading(ev("hazmat.lines[2].idText", "UN3264", "UN3264", "UN3264"))).toBeUndefined();
  });
});

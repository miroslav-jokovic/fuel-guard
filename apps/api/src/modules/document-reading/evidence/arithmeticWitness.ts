import { valuesAgree, type ShippingDocument } from "@silvicom/shared";

/**
 * The paper's own totals as a witness on its rows' weights and counts (DOCUMENT-READER-PLAN Q-DR26, L3; the
 * `arithmetic` reader the evidence contract has reserved since §4.4). Pure: it reads the two readers'
 * documents, already matched row to row, and says which reading of each number the paper's totals back.
 *
 * WHY. A BOL prints most of its numbers twice: every row's weight, and their total. Measured 2026-10-15 on
 * the ten office BOLs under profile 1.3.0 (both readers, every row with its count and weight): the rows'
 * weights add up to a printed total on 9 of 10 papers for both readers — the gross, the NET (0136043) or
 * the WEIGHT beside TOTAL PKGS (0134831). The tenth, 0135071, is the honest limit: its rows and pallets add
 * to 41,676 lb and the shipper printed 41,677, so its own total is a pound off from rounding — and the one
 * true misread on the set (3,808 for 3,806 lb) gives 41,678, inside that same rounding. So:
 *
 *   - ROUNDING IS ALLOWED, never assumed away. Every printed number is rounded to its printed places; a
 *     total may be within half a unit per term of its rows (`bound`). A reading is only ever PICKED when
 *     exactly one combination of the readers' readings closes within that bound — on 0135071 both close,
 *     so the arithmetic picks nothing and the row witness (rowWitness.ts) is what backs 3,806. Picking by
 *     an exact match instead would have backed a misread 3,807 there, the one that happens to land on 41,677.
 *   - THE DIRECTION OF EACH TOTAL. A printed NET must equal the rows, either way. A GROSS, and a gross less
 *     the printed tare, is only an upper bound: some forms add pallet or dunnage weight they do not print
 *     (0134831 has a DUNNAGE WEIGHT box, empty there), so rows weighing LESS than the gross prove nothing,
 *     while rows weighing MORE than it cannot be right.
 *   - ONLY AGREED TOTALS PICK. A total the readers read differently backs no reading (0135071's tare: 1,050
 *     by one reader, nothing by the other). And it cannot make a flag either: rows are said not to fit only
 *     when they fit neither reader's totals, so a dispute widens what is acceptable and never adds a doubt.
 *   - COUNTS ONLY CONFIRM. "Pieces" is packages on one form (0135071: 832 = its rows) and handling units on
 *     another (0134831: 99 = 79 packages + 20 pallets), so a count that adds to nothing proves nothing.
 *
 * What it returns, per path judged: the value the closing combination gives that row — the reading the paper
 * backs — or null when the weights cannot be any reading's (no combination fits a total both readers read),
 * which asks a person to look. A path it cannot judge (two readings both closing; a total in dispute) is
 * absent. A row one reader read and the other did not is offered as present or absent; when the sum decides
 * it is absent, its value is null. Weights in a unit other than pounds, a loaded row with no weight, or more
 * than MAX_DISPUTED rows in dispute: no judgement at all.
 */

/** A row as either reader read it; null where the second reader has no partner row at that position. */
type Counted = { packageCount: number | null; grossWeightLb: number | null } | null;
type Doc = { hazmat: { lines: readonly Counted[] }; otherLines: readonly Counted[]; freight: ShippingDocument["freight"] };
interface Row { countPath: string; weightPath: string; counts: (number | null)[]; weights: (number | null)[] }

/** 2^10 combinations: far above any paper measured (one disputed weight in ten), small enough to enumerate. */
const MAX_DISPUTED = 10;

/**
 * The decimal places a number carries. A reader returns a NUMBER, so "760.00" arrives as 760 and its printed
 * places are gone; a form prints its weights in one format, so the paper's places are the most any of its
 * numbers shows (0134831: 30,452.6 → one place, so its "760.00" is not given half a pound of slack).
 */
const places = (v: number): number => (String(v).split(".")[1] ?? "").length;

/**
 * `a` and `b` are the readers' documents with b's rows at a's positions and its unpaired rows after
 * (shippingEvidence.ts builds exactly that); `b` is null when there was no second reader.
 */
export function arithmeticWitness(a: Doc, b: Doc | null): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const rows = rowsOf(a, b);
  judgeWeights(rows, a, b, out);
  judgeCounts(rows, a, b, out);
  return out;
}

function rowsOf(a: Doc, b: Doc | null): Row[] {
  const rows: Row[] = [];
  const add = (prefix: string, n: number, at: (d: Doc | null, i: number) => Counted | undefined) => {
    for (let i = 0; i < n; i++) {
      const ra = at(a, i);
      const rb = b ? at(b, i) : undefined;
      // A row a reader did not see is "absent" — a candidate of 0 — so the totals can say whether it exists.
      const pick = (key: "packageCount" | "grossWeightLb") =>
        b === null ? [ra?.[key] ?? null] : [ra ? ra[key] ?? null : 0, rb ? rb[key] ?? null : 0];
      rows.push({ countPath: `${prefix}[${i}].packageCount`, weightPath: `${prefix}[${i}].grossWeightLb`, counts: pick("packageCount"), weights: pick("grossWeightLb") });
    }
  };
  const lines = Math.max(a.hazmat.lines.length, b?.hazmat.lines.length ?? 0);
  add("hazmat.lines", lines, (d, i) => d?.hazmat.lines[i]);
  const other = Math.max(a.otherLines.length, b?.otherLines.length ?? 0);
  add("otherLines", other, (d, i) => d?.otherLines[i]);
  return rows;
}

/** A total both readers read the same (or the one reader's, when there was one), else undefined = disputed. */
function agreed(a: Doc, b: Doc | null, key: "weight" | "netWeight" | "tareWeight" | "pieces" | "pallets"): number | null | undefined {
  const va = a.freight[key];
  if (b === null) return va;
  return valuesAgree(va, b.freight[key]) ? va : undefined;
}

/** Every combination of the rows' distinct readings, as the value each row takes; null past MAX_DISPUTED. */
function combinations(options: number[][]): number[][] | null {
  if (options.filter((o) => o.length > 1).length > MAX_DISPUTED) return null;
  return options.reduce<number[][]>((acc, opts) => acc.flatMap((c) => opts.map((v) => [...c, v])), [[]]);
}

const distinct = (vs: number[]): number[] => vs.filter((v, i) => vs.findIndex((w) => valuesAgree(w, v)) === i);

/** The paths each closing combination agrees on: a row's value when every closing combination gives it. */
function record(paths: string[], closing: number[][], out: Map<string, number | null>) {
  paths.forEach((path, i) => {
    const vals = distinct(closing.map((c) => c[i]!));
    if (vals.length === 1) out.set(path, vals[0] === 0 ? null : vals[0]!);
  });
}

function judgeWeights(rows: Row[], a: Doc, b: Doc | null, out: Map<string, number | null>) {
  const units = b ? [a.freight.weightUnit, b.freight.weightUnit] : [a.freight.weightUnit];
  if (units.includes("kg")) return; // the rows are pounds (grossWeightLb); a kilogram total is another quantity
  // A loaded row whose weight a reader left blank cannot be added; a dormant template row (nothing read) is 0.
  const loaded = rows.filter((r) => [...r.counts, ...r.weights].some((v) => v != null && v !== 0));
  if (loaded.some((r) => r.weights.some((w) => w === null))) return;
  const options = loaded.map((r) => distinct(r.weights as number[]));
  const combos = combinations(options);
  if (!combos || loaded.length === 0) return;

  const sumOf = (c: number[]) => c.reduce((s, v) => s + v, 0);
  // A target is a total and the printed numbers it is made of; its rounding is theirs and the rows'.
  type Target = { total: number; printed: number[] };
  type Totals = { gross: number | null | undefined; net: number | null | undefined; tare: number | null | undefined };
  const boundOf = (c: number[], t: Target) => {
    const terms = [...c.filter((v) => v !== 0), ...t.printed];
    return terms.length * 0.5 * 10 ** -Math.max(...terms.map(places));
  };
  const targetsOf = ({ gross, net, tare }: Totals) => ({
    twoSided: net != null ? [{ total: net, printed: [net] }] : ([] as Target[]),
    oneSided: [
      ...(gross != null ? [{ total: gross, printed: [gross] }] : []),
      ...(gross != null && tare != null ? [{ total: gross - tare, printed: [gross, tare] }] : []),
    ] as Target[],
  });
  // 1e-9 absorbs binary floating point (30,452.6 + 5,994.1), never a printed difference.
  const near = (c: number[], t: Target) => Math.abs(sumOf(c) - t.total) <= boundOf(c, t) + 1e-9;
  const under = (c: number[], t: Target) => sumOf(c) <= t.total + boundOf(c, t) + 1e-9;

  // Picking rests on the totals both readers read alike.
  const sure = targetsOf({ gross: agreed(a, b, "weight"), net: agreed(a, b, "netWeight"), tare: agreed(a, b, "tareWeight") });
  const closing = combos.filter((c) => [...sure.twoSided, ...sure.oneSided].some((t) => near(c, t)));
  if (closing.length > 0) return record(loaded.map((r) => r.weightPath), closing, out);

  // Nothing closes on them. A flag must survive EITHER reader's totals: a total in dispute widens what the
  // rows may add up to, never narrows it. Under a set of totals the rows are consistent when a combination
  // closes on one, or — with no net printed — stays under a gross, which may hide pallets it does not print.
  // A reader that read no total at all leaves nothing to contradict.
  const sets = (b ? [a, b] : [a]).map((d) => targetsOf({ gross: d.freight.weight, net: d.freight.netWeight, tare: d.freight.tareWeight }));
  const contradicted = sets.every(({ twoSided, oneSided }) =>
    (twoSided.length > 0 || oneSided.length > 0) &&
    !combos.some((c) => [...twoSided, ...oneSided].some((t) => near(c, t)) || (twoSided.length === 0 && oneSided.some((t) => under(c, t)))));
  if (contradicted) for (const r of loaded) out.set(r.weightPath, null);
}

function judgeCounts(rows: Row[], a: Doc, b: Doc | null, out: Map<string, number | null>) {
  const loaded = rows.filter((r) => [...r.counts, ...r.weights].some((v) => v != null && v !== 0));
  if (loaded.length === 0 || loaded.some((r) => r.counts.some((n) => n === null))) return;
  const combos = combinations(loaded.map((r) => distinct(r.counts as number[])));
  const pieces = agreed(a, b, "pieces");
  const pallets = agreed(a, b, "pallets");
  if (!combos || pieces == null) return;
  const targets = [pieces, ...(pallets != null && pallets > 0 ? [pieces - pallets] : [])];
  const closing = combos.filter((c) => targets.includes(c.reduce((s, v) => s + v, 0)));
  if (closing.length > 0) record(loaded.map((r) => r.countPath), closing, out);
}

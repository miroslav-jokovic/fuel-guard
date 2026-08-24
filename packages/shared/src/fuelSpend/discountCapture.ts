/**
 * Which fills did not get the discount they should have (WP5, plan §4.2).
 *
 * ── THE BENCHMARK IS THE SAME WEEK'S OWN MEDIAN ──────────────────────────────────────────────────
 * Not a contract rate, and not a fleet-wide constant. The Pilot deal moves with the market — the
 * captured discount ran $0.81/gal when diesel bottomed in June 2026 and $0.53 when it peaked in August
 * — so a fixed benchmark manufactures thousands of dollars of phantom "loss" in a falling market and
 * hides real loss in a rising one. Comparing each line against the median of the fills around it asks
 * the only question that survives a moving market: *on this day, at this price level, did this fill get
 * what our other fills got?*
 *
 * The median (not the mean) because the distribution has a hard floor of zero — every ONE9 line — and
 * a handful of zeroes drags a mean down until the outliers look normal.
 *
 * Measured over the five real 2026-07-20 → 2026-08-23 statements: $24,761 below each week's own median,
 * ~$5,000/week, consistent every week.
 */
import { isTractorFuel, totalsOf, weekOf, type SpendLine } from "./types.js";

/** A fill, with what it captured and what the benchmark says it should have. */
export interface CaptureLine {
  line: SpendLine;
  discountPerGal: number;
  benchmarkPerGal: number;
  /** Dollars below the benchmark. Zero for a fill at or above it — never negative, so sums read as loss. */
  shortfall: number;
}

export interface CaptureBand {
  key: "none" | "under10" | "under30" | "under60" | "at_or_above";
  label: string;
  lines: number;
  gallons: number;
  spend: number;
  shortfall: number;
}

export interface CaptureRollup {
  key: string;
  lines: number;
  gallons: number;
  spend: number;
  discountPerGal: number;
  shortfall: number;
}

export interface DiscountCapture {
  benchmarkPerGal: number | null;
  /** Only fills BELOW the benchmark contribute; the sum is what a perfect week would have saved. */
  totalShortfall: number;
  lines: CaptureLine[];
  bands: CaptureBand[];
  byBrand: CaptureRollup[];
  bySite: CaptureRollup[];
  byState: CaptureRollup[];
  /** Fills that captured nothing at all. Every one on the real statements was an off-brand site. */
  zeroDiscount: CaptureLine[];
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const BANDS: Array<{ key: CaptureBand["key"]; label: string; max: number }> = [
  { key: "none", label: "No discount", max: 0.005 },
  { key: "under10", label: "Under 10¢/gal", max: 0.1 },
  { key: "under30", label: "10–30¢/gal", max: 0.3 },
  { key: "under60", label: "30–60¢/gal", max: 0.6 },
];

function rollup(lines: readonly CaptureLine[], key: (l: SpendLine) => string | null): CaptureRollup[] {
  const m = new Map<string, CaptureLine[]>();
  for (const c of lines) {
    const k = key(c.line);
    if (k == null) continue;
    const b = m.get(k);
    if (b) b.push(c);
    else m.set(k, [c]);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return [...m.entries()]
    .map(([k, cs]) => {
      const t = totalsOf(cs.map((c) => c.line));
      return {
        key: k,
        lines: cs.length,
        gallons: t.gallons,
        spend: t.net,
        discountPerGal: t.discountPerGal ?? 0,
        shortfall: r2(cs.reduce((a, c) => a + c.shortfall, 0)),
      };
    })
    .sort((a, b) => b.shortfall - a.shortfall);
}

/**
 * Score every tractor fill against a benchmark.
 *
 * `benchmarkPerGal` overrides the median — pass the contract rate once it is known, and the same
 * report becomes "below what we are entitled to" instead of "below what we usually get".
 */
export function analyzeDiscountCapture(
  lines: readonly SpendLine[],
  benchmarkPerGal?: number,
): DiscountCapture {
  const fills = lines.filter((l) => isTractorFuel(l) && l.retailAmount != null);
  const rates = fills.map((l) => (l.retailAmount! - l.netAmount!) / l.gallons);
  const benchmark = benchmarkPerGal ?? median(rates);
  if (benchmark == null) {
    return { benchmarkPerGal: null, totalShortfall: 0, lines: [], bands: [], byBrand: [], bySite: [], byState: [], zeroDiscount: [] };
  }

  const scored: CaptureLine[] = fills.map((l) => {
    const discountPerGal = (l.retailAmount! - l.netAmount!) / l.gallons;
    return {
      line: l,
      discountPerGal,
      benchmarkPerGal: benchmark,
      shortfall: Math.max(0, (benchmark - discountPerGal) * l.gallons),
    };
  });

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const bands: CaptureBand[] = [];
  let floor = -Infinity;
  for (const b of BANDS) {
    const inBand = scored.filter((c) => c.discountPerGal > floor && c.discountPerGal <= b.max);
    const t = totalsOf(inBand.map((c) => c.line));
    bands.push({ key: b.key, label: b.label, lines: inBand.length, gallons: t.gallons, spend: t.net, shortfall: r2(inBand.reduce((a, c) => a + c.shortfall, 0)) });
    floor = b.max;
  }
  const rest = scored.filter((c) => c.discountPerGal > floor);
  const restT = totalsOf(rest.map((c) => c.line));
  bands.push({ key: "at_or_above", label: "60¢/gal or more", lines: rest.length, gallons: restT.gallons, spend: restT.net, shortfall: r2(rest.reduce((a, c) => a + c.shortfall, 0)) });

  return {
    benchmarkPerGal: benchmark,
    totalShortfall: r2(scored.reduce((a, c) => a + c.shortfall, 0)),
    lines: [...scored].sort((a, b) => b.shortfall - a.shortfall),
    bands,
    byBrand: rollup(scored, (l) => l.brand ?? "(independent)"),
    bySite: rollup(scored, (l) => (l.site ? `${l.site} ${l.city ?? ""} ${l.state ?? ""}`.trim() : null)),
    byState: rollup(scored, (l) => l.state),
    zeroDiscount: scored.filter((c) => c.discountPerGal < 0.005),
  };
}

/** Per-week capture, each week benchmarked against ITSELF — the series behind §4.2's table. */
export function weeklyDiscountCapture(lines: readonly SpendLine[]): Array<{ week: string; benchmarkPerGal: number | null; shortfall: number; zeroDiscountLines: number }> {
  const byWeek = new Map<string, SpendLine[]>();
  for (const l of lines) {
    if (!l.tranDate) continue;
    const k = weekOf(l.tranDate);
    const b = byWeek.get(k);
    if (b) b.push(l);
    else byWeek.set(k, [l]);
  }
  return [...byWeek.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([week, ls]) => {
      const c = analyzeDiscountCapture(ls);
      return { week, benchmarkPerGal: c.benchmarkPerGal, shortfall: c.totalShortfall, zeroDiscountLines: c.zeroDiscount.length };
    });
}

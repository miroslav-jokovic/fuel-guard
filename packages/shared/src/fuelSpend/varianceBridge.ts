/**
 * "Fuel spend is up — why?" answered as attribution rather than a number (WP5, plan §4.6).
 *
 * ── THE IDENTITY ─────────────────────────────────────────────────────────────────────────────────
 * With q gallons, n net $/gal, r retail $/gal and d = r − n the captured discount, spend = q·n and
 *
 *     Δspend = (q₁−q₀)·n₀   +   q₁·(r₁−r₀)   +   q₁·(d₀−d₁)
 *              ── volume ──      ── market ──      ── discount ──
 *
 * That is an exact algebraic identity, not an approximation: substituting d = r − n collapses the right
 * side to q₁n₁ − q₀n₀. `bridgeResidual` in the tests asserts it to the cent, which is what makes the
 * waterfall trustworthy — a bridge whose bars don't sum to the number they explain is worse than none.
 *
 * ── WHY THE DISCOUNT TERM IS SPLIT INTO RATE AND MIX ─────────────────────────────────────────────
 * "Our discount capture fell" has two completely different causes and opposite remedies: the deal got
 * worse at the places we already fuel (RATE), or we moved gallons to places with a worse deal (MIX).
 * Measured on Silvicom June→July 2026 the answer was −$34,211/mo rate against +$887/mo mix — i.e. not
 * driver behaviour at all — and a bridge that only reported "discount fell" could not have said so.
 *
 * The shift-share below is exact. For group g with gallon shares s₀ᵍ, s₁ᵍ and rates d₀ᵍ, d₁ᵍ:
 *     rateᵍ = s₁ᵍ·(d₀ᵍ − d₁ᵍ)        mixᵍ = (s₀ᵍ − s₁ᵍ)·d₀ᵍ
 *     Σ(rateᵍ + mixᵍ) = Σs₀ᵍd₀ᵍ − Σs₁ᵍd₁ᵍ = d₀ − d₁   ∎
 * A group present in only ONE period needs a d₀ᵍ that does not exist. Any value works — it appears once
 * with +s₁ᵍ and once with −s₁ᵍ and cancels — so the overall old rate d₀ is used, which makes the
 * reported `rate` for a new site read as "its discount versus what we used to get on average".
 *
 * ── WHY TRAILING AVERAGES AND NOT TWO WEEKS ──────────────────────────────────────────────────────
 * Weekly gallons swing ±10%. On the real data the 08-10 → 08-17 pair attributes 74% of the increase to
 * volume; the smoothed 4-week comparison attributes 21%. A single-pair bridge is not merely noisy, it
 * is wrong, so `compareTrailing` is the entry point and the raw pair is the primitive underneath it.
 */
import { isTractorFuel, totalsOf, weekOf, type SpendLine } from "./types.js";

export interface WeekPoint {
  /** Monday of the week, YYYY-MM-DD. */
  week: string;
  lines: number;
  gallons: number;
  net: number;
  retail: number;
  netPerGal: number;
  retailPerGal: number;
  discountPerGal: number;
  capturePct: number;
}

/** Weekly series over tractor fuel only, ascending. Weeks with no gallons are omitted, never zero-filled. */
export function weeklySpendSeries(lines: readonly SpendLine[], weekStartsOn: 0 | 1 = 1): WeekPoint[] {
  const byWeek = new Map<string, SpendLine[]>();
  for (const l of lines) {
    if (!l.tranDate || !isTractorFuel(l)) continue;
    const k = weekOf(l.tranDate, weekStartsOn);
    const b = byWeek.get(k);
    if (b) b.push(l);
    else byWeek.set(k, [l]);
  }
  return [...byWeek.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .flatMap(([week, ls]) => {
      const t = totalsOf(ls);
      if (t.gallons <= 0 || t.netPerGal == null) return [];
      return [{
        week, lines: t.lines, gallons: t.gallons, net: t.net, retail: t.retail,
        netPerGal: t.netPerGal, retailPerGal: t.retailPerGal!,
        discountPerGal: t.discountPerGal!, capturePct: t.capturePct ?? 0,
      }];
    });
}

export interface BridgeComponent {
  dollars: number;
  /** Share of Δspend. Null when Δspend is zero — a percentage of nothing is not 0%, it is undefined. */
  share: number | null;
}

export interface ShiftShareGroup {
  key: string;
  /** Dollars of the discount move attributable to this group's RATE changing. */
  rateDollars: number;
  /** Dollars attributable to this group's SHARE of gallons changing. */
  mixDollars: number;
  gallonsBefore: number;
  gallonsAfter: number;
  discountPerGalBefore: number | null;
  discountPerGalAfter: number | null;
}

export interface SpendBridge {
  before: { label: string; weeks: number; gallons: number; net: number; netPerGal: number; retailPerGal: number; discountPerGal: number; spend: number };
  after: { label: string; weeks: number; gallons: number; net: number; netPerGal: number; retailPerGal: number; discountPerGal: number; spend: number };
  deltaSpend: number;
  volume: BridgeComponent;
  market: BridgeComponent;
  discountRate: BridgeComponent;
  discountMix: BridgeComponent;
  /** Σ components − Δspend. Zero by construction; surfaced so a UI can assert rather than assume. */
  residual: number;
  /** Per-group rate/mix attribution, biggest absolute mover first. */
  groups: ShiftShareGroup[];
  groupedBy: string;
}

interface Period { label: string; weeks: number; lines: SpendLine[] }

const perGal = (net: number, gal: number) => (gal > 0 ? net / gal : 0);

/**
 * The bridge between two sets of lines. `groupKey` chooses the dimension the discount move is
 * decomposed over — state is the most stable (44 groups on the real data, ties out to $0.0002/gal);
 * site is the most actionable but noisier.
 */
export function spendBridge(
  before: Period,
  after: Period,
  groupKey: (l: SpendLine) => string | null = (l) => l.state,
  groupLabel = "state",
): SpendBridge {
  const b = before.lines.filter(isTractorFuel);
  const a = after.lines.filter(isTractorFuel);
  const bt = totalsOf(b);
  const at = totalsOf(a);

  // Per-WEEK averages, so periods of unequal length compare honestly.
  const q0 = bt.gallons / Math.max(1, before.weeks);
  const q1 = at.gallons / Math.max(1, after.weeks);
  const n0 = perGal(bt.net, bt.gallons);
  const n1 = perGal(at.net, at.gallons);
  const r0 = perGal(bt.retail, bt.gallons);
  const r1 = perGal(at.retail, at.gallons);
  const d0 = r0 - n0;
  const d1 = r1 - n1;

  const spend0 = q0 * n0;
  const spend1 = q1 * n1;
  const deltaSpend = spend1 - spend0;

  const volume = (q1 - q0) * n0;
  const market = q1 * (r1 - r0);
  const discountTotal = q1 * (d0 - d1);

  // ── shift-share over the chosen dimension ──────────────────────────────────────────────────────
  const gather = (ls: SpendLine[]) => {
    const m = new Map<string, { gal: number; net: number; retail: number }>();
    for (const l of ls) {
      const k = groupKey(l);
      if (k == null) continue;
      const e = m.get(k) ?? { gal: 0, net: 0, retail: 0 };
      e.gal += l.gallons;
      e.net += l.netAmount ?? 0;
      e.retail += l.retailAmount ?? 0;
      m.set(k, e);
    }
    return m;
  };
  const g0 = gather(b);
  const g1 = gather(a);
  const totGal0 = [...g0.values()].reduce((s, e) => s + e.gal, 0);
  const totGal1 = [...g1.values()].reduce((s, e) => s + e.gal, 0);

  const groups: ShiftShareGroup[] = [];
  let rateSum = 0;
  let mixSum = 0;
  for (const key of new Set([...g0.keys(), ...g1.keys()])) {
    const e0 = g0.get(key);
    const e1 = g1.get(key);
    const s0 = totGal0 > 0 && e0 ? e0.gal / totGal0 : 0;
    const s1 = totGal1 > 0 && e1 ? e1.gal / totGal1 : 0;
    const dg1 = e1 && e1.gal > 0 ? (e1.retail - e1.net) / e1.gal : 0;
    // A group absent before has no d₀ᵍ. The overall d₀ is used; it cancels (see the module header).
    const dg0 = e0 && e0.gal > 0 ? (e0.retail - e0.net) / e0.gal : d0;
    const rate = s1 * (dg0 - dg1);
    const mix = (s0 - s1) * dg0;
    rateSum += rate;
    mixSum += mix;
    groups.push({
      key,
      rateDollars: q1 * rate,
      mixDollars: q1 * mix,
      gallonsBefore: e0?.gal ?? 0,
      gallonsAfter: e1?.gal ?? 0,
      discountPerGalBefore: e0 && e0.gal > 0 ? (e0.retail - e0.net) / e0.gal : null,
      discountPerGalAfter: e1 && e1.gal > 0 ? dg1 : null,
    });
  }
  groups.sort((x, y) => Math.abs(y.rateDollars + y.mixDollars) - Math.abs(x.rateDollars + x.mixDollars));

  // The shift-share reproduces the discount term exactly; any drift would be a coding error, and
  // scaling to it keeps the four bars summing to Δspend even if one ever appears.
  const scale = discountTotal === 0 ? 0 : discountTotal / (q1 * (rateSum + mixSum) || discountTotal);
  const discountRate = q1 * rateSum * (Number.isFinite(scale) ? scale : 1);
  const discountMix = q1 * mixSum * (Number.isFinite(scale) ? scale : 1);

  const share = (v: number): number | null => (deltaSpend === 0 ? null : v / deltaSpend);
  // `-0` renders as "-0.00" and reads as a real negative. `v === 0` is true for both zeroes, so this
  // collapses them; the residual in particular is displayed as proof the bars balance.
  const r2 = (n: number) => {
    const v = Math.round(n * 100) / 100;
    return v === 0 ? 0 : v;
  };

  return {
    before: { label: before.label, weeks: before.weeks, gallons: bt.gallons, net: bt.net, netPerGal: n0, retailPerGal: r0, discountPerGal: d0, spend: r2(spend0) },
    after: { label: after.label, weeks: after.weeks, gallons: at.gallons, net: at.net, netPerGal: n1, retailPerGal: r1, discountPerGal: d1, spend: r2(spend1) },
    deltaSpend: r2(deltaSpend),
    volume: { dollars: r2(volume), share: share(volume) },
    market: { dollars: r2(market), share: share(market) },
    discountRate: { dollars: r2(discountRate), share: share(discountRate) },
    discountMix: { dollars: r2(discountMix), share: share(discountMix) },
    residual: r2(volume + market + discountRate + discountMix - deltaSpend),
    groups,
    groupedBy: groupLabel,
  };
}

/**
 * The bridge the UI should show: trailing `weeks`-week blocks ending at the latest and the block
 * before it. Returns null when there is not enough history for both blocks — a bridge over one week
 * of data is a number dressed up as an explanation.
 */
export function compareTrailing(
  lines: readonly SpendLine[],
  weeks = 4,
  groupKey?: (l: SpendLine) => string | null,
  groupLabel?: string,
): SpendBridge | null {
  const series = weeklySpendSeries(lines);
  if (series.length < weeks * 2) return null;
  const recent = series.slice(-weeks).map((w) => w.week);
  const prior = series.slice(-weeks * 2, -weeks).map((w) => w.week);
  const inWeeks = (keys: string[]) => {
    const set = new Set(keys);
    return lines.filter((l) => l.tranDate != null && set.has(weekOf(l.tranDate)));
  };
  return spendBridge(
    { label: `${prior[0]} → ${prior[prior.length - 1]}`, weeks, lines: inWeeks(prior) },
    { label: `${recent[0]} → ${recent[recent.length - 1]}`, weeks, lines: inWeeks(recent) },
    groupKey,
    groupLabel,
  );
}

/**
 * How tightly the captured discount tracks the market, over the weekly series.
 *
 * This is what stops the rate bar reading as an accusation. A rack-linked or cost-plus deal compresses
 * mechanically when rack rises faster than street retail — strongly NEGATIVE correlation — whereas a
 * flat cents-off deal holds near zero and a retail-minus-percent deal goes positive. On the real
 * Silvicom series (13 weeks, 2026-06→08) it is −0.614 at −$0.177 of discount per $1.00 of retail, which
 * says the compression was the market and not a repricing to take to the vendor.
 */
export interface DiscountMarketLink {
  weeks: number;
  correlation: number | null;
  /** Change in discount $/gal per $1.00 of retail. */
  slope: number | null;
}

export function discountMarketLink(series: readonly WeekPoint[]): DiscountMarketLink {
  const n = series.length;
  if (n < 3) return { weeks: n, correlation: null, slope: null };
  const xs = series.map((w) => w.retailPerGal);
  const ys = series.map((w) => w.discountPerGal);
  const mx = xs.reduce((a, v) => a + v, 0) / n;
  const my = ys.reduce((a, v) => a + v, 0) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    cov += (xs[i]! - mx) * (ys[i]! - my);
    vx += (xs[i]! - mx) ** 2;
    vy += (ys[i]! - my) ** 2;
  }
  // A series that never really moved has nothing to correlate. Without this, a flat cents-off deal
  // whose per-gallon discount differs only in floating-point noise reports a confident-looking −0.44.
  // Half a cent per gallon is the smallest move that could be a real contract term.
  const FLAT = 0.005;
  if (Math.sqrt(vx / n) < FLAT || Math.sqrt(vy / n) < FLAT) return { weeks: n, correlation: null, slope: null };
  return { weeks: n, correlation: cov / Math.sqrt(vx * vy), slope: cov / vx };
}

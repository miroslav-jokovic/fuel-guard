import { z } from "zod";
import { pointToSegmentMiles } from "./smartFueling/geo.js";
import type { LatLng } from "./smartFueling/flexPolyline.js";
import { thinPath } from "./drivenPath.js";

/**
 * One Out of route warning drawn on our own map (OUT-OF-ROUTE-MAP-ANALYSIS-2026-11-27, option A;
 * Q-ORM1–4 ruled (a) 2026-11-27). Pure: the wire, the rule for which load a truck was on, the verdict
 * and the sentence. The reads are `livemap`'s; the screen is the follow-up drawer's.
 *
 * ── WHY OUR LINE AND NOT SAMSARA'S (§1.2–§1.4) ───────────────────────────────────────────────────
 * Samsara's incident carries no location and its routes carry no line. Our load's HERE route, against
 * the truck's own GPS, read 6 ±1 mi at Samsara's `happenedAtTime` in 20 of 28 sampled incidents —
 * Samsara's threshold is 6 mi. So the map is ours, labelled as ours, and the verdict is computed here
 * rather than inherited: in 8 of 28 Samsara closed the incident while the truck was 13–311 mi off.
 */
const latLng = z.object({ lat: z.number(), lng: z.number() });
const at = z.object({ lat: z.number(), lng: z.number(), at: z.string() });

export const OFF_ROUTE_STATES = ["never_off", "back", "still_off", "closed_while_off"] as const;
export type OffRouteState = (typeof OFF_ROUTE_STATES)[number];

export const offRouteVerdictSchema = z.object({
  state: z.enum(OFF_ROUTE_STATES),
  left: at.nullable(),
  furthest: at.extend({ miles: z.number() }).nullable(),
  back: at.nullable(),
  /** Miles from the planned line at the last fix drawn. */
  lastMiles: z.number(),
  lastAt: z.string(),
});
export type OffRouteVerdict = z.infer<typeof offRouteVerdictSchema>;

export const offRouteViewSchema = z.object({
  /** Samsara's own threshold, read from the alert's configuration (D-ORM4). */
  thresholdMiles: z.number(),
  samsara: z.object({ happenedAt: z.string(), endedAt: z.string().nullable(), stillActive: z.boolean() }),
  window: z.object({ start: z.string(), end: z.string(), capped: z.boolean() }),
  /** The driven path, thinned (DBV6's `thinPath`). Empty when Samsara has no GPS for the window. */
  path: z.array(latLng),
  planned: z
    .object({
      loadRef: z.string().nullable(),
      /** On the load, or on the way to the next load's pickup (D-ORM2). */
      relation: z.enum(["on_load", "to_pickup"]),
      /** The load's route, pickup → every stop → delivery. Null when routing did not answer. */
      route: z.array(latLng).nullable(),
      /** Q-ORM2 (a): from the truck's first fix of the window to the pickup — ours, and labelled so. */
      toPickup: z.array(latLng).nullable(),
      stops: z.array(latLng.extend({ kind: z.string().nullable(), name: z.string().nullable() })),
    })
    .nullable(),
  /** Why something is missing, in the reader's words: no load, routing down, no GPS. */
  notes: z.array(z.string()),
  verdict: offRouteVerdictSchema.nullable(),
});
export type OffRouteView = z.infer<typeof offRouteViewSchema>;

// ── which load ───────────────────────────────────────────────────────────────────────────────────

/** One load's span, from its stops: first stop's arrival (else departure, else appointment) to the last's departure (else appointment). */
export interface LoadSpan {
  loadId: string;
  startMs: number | null;
  /** Null while the last stop has neither happened nor been scheduled: the load is still open. */
  endMs: number | null;
}

export interface SpanStop {
  seq: number;
  actualArrivalAt: string | null;
  actualDepartureAt: string | null;
  appointmentStart: string | null;
  appointmentEnd: string | null;
  completedAt: string | null;
}

const ms = (v: string | null) => (v && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);

/**
 * A load's span from its stops, the rule the 2026-11-27 measurement used. `loads.completed_at` is never
 * set on a McLeod load (0 of 12,305 delivered, measured), so only the stops say when a load ran.
 */
export function loadSpanOf(loadId: string, stops: readonly SpanStop[]): LoadSpan {
  const ordered = [...stops].sort((a, b) => a.seq - b.seq);
  const first = ordered[0];
  const last = ordered.at(-1);
  return {
    loadId,
    startMs: first ? (ms(first.actualArrivalAt) ?? ms(first.actualDepartureAt) ?? ms(first.appointmentStart)) : null,
    endMs: last ? (ms(last.actualDepartureAt) ?? ms(last.completedAt) ?? ms(last.appointmentEnd) ?? ms(last.appointmentStart)) : null,
  };
}

/** ±1 h around a load's span, the slack the 2026-11-27 measurement used (447 of 563 incidents on a load). */
export const LOAD_SPAN_SLACK_MS = 3_600_000;
/** Off a load, the next load starting within 48 h is the one the truck was driving to: 91 of the 112 off-load incidents (2026-11-27). */
export const NEXT_LOAD_WITHIN_MS = 48 * 3_600_000;

/**
 * The load a truck was on at `atMs`, or the one it was driving to. Where two spans cover the moment
 * (5 of 563 incidents), the one that started last: the truck has moved on to it.
 */
export function loadAtInstant(spans: readonly LoadSpan[], atMs: number, nowMs: number): { loadId: string; relation: "on_load" | "to_pickup" } | null {
  let on: LoadSpan | null = null;
  let next: LoadSpan | null = null;
  for (const s of spans) {
    if (s.startMs === null) continue;
    const end = (s.endMs ?? nowMs) + LOAD_SPAN_SLACK_MS;
    if (atMs >= s.startMs - LOAD_SPAN_SLACK_MS && atMs <= end) {
      if (!on || s.startMs > on.startMs!) on = s;
    } else if (s.startMs > atMs && s.startMs - atMs <= NEXT_LOAD_WITHIN_MS) {
      if (!next || s.startMs < next.startMs!) next = s;
    }
  }
  if (on) return { loadId: on.loadId, relation: "on_load" };
  return next ? { loadId: next.loadId, relation: "to_pickup" } : null;
}

// ── the window ───────────────────────────────────────────────────────────────────────────────────

/** Before the alert: Samsara alerts after 10 min past 6 mi, so 45 min back shows the truck leaving. */
export const OFF_ROUTE_LEAD_MS = 45 * 60_000;
/** After the close: enough to see the truck settle back on the line. */
export const OFF_ROUTE_TAIL_MS = 20 * 60_000;
/** DBV6's cap on a GPS window. p99 of incidents is 86 h, so about 1 in 100 is cut — and says so. */
export const OFF_ROUTE_MAX_MS = 72 * 3_600_000;

export function offRouteWindow(happenedAt: string, endedAt: string | null, nowMs: number): { startMs: number; endMs: number; capped: boolean } {
  const startMs = Date.parse(happenedAt) - OFF_ROUTE_LEAD_MS;
  const wanted = Math.min((endedAt ? Date.parse(endedAt) : nowMs) + OFF_ROUTE_TAIL_MS, nowMs);
  return wanted - startMs > OFF_ROUTE_MAX_MS ? { startMs, endMs: startMs + OFF_ROUTE_MAX_MS, capped: true } : { startMs, endMs: wanted, capped: false };
}

// ── the verdict ──────────────────────────────────────────────────────────────────────────────────

export interface TimedPoint extends LatLng {
  time: string;
}

/** One fix a minute is enough to judge a 10-minute rule, and bounds the work on a 72-hour window. */
const SAMPLE_MS = 60_000;
/** Thinning the planned line moves it by at most this — nothing beside a 6-mile threshold. */
const LINE_TOLERANCE_MILES = 0.05;

interface Segment { a: LatLng; b: LatLng; minLat: number; maxLat: number; minLng: number; maxLng: number }
const MILES_PER_DEG_LAT = 69.0;

function segmentsOf(lines: readonly (readonly LatLng[])[]): Segment[] {
  const out: Segment[] = [];
  for (const raw of lines) {
    const line = thinPath(raw, LINE_TOLERANCE_MILES);
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i]!, b = line[i + 1]!;
      out.push({ a, b, minLat: Math.min(a.lat, b.lat), maxLat: Math.max(a.lat, b.lat), minLng: Math.min(a.lng, b.lng), maxLng: Math.max(a.lng, b.lng) });
    }
  }
  return out;
}

/** Miles from `p` to the nearest segment. A segment whose box is already farther than the best is skipped. */
function milesToLines(p: LatLng, segs: readonly Segment[]): number {
  const cosLat = Math.max(Math.cos((p.lat * Math.PI) / 180), 0.01);
  let best = Infinity;
  for (const s of segs) {
    const dLat = p.lat < s.minLat ? s.minLat - p.lat : p.lat > s.maxLat ? p.lat - s.maxLat : 0;
    const dLng = p.lng < s.minLng ? s.minLng - p.lng : p.lng > s.maxLng ? p.lng - s.maxLng : 0;
    if (Math.hypot(dLat * MILES_PER_DEG_LAT, dLng * MILES_PER_DEG_LAT * cosLat) >= best) continue;
    const m = pointToSegmentMiles(p, s.a, s.b).miles;
    if (m < best) best = m;
  }
  return best;
}

/** One fix a minute, oldest first; the last fix always kept. */
function sampled(points: readonly TimedPoint[]): TimedPoint[] {
  const out: TimedPoint[] = [];
  let lastMs = -Infinity;
  for (const p of points) {
    const t = Date.parse(p.time);
    if (t - lastMs >= SAMPLE_MS) {
      out.push(p);
      lastMs = t;
    }
  }
  const last = points.at(-1);
  if (last && out.at(-1) !== last) out.push(last);
  return out;
}

/**
 * Where the truck left the planned line, how far it went, and whether it came back (D-ORM3). Left = the
 * first fix past the threshold; furthest = the greatest distance after it; back = the first fix within
 * the threshold after the LAST stretch past it, so a truck that wandered twice is back only once it
 * stays back. Null when there is no line or fewer than two fixes — there is nothing to judge.
 */
export function offRouteVerdict(
  points: readonly TimedPoint[],
  lines: readonly (readonly LatLng[])[],
  thresholdMiles: number,
  samsara: { stillActive: boolean },
): OffRouteVerdict | null {
  const segs = segmentsOf(lines.filter((l) => l.length >= 2));
  const fixes = sampled(points);
  if (segs.length === 0 || fixes.length < 2) return null;
  const d = fixes.map((p) => milesToLines(p, segs));
  const pt = (i: number) => ({ lat: fixes[i]!.lat, lng: fixes[i]!.lng, at: new Date(Date.parse(fixes[i]!.time)).toISOString() });
  const first = d.findIndex((m) => m > thresholdMiles);
  const lastIdx = fixes.length - 1;
  const end = { lastMiles: round1(d[lastIdx]!), lastAt: pt(lastIdx).at };
  if (first < 0) return { state: "never_off", left: null, furthest: null, back: null, ...end };
  let far = first;
  for (let i = first; i <= lastIdx; i++) if (d[i]! > d[far]!) far = i;
  let lastOff = lastIdx;
  while (d[lastOff]! <= thresholdMiles) lastOff -= 1;
  const left = pt(first);
  const furthest = { ...pt(far), miles: round1(d[far]!) };
  if (lastOff < lastIdx) return { state: "back", left, furthest, back: pt(lastOff + 1), ...end };
  return { state: samsara.stillActive ? "still_off" : "closed_while_off", left, furthest, back: null, ...end };
}

const round1 = (m: number) => Math.round(m * 10) / 10;

// ── the sentence ─────────────────────────────────────────────────────────────────────────────────

/**
 * What the drawer says above the map — the map is optional on a phone, this is not (D-ORM3). Times are
 * the CALLER's to format, so they read on the reader's own clock. Miles and times only (Q-ORM4).
 */
export function offRouteSentence(view: Pick<OffRouteView, "verdict" | "planned" | "samsara" | "window" | "thresholdMiles">, time: (iso: string) => string): string {
  const v = view.verdict;
  if (!view.planned) return "There was no load on this truck at that time, so there is no planned route to compare with. The map shows where it drove.";
  if (!v) return "The planned route or the truck's GPS could not be read, so this cannot be judged here. Open it in Samsara.";
  const mi = (m: number) => `${Math.round(m)} mi`;
  const cut = view.window.capped ? " (only the first 72 hours are drawn)" : "";
  switch (v.state) {
    case "never_off":
      return `The truck stayed within ${mi(view.thresholdMiles)} of our planned route the whole time${cut}. Samsara judged it against its own route, which it does not share with us.`;
    case "back":
      return `Left the planned route at ${time(v.left!.at)}, at most ${mi(v.furthest!.miles)} off, back on it at ${time(v.back!.at)}.`;
    case "still_off":
      return `Left the planned route at ${time(v.left!.at)}, at most ${mi(v.furthest!.miles)} off. Still ${mi(v.lastMiles)} off at the last fix, ${time(v.lastAt)}${cut}.`;
    default: // "closed_while_off"
      return `Left the planned route at ${time(v.left!.at)}, at most ${mi(v.furthest!.miles)} off. Samsara closed this at ${time(view.samsara.endedAt ?? v.lastAt)}, but at the last fix drawn, ${time(v.lastAt)}, the truck was still ${mi(v.lastMiles)} from the planned route${cut}.`;
  }
}

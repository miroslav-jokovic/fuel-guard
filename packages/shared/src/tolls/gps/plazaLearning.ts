/**
 * Where a toll plaza stands, its time zone and its clock, learned from tolls whose truck is already
 * known (TOLLS-PER-TRUCK-PLAN D-TL14, D-TL21). Pure: the worker fetches the tracks, this decides.
 *
 * ── THE CLOCK IS NOT ASSUMED ───────────────────────────────────────────────────────────────────
 * A statement prints the plaza's local time and no zone, and one account bills plazas in several:
 * the K-TAG statements carry Houston, Florida and Oklahoma tolls. So every US zone's reading of the
 * printed time is tried (`PROBE_ZONES`; zones that read every sample the same way are one reading).
 * Under the wrong reading the known truck is an hour or more from the plaza, a different place each
 * day, and the samples scatter by tens of kilometres. Under the right one they meet at the gantry. A
 * plaza is placed only when exactly one reading clusters, and then the zone stored is the tz dataset's
 * zone AT the cluster (`zoneAt`), which must read every sample's time as the same instant. So the
 * zone comes from where the plaza is, never from the agency.
 *
 * ── THE GANTRY, NOT WHERE THE TRUCK WAS AT THE PRINTED MINUTE ──────────────────────────────────
 * A printed minute can be a minute or two from the moment the truck passed (truncated to the minute,
 * and each agency posts on its own clock). At 65 mph that is up to 3 km along the road. Closest
 * approach alone cannot fix that: every truck at a plaza drives the same road, so the point nearest a
 * guess is the foot of the guess on the road, wherever along it the guess was. So the clock is
 * searched (`meetingPoint`): the plaza is where the trucks meet at printed time + o, for the o that
 * brings them closest. Each sample's own offset is then the moment it came closest to that point.
 *
 * ── A STALE LIST MUST NOT TEACH THE PLAZA ──────────────────────────────────────────────────────
 * Measured 2026-11-18: tag 02210699936 was listed on for-sale truck 604 while GPS put it on 842. A
 * toll "known" through that entry places 604 wherever 604 was. D-TL14 said "leave one tag out", each
 * tag held to the plaza the others place; built that way, it failed its own test: with a stale tag at
 * two of six samples the others' median falls between the two places and EVERY tag reads disputed.
 * So the plaza is the meeting point of all samples (a median: a minority cannot move it), a tag most
 * of whose samples are not there is left out whole, and the plaza is found again without it. With one
 * tag only, the spread is the test, because a wrong truck is not at the plaza on two different days.
 *
 * ── ONE STRAY SAMPLE DOES NOT BLOCK A PLAZA, AND A MINORITY CANNOT PLACE ONE ────────────────────
 * A sample farther than the limit from where the others meet is left out and recorded `too_far` (a
 * gateway's bad fix, or a tag moved that day; the toll's own verdict will say which). The plaza is
 * placed only when more than half the samples with a fix agree, so three that happen to meet cannot
 * outvote five that do not.
 */
import type { TollCheckpointRole } from "./checkpoints.js";
import { dayOfLocal, instantsOf } from "./checkpoints.js";
import { closestApproach, distanceM, median, medianPoint, positionAt, type Fix, type Point } from "./geo.js";

/** Bump when a rule below changes: every plaza is learned again, the old rows kept beside the new. */
export const PLAZA_ENGINE_VERSION = 1;
/** Every US reading of a printed time. Arizona is listed because it does not change its clocks. */
export const PROBE_ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles"] as const;
/** D-TL14: placed only with every kept sample within this of the plaza. */
export const PLAZA_MAX_SPREAD_M = 3_000;
export const PLAZA_MIN_SAMPLES = 3;
export const PLAZA_MIN_DAYS = 2;
/** At most this many known tolls are fetched to learn one plaza. */
export const PLAZA_SAMPLE_CAP = 8;
/**
 * How far either side of the printed instant the clock is searched and the closest approach looked
 * for. Measured 2026-11-19: Illinois Tollway plaza 51 met best at +299 s, the edge of a ±5 minute
 * search, so the search runs ±10.
 */
export const APPROACH_HALF_WINDOW_MS = 10 * 60_000;
/**
 * The closest approach is looked for further out than the clock is searched, and one that lands on
 * the edge of its window is no closest approach at all (the truck was still getting closer). Without
 * this, measured 2026-11-19, every point near the edge of the search scored perfect agreement: each
 * truck's "closest moment" was the window's edge, the same offset for all.
 */
const APPROACH_SEARCH_MS = APPROACH_HALF_WINDOW_MS + 5 * 60_000;
/** A printed minute is truncated: a point agreeing better than this with the trucks is not "better". */
const CLOCK_RESOLUTION_MS = 30_000;
/**
 * ...and the point must be ON the trucks' paths, not merely near them: where they cross on different
 * headings the gantry is the one point every path goes through, and a point that only agrees in time
 * sits between the paths (950 m off in the crossing test). Lanes and directions of one road lie
 * within this of each other.
 */
const ON_PATH_M = 100;
const EDGE_MS = 15_000;
/**
 * A toll is paid passing, not parked. Measured 2026-11-19 on the real statements: read an hour off,
 * the trucks of a plaza near the home yard are AT the yard, which clusters as tightly as a gantry, and
 * 13 of 60 plazas came back "two readings both place it". So a sample votes only if its truck moved at
 * least this far in the minute either side of its closest approach (a truck stopped at a booth still
 * covers it accelerating away).
 */
export const PASSING_MIN_MOVE_M = 100;

/** A toll whose truck the tag history already names. */
export interface KnownToll {
  lineId: string;
  role: TollCheckpointRole;
  local: string;
  tagKey: string;
  vehicleId: string;
  samsaraVehicleId: string;
}

/**
 * Which known tolls to fetch: one a day before a second on any day, and across tags in turn so leave-
 * one-tag-out has others to hold each tag to. Ordered by line id, which is random but stable: the
 * same tolls give the same picks, and a plaza tried again after more statements are read gets a
 * different sample, not the same eight earliest tolls that failed last time.
 */
export function pickSamples(known: readonly KnownToll[], cap = PLAZA_SAMPLE_CAP): KnownToll[] {
  const sorted = [...known].sort((a, b) => a.lineId.localeCompare(b.lineId) || a.role.localeCompare(b.role));
  const picked: KnownToll[] = [];
  const days = new Set<string>();
  const perTag = new Map<string, number>();
  // Rounds: a sample is taken only if its tag has fewer picks than this round allows and, in the
  // first pass, its day is new.
  for (const newDayOnly of [true, false]) {
    for (let round = 1; round <= cap && picked.length < cap; round++) {
      for (const k of sorted) {
        if (picked.length >= cap) break;
        if (picked.includes(k) || (perTag.get(k.tagKey) ?? 0) >= round) continue;
        if (newDayOnly && days.has(dayOfLocal(k.local))) continue;
        picked.push(k);
        days.add(dayOfLocal(k.local));
        perTag.set(k.tagKey, (perTag.get(k.tagKey) ?? 0) + 1);
      }
    }
  }
  return picked;
}

/** The span of the known truck's track one fetch must cover to try every reading of the printed time. */
export function sampleFetchSpan(local: string): { startMs: number; endMs: number } | null {
  const all = PROBE_ZONES.flatMap((z) => instantsOf(local, z));
  if (all.length === 0) return null;
  // The clock search plus the approach search, plus the minute `movingAt` reads either side.
  const reach = APPROACH_HALF_WINDOW_MS + 5 * 60_000 + 60_000;
  return { startMs: Math.min(...all) - reach, endMs: Math.max(...all) + reach };
}

export interface SampleTrack {
  sample: KnownToll;
  /** The known truck's fixes over `sampleFetchSpan`, sorted by time. */
  fixes: Fix[];
}

export type SampleUse = "used" | "clock_ambiguous" | "no_fix" | "stationary" | "tag_disputed" | "too_far";

export interface SampleRecord {
  lineId: string;
  role: TollCheckpointRole;
  vehicleId: string;
  tagKey: string;
  day: string;
  use: SampleUse;
  /** Under the reading that placed the plaza (or the best one tried): the closest approach. */
  approach: { lat: number; lon: number; distanceM: number; offsetS: number } | null;
}

/** One reading of the clock, and how its samples fell. Kept on a refusal so it says why. */
export interface ReadingTried {
  zones: string[];
  kept: number;
  days: number;
  spreadM: number | null;
  /** The tz dataset's zone where this reading's trucks meet. */
  zoneAtPoint: string | null;
}

export type PlazaLearning =
  | {
      outcome: "placed";
      lat: number;
      lon: number;
      spreadM: number;
      zone: string;
      offsetS: number;
      offsetSpreadS: number;
      sampleCount: number;
      dayCount: number;
      samples: SampleRecord[];
      readings: ReadingTried[];
    }
  | { outcome: "not_placed"; reason: string; samples: SampleRecord[]; readings: ReadingTried[] };

interface Reading {
  zones: string[];
  /** Per usable track, its instant under this reading. */
  instants: number[];
}

interface Cluster {
  reading: Reading;
  plaza: Point | null;
  approaches: (({ distanceM: number } & Fix) | null)[];
  disputed: Set<string>;
  /** Per usable track: did the truck move through its closest approach. */
  moving: boolean[];
  /** Samples with a fix, moving, and an undisputed tag: the ones that vote. */
  voters: number[];
  kept: number[];
  spreadM: number | null;
  days: number;
}

const km = (m: number) => `${(m / 1000).toFixed(1)} km`;

/** Learn one plaza from its sample tracks. `zoneAt` is the tz dataset's zone at a point. */
export function learnPlaza(tracks: readonly SampleTrack[], zoneAt: (lat: number, lon: number) => string | null): PlazaLearning {
  // A printed time that is two instants (or none) in some US zone cannot teach a clock.
  const usable = tracks.filter((t) => PROBE_ZONES.every((z) => instantsOf(t.sample.local, z).length === 1));
  const readings: Reading[] = [];
  for (const zone of PROBE_ZONES) {
    const instants = usable.map((t) => instantsOf(t.sample.local, zone)[0]!);
    const same = readings.find((r) => r.instants.every((ms, i) => ms === instants[i]));
    if (same) same.zones.push(zone);
    else readings.push({ zones: [zone], instants });
  }
  const clusters = readings.map((r) => cluster(usable, r));
  // The zone where a reading's trucks meet must read every printed time as that reading's instant.
  // This is what tells the gantry from the place the same trucks were an hour earlier: on a lane run
  // at a steady speed, trucks an hour early meet too, 100 km up the same road (measured 2026-11-19: 17
  // of 60 real plazas met under two readings). Up the road is still the plaza's own zone, so the
  // early reading is read in a zone that disagrees with it.
  const zoneOf = (c: Cluster): string | null => {
    const z = c.plaza ? zoneAt(c.plaza.lat, c.plaza.lon) : null;
    if (!z) return null;
    return c.kept.every((i) => {
      const at = instantsOf(usable[i]!.sample.local, z);
      return at.length === 1 && at[0] === c.reading.instants[i];
    })
      ? z
      : null;
  };
  const meeting = clusters.filter(passes);
  const passing = meeting.filter((c) => zoneOf(c) !== null);
  const tried: ReadingTried[] = clusters.map((c) => ({ zones: c.reading.zones, kept: c.kept.length, days: c.days, spreadM: c.spreadM === null ? null : Math.round(c.spreadM), zoneAtPoint: c.plaza ? zoneAt(c.plaza.lat, c.plaza.lon) : null }));
  const best = passing[0] ?? meeting[0] ?? [...clusters].sort(rank)[0];
  const records = (c: Cluster | undefined): SampleRecord[] =>
    tracks.map((t) => {
      const i = usable.indexOf(t);
      const base = { lineId: t.sample.lineId, role: t.sample.role, vehicleId: t.sample.vehicleId, tagKey: t.sample.tagKey, day: dayOfLocal(t.sample.local) };
      if (i === -1) return { ...base, use: "clock_ambiguous", approach: null };
      const a = c?.approaches[i] ?? null;
      const use: SampleUse = !a ? "no_fix" : !c!.moving[i] ? "stationary" : c!.disputed.has(t.sample.tagKey) ? "tag_disputed" : c!.kept.includes(i) ? "used" : "too_far";
      return { ...base, use, approach: a ? { lat: a.lat, lon: a.lon, distanceM: Math.round(a.distanceM), offsetS: Math.round((a.ms - c!.reading.instants[i]!) / 1000) } : null };
    });

  if (passing.length > 1) {
    return { outcome: "not_placed", reason: `Two readings of the printed time (${passing.map((c) => c.reading.zones[0]).join(", ")}) both place it, each in a zone that agrees.`, samples: records(passing[0]), readings: tried };
  }
  if (passing.length === 0) {
    const reason =
      usable.length < PLAZA_MIN_SAMPLES
        ? `${usable.length} known toll${usable.length === 1 ? "" : "s"} with a usable time; it takes ${PLAZA_MIN_SAMPLES} on ${PLAZA_MIN_DAYS} days.`
        : meeting.length > 0
          ? `The known trucks meet, but the time zone at that place does not read the printed times the way their positions do.`
          : `At most ${best?.kept.length ?? 0} of ${best?.voters.length ?? 0} known tolls, on ${best?.days ?? 0} day(s), meet within ${km(PLAZA_MAX_SPREAD_M)} under any reading of the time; it takes ${PLAZA_MIN_SAMPLES} on ${PLAZA_MIN_DAYS} days and more than half.`;
    return { outcome: "not_placed", reason, samples: records(best), readings: tried };
  }

  const c = passing[0]!;
  const plaza = c.plaza!;
  const zone = zoneOf(c)!;
  const offsets = c.kept.map((i) => (c.approaches[i]!.ms - c.reading.instants[i]!) / 1000);
  const offsetS = median(offsets);
  return {
    outcome: "placed",
    lat: round6(plaza.lat),
    lon: round6(plaza.lon),
    spreadM: Math.round(c.spreadM!),
    zone,
    offsetS: Math.round(offsetS),
    offsetSpreadS: Math.round(Math.max(...offsets.map((o) => Math.abs(o - offsetS)))),
    sampleCount: c.kept.length,
    dayCount: c.days,
    samples: records(c),
    readings: tried,
  };
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

// "More than half" is also what `meetingPoint` asks of the point it returns, so breaking it here alone
// changes nothing a test can see (an equivalent mutant, checked 2026-11-19); it is stated here because
// this is where the reader looks for what placing a plaza takes.
const passes = (c: Cluster) =>
  c.spreadM !== null && c.kept.length >= PLAZA_MIN_SAMPLES && c.days >= PLAZA_MIN_DAYS && c.spreadM <= PLAZA_MAX_SPREAD_M && c.kept.length * 2 > c.voters.length;

/** Best refusal first: most samples kept, then the tightest. */
const rank = (a: Cluster, b: Cluster) => b.kept.length - a.kept.length || (a.spreadM ?? Infinity) - (b.spreadM ?? Infinity);

/** The closest approach to `to` around `atMs`, or null when there is none or it sits on the window's edge. */
function approachAround(fixes: readonly Fix[], to: Point, atMs: number) {
  const from = atMs - APPROACH_SEARCH_MS;
  const until = atMs + APPROACH_SEARCH_MS;
  const a = closestApproach(fixes, to, from, until);
  return a && a.ms - from > EDGE_MS && until - a.ms > EDGE_MS ? a : null;
}

function approachesTo(usable: readonly SampleTrack[], r: Reading, to: Point | null) {
  return usable.map((t, i) => (to ? approachAround(t.fixes, to, r.instants[i]!) : null));
}

/** The offsets tried for the plaza's clock, every 10 s across the approach window. */
const OFFSET_GRID_MS = Array.from({ length: (2 * APPROACH_HALF_WINDOW_MS) / 10_000 + 1 }, (_, i) => i * 10_000 - APPROACH_HALF_WINDOW_MS);

/** Did the truck move `PASSING_MIN_MOVE_M` in the minute either side of `ms`? */
function movingAt(fixes: readonly Fix[], ms: number): boolean {
  const before = positionAt(fixes, ms - 60_000);
  const after = positionAt(fixes, ms + 60_000);
  return !!before && !!after && distanceM(before, after) >= PASSING_MIN_MOVE_M;
}

/**
 * Where the given samples' trucks passed together: of the points their tracks share (the median of
 * their positions at printed instant + o, for every o searched), the one at which the moments they
 * came closest agree best with the printed clock, as the median absolute deviation of those offsets.
 * The printed clock is trusted unless the trucks disagree with it by more than its own resolution:
 * of the points within `CLOCK_RESOLUTION_MS` of the best agreement and on the trucks' paths
 * (`ON_PATH_M`), the one nearest the printed time.
 *
 * WHY TIME AND NOT PLACE (measured 2026-11-19): the first version took the o at which the trucks'
 * positions bunch tightest. Trucks bunch where they slow down — a yard, a terminal, a queue — so on the
 * real statements seven plazas of 56 landed up to ten minutes down the road (offsets at the ±600 s
 * edge). At the gantry, the passing moments differ only by the printed minute's truncation; ten
 * minutes on, they differ by ten minutes of traffic. That alone still walked six plazas to the edge
 * of the search (+600 s, the trucks agreeing a few seconds better ten minutes on, down the one road
 * most of them take after the exit); a point there would call a truck that paid and turned the other
 * way `absent`. Hence the resolution rule above. With every truck at one speed in one direction
 * the gantry cannot be told from any other point of the road; then the point and its offset are a
 * pair, and an observation reads them as one.
 */
function meetingPoint(usable: readonly SampleTrack[], r: Reading, which: readonly number[]): Point | null {
  const tried: { mad: number; distM: number; n: number; o: number; at: Point }[] = [];
  for (const o of OFFSET_GRID_MS) {
    const pts = which.map((i) => positionAt(usable[i]!.fixes, r.instants[i]! + o)).filter((p): p is Fix => p !== null);
    if (pts.length * 2 <= which.length) continue;
    const at = medianPoint(pts)!;
    const offsets = which
      .map((i) => {
        const a = approachAround(usable[i]!.fixes, at, r.instants[i]!);
        return a && a.distanceM <= PLAZA_MAX_SPREAD_M && movingAt(usable[i]!.fixes, a.ms) ? { ...a, offsetMs: a.ms - r.instants[i]! } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (offsets.length * 2 <= which.length) continue;
    const off = offsets.map((a) => a.offsetMs);
    const mid = median(off);
    tried.push({ mad: median(off.map((x) => Math.abs(x - mid))), distM: median(offsets.map((a) => a.distanceM)), n: offsets.length, o, at });
  }
  if (tried.length === 0) return null;
  const least = Math.min(...tried.map((t) => t.mad));
  const inTime = tried.filter((t) => t.mad <= least + CLOCK_RESOLUTION_MS);
  const nearest = Math.min(...inTime.map((t) => t.distM));
  const fair = inTime.filter((t) => t.distM <= nearest + ON_PATH_M);
  fair.sort((a, b) => Math.abs(a.o) - Math.abs(b.o) || b.n - a.n);
  return fair[0]!.at;
}

function cluster(usable: readonly SampleTrack[], r: Reading): Cluster {
  const all = usable.map((_, i) => i);
  let plaza = meetingPoint(usable, r, all);
  let approaches = approachesTo(usable, r, plaza);
  const movingOf = () => approaches.map((a, i) => !!a && movingAt(usable[i]!.fixes, a.ms));
  let moving = movingOf();
  const far = (i: number) => approaches[i] === null || !moving[i] || approaches[i]!.distanceM > PLAZA_MAX_SPREAD_M;
  // A tag most of whose tolls the trucks' meeting point does not see is a tag the history has on the
  // wrong truck (604 → 842): every sample of it is left out, then the plaza is found again without it.
  const disputed = new Set<string>();
  for (const tag of new Set(usable.map((t) => t.sample.tagKey))) {
    const mine = all.filter((i) => usable[i]!.sample.tagKey === tag && approaches[i] !== null);
    if (mine.length > 0 && mine.filter(far).length * 2 > mine.length) disputed.add(tag);
  }
  const votersOf = () => all.filter((i) => approaches[i] !== null && moving[i] && !disputed.has(usable[i]!.sample.tagKey));
  // Then once more from only the samples that agree, so the strays do not pull the median.
  const agreeing = votersOf().filter((i) => !far(i));
  if (agreeing.length > 0 && agreeing.length < all.length) {
    plaza = meetingPoint(usable, r, agreeing) ?? plaza;
    approaches = approachesTo(usable, r, plaza);
    moving = movingOf();
  }
  const voters = votersOf();
  const kept = voters.filter((i) => !far(i));
  const spreadM = plaza && kept.length > 0 ? Math.max(...kept.map((i) => approaches[i]!.distanceM)) : null;
  const days = new Set(kept.map((i) => dayOfLocal(usable[i]!.sample.local))).size;
  return { reading: r, plaza, approaches, moving, disputed, voters, kept, spreadM, days };
}

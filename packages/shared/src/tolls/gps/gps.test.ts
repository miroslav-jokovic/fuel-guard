import { describe, expect, it } from "vitest";
import { wallClockInZone } from "../../calendarDay.js";
import { closestApproach, distanceM, MAX_GAP_MS, positionAt, type Fix } from "./geo.js";
import { checkpointsOf, instantsOf, plazaKeyOf, type TollLineForGps } from "./checkpoints.js";
import { learnPlaza, pickSamples, PLAZA_SAMPLE_CAP, type KnownToll, type SampleTrack } from "./plazaLearning.js";
import { plazaWindow, fixesOfGps, observe, OBSERVE_MAX_HALF_MS, OBSERVE_MIN_HALF_MS, planWindows } from "./observation.js";

// ── A synthetic world: a gantry in Kansas, trucks driving straight lines through it ─────────────
const PLAZA = { lat: 38.9, lon: -95.2 };
const CHICAGO = "America/Chicago";
const MIN = 60_000;
const pad = (n: number) => String(n).padStart(2, "0");
const localOf = (ms: number, zone: string) => {
  const w = wallClockInZone(new Date(ms), zone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
};

/** A truck at 28 m/s on `headingDeg`, passing `through` at `passMs`, a fix every 10 s for ±5 hours. */
function track(passMs: number, headingDeg: number, through = PLAZA): Fix[] {
  const h = (headingDeg * Math.PI) / 180;
  const out: Fix[] = [];
  for (let t = -5 * 3600; t <= 5 * 3600; t += 10) {
    const m = 28 * t;
    out.push({ ms: passMs + t * 1000, lat: through.lat + (m * Math.cos(h)) / 111_320, lon: through.lon + (m * Math.sin(h)) / (111_320 * Math.cos((through.lat * Math.PI) / 180)) });
  }
  return out;
}

/** One known toll on day `d` of June 2026 (at 14:00 UTC + d minutes): the truck passed 40 s after the printed minute. */
function sample(d: number, tag = "ktag:1", opts: { heading?: number; through?: { lat: number; lon: number }; printedMs?: number } = {}): SampleTrack {
  const passMs = opts.printedMs ?? Date.UTC(2026, 5, d, 14, d) + 40_000;
  const local = localOf(passMs - 40_000, CHICAGO);
  const k: KnownToll = { lineId: `line-${tag}-${d}`, role: "exit", local, tagKey: tag, vehicleId: `veh-${tag}`, samsaraVehicleId: `s-${tag}` };
  return { sample: k, fixes: track(passMs, opts.heading ?? d * 47, opts.through) };
}
const inKansas = () => CHICAGO;

describe("geo", () => {
  it("one degree of latitude is 111.2 km", () => {
    expect(distanceM({ lat: 38, lon: -95 }, { lat: 39, lon: -95 })).toBeCloseTo(111_195, -2);
  });
  it("reads a position between two fixes, but not across a silence longer than MAX_GAP_MS", () => {
    const a = { ms: 0, lat: 38, lon: -95 };
    const b = { ms: 60_000, lat: 38.01, lon: -95 };
    expect(positionAt([a, b], 30_000)!.lat).toBeCloseTo(38.005, 6);
    const far = { ms: MAX_GAP_MS + 60_000, lat: 39, lon: -95 };
    expect(positionAt([a, far], 120_000)).toBeNull();
    expect(positionAt([a, far], 30_000)).toEqual(a);
  });
  it("finds the gantry between two fixes, closer than either fix", () => {
    const fixes = [
      { ms: 0, lat: PLAZA.lat - 0.002, lon: PLAZA.lon },
      { ms: 10_000, lat: PLAZA.lat + 0.002, lon: PLAZA.lon },
    ];
    const a = closestApproach(fixes, PLAZA, -MIN, MIN)!;
    expect(a.distanceM).toBeLessThan(1);
    expect(a.ms).toBeCloseTo(5_000, -1);
    expect(closestApproach(fixes, PLAZA, 20_000, 30_000)).toBeNull();
  });
});

describe("checkpoints", () => {
  const line: TollLineForGps = {
    id: "l1", provider: "ezpass", kind: "toll", tagNumber: "123", plate: null, agency: " nysta ", entryPlaza: "15", entryAt: "2026-06-01T10:00",
    exitPlaza: "24  A", exitAt: "2026-06-01T11:30", location: null,
  };
  it("names a plaza by provider, role, agency, plaza and location, spacing and case aside", () => {
    expect(plazaKeyOf("ktag", "exit", "kta", " plaza  d", "Wichita")).toBe("ktag|exit|KTA|PLAZA D|WICHITA");
  });
  it("checks a closed-road toll at its exit and its entry, and a non-toll nowhere", () => {
    expect(checkpointsOf(line).map((c) => [c.role, c.plazaKey, c.local])).toEqual([
      ["exit", "ezpass|exit|NYSTA|24 A|", "2026-06-01T11:30"],
      ["entry", "ezpass|entry|NYSTA|15|", "2026-06-01T10:00"],
    ]);
    expect(checkpointsOf({ ...line, kind: "account_payment" })).toEqual([]);
  });
  it("says a printed time is two instants in the autumn's repeated hour and none in the spring's skipped hour", () => {
    expect(instantsOf("2026-06-01T12:00", CHICAGO)).toEqual([Date.UTC(2026, 5, 1, 17)]);
    expect(instantsOf("2026-11-01T01:30", CHICAGO)).toEqual([Date.UTC(2026, 10, 1, 6, 30), Date.UTC(2026, 10, 1, 7, 30)]);
    expect(instantsOf("2026-03-08T02:30", CHICAGO)).toEqual([]);
  });
});

describe("learnPlaza", () => {
  it("places the plaza where the known trucks meet, in the zone the dataset gives there, with the clock offset they measured", () => {
    const r = learnPlaza([1, 2, 3, 4, 5].map((d) => sample(d)), inKansas);
    expect(r.outcome).toBe("placed");
    if (r.outcome !== "placed") return;
    expect(distanceM(r, PLAZA)).toBeLessThan(50);
    expect(r.zone).toBe(CHICAGO);
    expect(r.offsetS).toBe(40);
    expect(r.sampleCount).toBe(5);
    expect(r.dayCount).toBe(5);
    // Every other reading of the clock was tried, and none put the trucks together.
    const others = r.readings.filter((x) => !x.zones.includes(CHICAGO));
    expect(others.length).toBeGreaterThanOrEqual(3);
    for (const o of others) expect(o.kept).toBeLessThan(3);
  });

  it("does not take the home yard an hour earlier for a second plaza: a toll is paid moving", () => {
    // Every truck sits at the yard until 30 minutes before the toll, so the Eastern reading (an hour
    // early) finds them all together, parked — the 13-in-60 refusal measured on 11-19.
    const yard = { lat: PLAZA.lat + 0.3, lon: PLAZA.lon + 0.2 };
    const tracks = [1, 2, 3, 4].map((d) => {
      const t = sample(d);
      const pass = Date.UTC(2026, 5, d, 14, d) + 40_000;
      const parked = Array.from({ length: 280 }, (_, i) => ({ ms: pass - 5 * 3600_000 + i * 60_000, ...yard }));
      t.fixes = [...parked, ...t.fixes.filter((f) => f.ms >= pass - 25 * MIN)];
      return t;
    });
    const r = learnPlaza(tracks, inKansas);
    expect(r).toMatchObject({ outcome: "placed", zone: CHICAGO });
    const eastern = r.readings.find((x) => x.zones.includes("America/New_York"))!;
    expect(eastern.kept).toBe(0);
  });

  it("finds the gantry, not the yard the trucks all stop at ten minutes later", () => {
    // Speeds differ by day (20–30 m/s), so the yard 15 km north is reached at different minutes;
    // there they bunch tighter than anywhere — the 7-of-56 drift measured on 11-19.
    const yardNorthM = 15_000;
    const tracks = [1, 2, 3, 4, 5, 6].map((d) => {
      const t = sample(d, "ktag:1", { heading: 0 });
      const v = 20 + d * 2;
      const pass = Date.UTC(2026, 5, d, 14, d) + 40_000;
      t.fixes = Array.from({ length: 3600 }, (_, k) => {
        const s = (k - 1800) * 10;
        const m = Math.min(v * s, yardNorthM);
        return { ms: pass + s * 1000, lat: PLAZA.lat + m / 111_320, lon: PLAZA.lon };
      });
      return t;
    });
    const r = learnPlaza(tracks, inKansas);
    expect(r.outcome).toBe("placed");
    if (r.outcome !== "placed") return;
    // On one road in one direction the gantry is a point within a printed minute of the clock, and the
    // offset is measured from that point (the pair an observation reads); never the yard 15 km on.
    expect(Math.abs(r.offsetS)).toBeLessThanOrEqual(60);
    expect(distanceM(r, PLAZA)).toBeLessThan(2_000);
    expect(distanceM(r, { lat: PLAZA.lat + yardNorthM / 111_320, lon: PLAZA.lon })).toBeGreaterThan(10_000);
  });

  it("does not take a yard in another zone, where the trucks park an hour after the toll, for a second reading", () => {
    // The yard lies across a zone line (here: anything north of the plaza reads Mountain), so the
    // Mountain reading (an hour late) finds every truck there, parked, in a zone that agrees with it.
    // Only the moving check turns it away; without it, two readings place the plaza and it is refused.
    const yard = { lat: PLAZA.lat + 0.3, lon: PLAZA.lon };
    const tracks = [1, 2, 3, 4].map((d) => {
      const t = sample(d);
      const pass = Date.UTC(2026, 5, d, 14, d) + 40_000;
      // A parked gateway's fixes wander a few metres (deterministic here), so its "closest" fix falls at
      // any moment of the window, not at its edge — the case only the moving check catches.
      const parked = Array.from({ length: 280 }, (_, i) => ({ ms: pass + 30 * MIN + i * 60_000, lat: yard.lat + (((i * 37) % 11) - 5) * 1e-5, lon: yard.lon + (((i * 53) % 13) - 6) * 1e-5 }));
      t.fixes = [...t.fixes.filter((f) => f.ms <= pass + 25 * MIN), ...parked];
      return t;
    });
    const zoned = (lat: number) => (lat > PLAZA.lat + 0.1 ? "America/Denver" : CHICAGO);
    expect(learnPlaza(tracks, zoned)).toMatchObject({ outcome: "placed", zone: CHICAGO });
  });

  it("does not count a truck still on its way to the plaza when the search window closes", () => {
    const tracks = [1, 2, 3].map((d) => sample(d));
    // Day 4's truck passes 16 minutes after the printed time: at the window's edge it is 1.7 km out.
    const late = sample(4, "ktag:1", { printedMs: Date.UTC(2026, 5, 4, 14, 4) + 40_000 });
    late.fixes = track(Date.UTC(2026, 5, 4, 14, 4) + 40_000 + 16 * MIN, 0);
    const r = learnPlaza([...tracks, late], inKansas);
    expect(r.outcome).toBe("placed");
    expect(r.samples[3]!.use).toBe("no_fix");
  });

  it("does not place a plaza from a zone the dataset contradicts", () => {
    const r = learnPlaza([1, 2, 3].map((d) => sample(d)), () => "America/New_York");
    expect(r).toMatchObject({ outcome: "not_placed", reason: expect.stringContaining("time zone at that place does not read") });
  });

  it("does not take the place the same trucks were an hour earlier on their lane for the plaza (measured: 17 of 60)", () => {
    // Every truck runs the lane north at the same speed, so an hour early they all meet 100 km south —
    // still in Kansas. Only the Central reading is read the same way by the zone where its trucks meet.
    const r = learnPlaza([1, 2, 3, 4, 5].map((d) => sample(d, "ktag:1", { heading: 0 })), inKansas);
    expect(r).toMatchObject({ outcome: "placed", zone: CHICAGO });
    if (r.outcome === "placed") expect(distanceM(r, PLAZA)).toBeLessThan(3_000);
    // The Eastern reading met too (up the road), and was turned away by the zone there.
    expect(r.readings.find((x) => x.zones.includes("America/New_York"))).toMatchObject({ zoneAtPoint: CHICAGO });
  });

  it("leaves out every sample of a tag the other tags' plaza disputes (the stale-list case, 604 → 842)", () => {
    const good = [1, 2, 3, 4].map((d) => sample(d, d % 2 ? "ktag:A" : "ktag:C"));
    // Tag B's history names a truck that was 40 km away each time.
    const stale = [5, 6].map((d) => sample(d, "ktag:B", { through: { lat: PLAZA.lat + 0.36, lon: PLAZA.lon } }));
    const r = learnPlaza([...good, ...stale], inKansas);
    expect(r.outcome).toBe("placed");
    expect(r.samples.filter((s) => s.tagKey === "ktag:B").map((s) => s.use)).toEqual(["tag_disputed", "tag_disputed"]);
    if (r.outcome === "placed") expect(distanceM(r, PLAZA)).toBeLessThan(50);
  });

  it("leaves out one stray sample of a single tag, and says so", () => {
    const tracks = [1, 2, 3, 4, 5].map((d) => sample(d));
    tracks.push(sample(6, "ktag:1", { through: { lat: PLAZA.lat + 0.2, lon: PLAZA.lon } }));
    const r = learnPlaza(tracks, inKansas);
    expect(r.outcome).toBe("placed");
    expect(r.samples.map((s) => s.use)).toEqual(["used", "used", "used", "used", "used", "too_far"]);
  });

  it("does not let three that meet outvote five that do not", () => {
    const tracks = [1, 2, 3].map((d) => sample(d));
    for (const d of [4, 5, 6, 7, 8]) tracks.push(sample(d, "ktag:1", { through: { lat: PLAZA.lat + d * 0.1, lon: PLAZA.lon - d * 0.1 } }));
    const r = learnPlaza(tracks, inKansas);
    expect(r.outcome).toBe("not_placed");
  });

  it("refuses with the count when there are too few known tolls, or all on one day", () => {
    expect(learnPlaza([sample(1), sample(2)], inKansas)).toMatchObject({ outcome: "not_placed", reason: expect.stringContaining("2 known tolls") });
    const oneDay = [0, 1, 2].map((i) => sample(3, "ktag:1", { printedMs: Date.UTC(2026, 5, 3, 14 + i * 3) + 40_000 }));
    oneDay.forEach((t, i) => (t.sample.lineId = `same-day-${i}`));
    expect(learnPlaza(oneDay, inKansas)).toMatchObject({ outcome: "not_placed", reason: expect.stringContaining("on 1 day") });
  });

  it("does not learn from a time printed in the autumn's repeated hour", () => {
    const tracks = [1, 2, 3].map((d) => sample(d));
    const amb = sample(9);
    amb.sample.local = "2026-11-01T01:30";
    const r = learnPlaza([...tracks, amb], inKansas);
    expect(r.outcome).toBe("placed");
    expect(r.samples[3]!.use).toBe("clock_ambiguous");
  });
});

describe("pickSamples", () => {
  const k = (lineId: string, day: number, tag: string): KnownToll => ({ lineId, role: "exit", local: `2026-06-${pad(day)}T10:00`, tagKey: tag, vehicleId: "v", samsaraVehicleId: "s" });
  it("takes a new day before a second toll on any day, and every tag before a second of one", () => {
    const known = [k("a", 1, "T1"), k("b", 1, "T1"), k("c", 1, "T2"), k("d", 2, "T1"), k("e", 3, "T2")];
    // a (T1, day 1); b and c share day 1; d is T1's second; e is T2 on a new day; then round two: d.
    expect(pickSamples(known, 3).map((x) => x.lineId)).toEqual(["a", "e", "d"]);
  });
  it("never takes more than the cap", () => {
    const many = Array.from({ length: 30 }, (_, i) => k(`l${pad(i)}`, (i % 20) + 1, `T${i % 4}`));
    expect(pickSamples(many)).toHaveLength(PLAZA_SAMPLE_CAP);
  });
});

describe("observation", () => {
  it("centres the window on the plaza's own offset, ± its spread bounded to 1.5–5 minutes", () => {
    expect(plazaWindow(1_000_000, { offsetS: 40, offsetSpreadS: 10 })).toEqual({ atMs: 1_040_000, halfMs: OBSERVE_MIN_HALF_MS });
    expect(plazaWindow(0, { offsetS: -150, offsetSpreadS: 900 })).toEqual({ atMs: -150_000, halfMs: OBSERVE_MAX_HALF_MS });
    expect(plazaWindow(0, { offsetS: 0, offsetSpreadS: 200 }).halfMs).toBe(200_000);
  });
  it("puts checkpoints close in time in one fetch, oldest first, and no window longer than the limit", () => {
    const due = [5, 0, 6, 40].map((m) => ({ atMs: m * MIN, halfMs: 2 * MIN }));
    const w = planWindows(due, 15 * MIN);
    expect(w.map((x) => [x.startMs / MIN, x.endMs / MIN, x.members.length])).toEqual([
      [-2, 8, 3],
      [38, 42, 1],
    ]);
  });
  it("records every asset within 10 km with how close it came, and every asset that reported at all", () => {
    const at = Date.UTC(2026, 5, 1, 14);
    const tracks = [
      { samsaraId: "near", kind: "vehicle" as const, fixes: track(at + 30_000, 90) },
      { samsaraId: "far", kind: "vehicle" as const, fixes: track(at, 90, { lat: PLAZA.lat + 1, lon: PLAZA.lon }) },
      { samsaraId: "silent", kind: "trailer" as const, fixes: [] },
    ];
    const o = observe(PLAZA, { atMs: at, halfMs: 2 * MIN }, tracks);
    expect(o.reporting).toEqual(["far", "near"]);
    expect(o.nearby).toHaveLength(1);
    expect(o.nearby[0]).toMatchObject({ samsaraId: "near", kind: "vehicle", offsetS: 30 });
    expect(o.nearby[0]!.distanceM).toBeLessThan(5);
  });
  it("reads Samsara's gps records and drops a 0,0 fix", () => {
    const f = fixesOfGps({ gps: [{ time: "2026-06-01T00:00:10Z", latitude: 1, longitude: 2 }, { time: "2026-06-01T00:00:00Z", latitude: 0, longitude: 0 }, { time: "x", latitude: 1, longitude: 1 }] });
    expect(f).toEqual([{ ms: Date.UTC(2026, 5, 1, 0, 0, 10), lat: 1, lon: 2 }]);
  });
});

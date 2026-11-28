import { describe, expect, it } from "vitest";
import {
  loadAtInstant,
  loadSpanOf,
  offRouteSentence,
  offRouteVerdict,
  offRouteWindow,
  type OffRouteView,
  type TimedPoint,
} from "./offRouteView.js";

/**
 * Synthetic geometry, on purpose: the repository is public and a real truck's GPS trace is a driver's
 * movements. The real-data check — our "left" within 15 min of Samsara's alert on 20 of 28 incidents —
 * is recorded in OUT-OF-ROUTE-MAP-ANALYSIS §9, not committed.
 *
 * The planned line runs due east along latitude 40; one degree of latitude is ~69 mi, so a fix at
 * 40 + m/69 is m miles off it.
 */
const T0 = Date.parse("2026-11-20T12:00:00.000Z");
const line = Array.from({ length: 41 }, (_, i) => ({ lat: 40, lng: -90 + i * 0.05 }));
const off = (m: number) => 40 + m / 69;
/** One fix a minute: `miles[i]` off the line, moving east. */
const trail = (miles: number[]): TimedPoint[] =>
  miles.map((m, i) => ({ lat: off(m), lng: -90 + i * 0.01, time: new Date(T0 + i * 60_000).toISOString() }));
const minute = (i: number) => new Date(T0 + i * 60_000).toISOString();

describe("offRouteVerdict", () => {
  it("finds where the truck left, how far it went, and when it was back", () => {
    const v = offRouteVerdict(trail([0, 1, 7, 12, 9, 3, 0, 0]), [line], 6, { stillActive: false });
    expect(v).toMatchObject({ state: "back", left: { at: minute(2) }, furthest: { at: minute(3), miles: 12 }, back: { at: minute(5) } });
  });

  it("is back only once it stays back — a second wander moves the moment", () => {
    const v = offRouteVerdict(trail([0, 8, 2, 9, 1, 0]), [line], 6, { stillActive: false });
    expect([v?.left?.at, v?.back?.at]).toEqual([minute(1), minute(4)]);
  });

  it("says still off while Samsara has it open, and closed-while-off once Samsara closed it", () => {
    const miles = [0, 7, 20, 30];
    expect(offRouteVerdict(trail(miles), [line], 6, { stillActive: true })).toMatchObject({ state: "still_off", lastMiles: 30, back: null });
    expect(offRouteVerdict(trail(miles), [line], 6, { stillActive: false })?.state).toBe("closed_while_off");
  });

  it("says never off when the truck stayed within the threshold of our line", () => {
    expect(offRouteVerdict(trail([0, 2, 5.9, 1]), [line], 6, { stillActive: false })).toMatchObject({ state: "never_off", left: null, furthest: null });
  });

  it("measures to the nearer of two lines — the way to the pickup counts as on route", () => {
    const toPickup = Array.from({ length: 21 }, (_, i) => ({ lat: off(10), lng: -90 + i * 0.05 }));
    expect(offRouteVerdict(trail([10, 10, 10]), [line, toPickup], 6, { stillActive: false })?.state).toBe("never_off");
  });

  it("judges nothing without a line or with a single fix", () => {
    expect(offRouteVerdict(trail([0, 9]), [], 6, { stillActive: false })).toBeNull();
    expect(offRouteVerdict(trail([9]), [line], 6, { stillActive: false })).toBeNull();
  });

  it("reads one fix a minute, so a 6-second trail is judged on the same moments", () => {
    const dense: TimedPoint[] = [];
    for (let s = 0; s <= 300; s += 6) dense.push({ lat: off(s >= 120 && s < 240 ? 9 : 0), lng: -90 + s * 0.0001, time: new Date(T0 + s * 1000).toISOString() });
    expect(offRouteVerdict(dense, [line], 6, { stillActive: false })).toMatchObject({ left: { at: minute(2) }, back: { at: minute(4) } });
  });
});

describe("loadSpanOf and loadAtInstant", () => {
  const stop = (seq: number, over: Partial<Parameters<typeof loadSpanOf>[1][number]> = {}) => ({
    seq, actualArrivalAt: null, actualDepartureAt: null, appointmentStart: null, appointmentEnd: null, completedAt: null, ...over,
  });
  const H = 3_600_000;

  it("spans a load from its first stop's arrival to its last stop's departure, falling back to the appointments", () => {
    const span = loadSpanOf("L1", [stop(2, { appointmentEnd: "2026-11-21T10:00:00Z" }), stop(1, { actualDepartureAt: "2026-11-20T08:00:00Z" })]);
    expect(span).toEqual({ loadId: "L1", startMs: Date.parse("2026-11-20T08:00:00Z"), endMs: Date.parse("2026-11-21T10:00:00Z") });
    expect(loadSpanOf("L2", [stop(1, { appointmentStart: "2026-11-20T08:00:00Z" }), stop(2)]).endMs).toBeNull();
  });

  it("picks the load covering the moment, within an hour either side, the latest-started of two", () => {
    const spans = [
      { loadId: "A", startMs: T0 - 10 * H, endMs: T0 + 0.5 * H },
      { loadId: "B", startMs: T0 - 0.5 * H, endMs: T0 + 10 * H },
    ];
    expect(loadAtInstant(spans, T0, T0 + 20 * H)).toEqual({ loadId: "B", relation: "on_load" });
    expect(loadAtInstant([{ loadId: "C", startMs: T0 - 5 * H, endMs: T0 - 0.9 * H }], T0, T0)).toEqual({ loadId: "C", relation: "on_load" });
    // Half an hour before its first stop is still on it — at the shipper's gate, not on the way to it.
    expect(loadAtInstant([{ loadId: "D", startMs: T0 + 0.5 * H, endMs: T0 + 9 * H }], T0, T0)).toEqual({ loadId: "D", relation: "on_load" });
  });

  it("treats a load with no end yet as open, and otherwise falls to the next load within 48 hours", () => {
    expect(loadAtInstant([{ loadId: "O", startMs: T0 - 30 * H, endMs: null }], T0, T0 + H)).toEqual({ loadId: "O", relation: "on_load" });
    const spans = [{ loadId: "N2", startMs: T0 + 40 * H, endMs: null }, { loadId: "N1", startMs: T0 + 20 * H, endMs: null }, { loadId: "FAR", startMs: T0 + 49 * H, endMs: null }];
    expect(loadAtInstant(spans, T0, T0)).toEqual({ loadId: "N1", relation: "to_pickup" });
    expect(loadAtInstant([{ loadId: "FAR", startMs: T0 + 49 * H, endMs: null }], T0, T0)).toBeNull();
  });
});

describe("offRouteWindow", () => {
  it("runs from 45 minutes before the alert to 20 after the close, never past now", () => {
    const w = offRouteWindow("2026-11-20T12:00:00.000Z", "2026-11-20T14:00:00.000Z", Date.parse("2026-11-27T00:00:00Z"));
    expect([new Date(w.startMs).toISOString(), new Date(w.endMs).toISOString(), w.capped]).toEqual(["2026-11-20T11:15:00.000Z", "2026-11-20T14:20:00.000Z", false]);
    const open = offRouteWindow("2026-11-20T12:00:00.000Z", null, Date.parse("2026-11-20T13:00:00Z"));
    expect(new Date(open.endMs).toISOString()).toBe("2026-11-20T13:00:00.000Z");
  });

  it("draws 72 hours at most and says it cut", () => {
    const w = offRouteWindow("2026-11-01T00:00:00.000Z", null, Date.parse("2026-11-27T00:00:00Z"));
    expect([w.endMs - w.startMs, w.capped]).toEqual([72 * 3_600_000, true]);
  });
});

describe("offRouteSentence", () => {
  const t = (iso: string) => iso.slice(11, 16);
  const base: Pick<OffRouteView, "planned" | "samsara" | "window" | "thresholdMiles"> = {
    planned: { loadRef: "0138883", relation: "on_load", route: [], toPickup: null, stops: [] },
    samsara: { happenedAt: minute(2), endedAt: "2026-11-20T14:00:00.000Z", stillActive: false },
    window: { start: minute(0), end: minute(60), capped: false },
    thresholdMiles: 6,
  };
  const at = (i: number) => ({ lat: 40, lng: -90, at: minute(i) });

  it("says where it left, how far, and when it came back", () => {
    const verdict = { state: "back" as const, left: at(2), furthest: { ...at(3), miles: 37.6 }, back: at(5), lastMiles: 0, lastAt: minute(7) };
    expect(offRouteSentence({ ...base, verdict }, t)).toBe("Left the planned route at 12:02, at most 38 mi off, back on it at 12:05.");
  });

  it("says Samsara closed it while the truck was still off, measured at the last fix — no guess at why", () => {
    const verdict = { state: "closed_while_off" as const, left: at(2), furthest: { ...at(3), miles: 311 }, back: null, lastMiles: 290, lastAt: minute(30) };
    expect(offRouteSentence({ ...base, verdict }, t)).toBe(
      "Left the planned route at 12:02, at most 311 mi off. Samsara closed this at 14:00, but at the last fix drawn, 12:30, the truck was still 290 mi from the planned route.",
    );
  });

  it("says there is nothing to compare with when the truck had no load", () => {
    expect(offRouteSentence({ ...base, planned: null, verdict: null }, t)).toMatch(/^There was no load on this truck/);
  });

  it("says when only the first 72 hours are drawn", () => {
    const verdict = { state: "still_off" as const, left: at(2), furthest: { ...at(3), miles: 40 }, back: null, lastMiles: 40, lastAt: minute(30) };
    expect(offRouteSentence({ ...base, verdict, window: { ...base.window, capped: true } }, t)).toContain("(only the first 72 hours are drawn)");
  });
});

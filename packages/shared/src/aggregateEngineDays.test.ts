import { describe, it, expect } from "vitest";
import { aggregateEngineDays, type EngineSample } from "./idleSessions.js";

const H = 3600;
// State-change samples: sample[i].state holds until sample[i+1].t.
const at = (y: number, m: number, d: number, hh: number, mm = 0) => Date.UTC(y, m - 1, d, hh, mm);

describe("aggregateEngineDays", () => {
  it("splits a single day into drive (On) / idle (Idle) / off (Off) with coverage = their sum", () => {
    const samples: EngineSample[] = [
      { t: at(2026, 3, 10, 8), state: "On" },   // 08–10 driving (2h)
      { t: at(2026, 3, 10, 10), state: "Idle" }, // 10–11 idling (1h)
      { t: at(2026, 3, 10, 11), state: "Off" },  // 11–12 off (1h)
      { t: at(2026, 3, 10, 12), state: "On" },   // 12–13 driving (1h)
      { t: at(2026, 3, 10, 13), state: "Off" },  // end marker
    ];
    const days = aggregateEngineDays(samples);
    expect(days).toEqual([
      { day: "2026-03-10", driveSec: 3 * H, idleSec: 1 * H, offSec: 1 * H, coverageSec: 5 * H, tzOffsetMinutes: 0 },
    ]);
  });

  it("splits an interval that crosses midnight at the day boundary (no time lost or double-counted)", () => {
    const samples: EngineSample[] = [
      { t: at(2026, 3, 10, 22), state: "Idle" }, // 22:00 → 02:00 next day = 4h idle, split 2h/2h
      { t: at(2026, 3, 11, 2), state: "On" },     // 02–03 driving next day (1h)
      { t: at(2026, 3, 11, 3), state: "Off" },
    ];
    const days = aggregateEngineDays(samples);
    expect(days).toEqual([
      { day: "2026-03-10", driveSec: 0, idleSec: 2 * H, offSec: 0, coverageSec: 2 * H, tzOffsetMinutes: 0 },
      { day: "2026-03-11", driveSec: 1 * H, idleSec: 2 * H, offSec: 0, coverageSec: 3 * H, tzOffsetMinutes: 0 },
    ]);
  });

  it("attributes a multi-day Off interval (weekend park) to every day it spans", () => {
    const samples: EngineSample[] = [
      { t: at(2026, 3, 10, 18), state: "Off" }, // 10th 18:00 → 13th 06:00
      { t: at(2026, 3, 13, 6), state: "On" },
    ];
    const days = aggregateEngineDays(samples);
    expect(days).toEqual([
      { day: "2026-03-10", driveSec: 0, idleSec: 0, offSec: 6 * H, coverageSec: 6 * H, tzOffsetMinutes: 0 },
      { day: "2026-03-11", driveSec: 0, idleSec: 0, offSec: 24 * H, coverageSec: 24 * H, tzOffsetMinutes: 0 },
      { day: "2026-03-12", driveSec: 0, idleSec: 0, offSec: 24 * H, coverageSec: 24 * H, tzOffsetMinutes: 0 },
      { day: "2026-03-13", driveSec: 0, idleSec: 0, offSec: 6 * H, coverageSec: 6 * H, tzOffsetMinutes: 0 },
    ]);
  });

  it("shifts the day boundary by tzOffsetMinutes (US Central -360)", () => {
    // 04:00–08:00 UTC = 22:00 (prev day) – 02:00 US Central → 2h on each local day.
    const samples: EngineSample[] = [
      { t: at(2026, 3, 10, 4), state: "Idle" },
      { t: at(2026, 3, 10, 8), state: "Off" },
    ];
    expect(aggregateEngineDays(samples, { tzOffsetMinutes: -360 })).toEqual([
      { day: "2026-03-09", driveSec: 0, idleSec: 2 * H, offSec: 0, coverageSec: 2 * H, tzOffsetMinutes: -360 },
      { day: "2026-03-10", driveSec: 0, idleSec: 2 * H, offSec: 0, coverageSec: 2 * H, tzOffsetMinutes: -360 },
    ]);
    // Same data in UTC lands entirely on the 10th.
    expect(aggregateEngineDays(samples)).toEqual([
      { day: "2026-03-10", driveSec: 0, idleSec: 4 * H, offSec: 0, coverageSec: 4 * H, tzOffsetMinutes: 0 },
    ]);
  });

  it("cuts the day on the zone's REAL local midnight (DST-correct) with an IANA tz", () => {
    // Winter (CST, -360): local midnight of 01-10 is 06:00Z. 04:00–08:00Z splits 2h/2h across 01-09 / 01-10.
    const winter: EngineSample[] = [
      { t: at(2026, 1, 10, 4), state: "Idle" },
      { t: at(2026, 1, 10, 8), state: "Off" },
    ];
    expect(aggregateEngineDays(winter, { tz: "America/Chicago" })).toEqual([
      { day: "2026-01-09", driveSec: 0, idleSec: 2 * H, offSec: 0, coverageSec: 2 * H, tzOffsetMinutes: -360 },
      { day: "2026-01-10", driveSec: 0, idleSec: 2 * H, offSec: 0, coverageSec: 2 * H, tzOffsetMinutes: -360 },
    ]);
    // Summer (CDT, -300): SAME zone, local midnight of 07-10 is 05:00Z. 03:00–07:00Z splits 2h/2h across
    // 07-09 / 07-10 — the fixed-offset path can't do this; the offset recorded flips to -300.
    const summer: EngineSample[] = [
      { t: at(2026, 7, 10, 3), state: "Idle" },
      { t: at(2026, 7, 10, 7), state: "Off" },
    ];
    expect(aggregateEngineDays(summer, { tz: "America/Chicago" })).toEqual([
      { day: "2026-07-09", driveSec: 0, idleSec: 2 * H, offSec: 0, coverageSec: 2 * H, tzOffsetMinutes: -300 },
      { day: "2026-07-10", driveSec: 0, idleSec: 2 * H, offSec: 0, coverageSec: 2 * H, tzOffsetMinutes: -300 },
    ]);
  });

  it("coverage reflects only observed time — a partial day is < 86400s", () => {
    const [d] = aggregateEngineDays([
      { t: at(2026, 3, 10, 9), state: "Idle" },
      { t: at(2026, 3, 10, 12), state: "Off" }, // only 3h observed
    ]);
    expect(d!.coverageSec).toBe(3 * H);
    expect(d!.coverageSec).toBeLessThan(86_400);
  });

  it("returns [] for fewer than two samples, and ignores non-positive intervals", () => {
    expect(aggregateEngineDays([])).toEqual([]);
    expect(aggregateEngineDays([{ t: at(2026, 3, 10, 9), state: "Idle" }])).toEqual([]);
    // Duplicate timestamp → zero-length interval skipped; only the real 1h idle counts.
    const days = aggregateEngineDays([
      { t: at(2026, 3, 10, 9), state: "On" },
      { t: at(2026, 3, 10, 9), state: "Idle" },
      { t: at(2026, 3, 10, 10), state: "Off" },
    ]);
    expect(days).toEqual([{ day: "2026-03-10", driveSec: 0, idleSec: 1 * H, offSec: 0, coverageSec: 1 * H, tzOffsetMinutes: 0 }]);
  });
});

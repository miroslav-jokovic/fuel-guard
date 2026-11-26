import { describe, expect, it } from "vitest";
import {
  alertRuleDefault,
  decideOpen,
  FIXED_RULES,
  looksFixed,
  resolveFollowUpRules,
  warnedAfterContact,
  warningCounts,
  warningSeverity,
  type DeskWarning,
  type FollowUpRule,
} from "./followUpRules.js";

const NOW = Date.parse("2026-11-26T12:00:00Z");
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const rule = (key: string): FollowUpRule => {
  const r = FIXED_RULES.find((x) => x.key === key);
  if (!r) throw new Error(key);
  return { ...r };
};
const warning = (over: Partial<DeskWarning> & { happenedAt: string }): DeskWarning => ({
  kind: "atis",
  subjectKind: "trailer",
  vehicleSamsaraId: null,
  trailerSamsaraId: "T1",
  driverSamsaraId: null,
  unitName: "R535973",
  driverName: null,
  label: "ATIS lamp on",
  endedAt: null,
  stillActive: false,
  ...over,
});

describe("alertRuleDefault — derived from Samsara trigger ids", () => {
  const cfg = (triggerTypeIds: number[], isEnabled = true) => ({ id: "c1", name: "X", isEnabled, triggerTypeIds });

  it("keeps idling, temperature, towing zone and duplicated safety alerts off", () => {
    for (const id of [1019, 1003, 5016, 5033, 5039, 5005]) expect(alertRuleDefault(cfg([id])).enabled).toBe(false);
  });

  it("turns battery, dashcam, out of route, speed and low fuel on", () => {
    for (const id of [1007, 1012, 1027, 1000, 1005]) expect(alertRuleDefault(cfg([id])).enabled).toBe(true);
  });

  it("a two-condition battery alert (battery + engine off) is on although engine-off alone is not", () => {
    // The account's three battery configurations are 1007 + 1021/1022 (measured 2026-11-26).
    expect(alertRuleDefault(cfg([1007, 1022])).enabled).toBe(true);
    expect(alertRuleDefault(cfg([1013, 1022])).enabled).toBe(false); // "potential towing": movement + engine off
  });

  it("is off when Samsara reports the configuration disabled", () => {
    expect(alertRuleDefault(cfg([1007], false)).enabled).toBe(false);
  });

  it("puts speed and low fuel on the driver, out of route in route, panic urgent once", () => {
    expect(alertRuleDefault(cfg([1000])).subject).toBe("driver");
    expect(alertRuleDefault(cfg([1000])).category).toBe("safety");
    expect(alertRuleDefault(cfg([1005])).subject).toBe("driver");
    expect(alertRuleDefault(cfg([1027])).category).toBe("route");
    const panic = alertRuleDefault(cfg([1034]));
    expect([panic.severity, panic.thresholdCount]).toEqual(["urgent", 1]);
    expect(alertRuleDefault(cfg([1012])).thresholdCount).toBe(1);
    expect(alertRuleDefault(cfg([1007])).thresholdCount).toBe(3);
  });
});

describe("resolveFollowUpRules", () => {
  it("applies an admin override and keeps every other default", () => {
    const rules = resolveFollowUpRules([], [
      { ruleKey: "atis", enabled: true, thresholdCount: 2, windowDays: 3, minActiveHours: 0, category: "maintenance", severity: "high" },
    ]);
    expect(rules.find((r) => r.key === "atis")).toMatchObject({ thresholdCount: 2, windowDays: 3, severity: "high", minDurationMinutes: 10 });
    expect(rules.find((r) => r.key === "safety_other")?.thresholdCount).toBe(3);
  });

  it("drops an override for a configuration Samsara no longer lists", () => {
    const rules = resolveFollowUpRules([], [
      { ruleKey: "alert:gone", enabled: true, thresholdCount: 1, windowDays: 1, minActiveHours: 0, category: "maintenance", severity: "normal" },
    ]);
    expect(rules.some((r) => r.key === "alert:gone")).toBe(false);
  });
});

describe("warningCounts", () => {
  it("ignores an ATIS episode shorter than ten minutes", () => {
    const w = warning({ happenedAt: iso(NOW - 2 * H), endedAt: iso(NOW - 2 * H + 5 * 60_000) });
    expect(warningCounts(rule("atis"), w, NOW)).toBe(false);
  });

  it("counts an ATIS lamp still on after ten minutes", () => {
    expect(warningCounts(rule("atis"), warning({ happenedAt: iso(NOW - 11 * 60_000), stillActive: true }), NOW)).toBe(true);
  });

  it("counts a defect only once it has stayed open two days", () => {
    const r = rule("dvir_open");
    expect(warningCounts(r, warning({ happenedAt: iso(NOW - 47 * H), stillActive: true }), NOW)).toBe(false);
    expect(warningCounts(r, warning({ happenedAt: iso(NOW - 49 * H), stillActive: true }), NOW)).toBe(true);
    expect(warningCounts(r, warning({ happenedAt: iso(NOW - 99 * H), endedAt: iso(NOW - H) }), NOW)).toBe(false);
  });
});

describe("decideOpen — the Nth time", () => {
  const ep = (hoursAgo: number) => warning({ happenedAt: iso(NOW - hoursAgo * H), endedAt: iso(NOW - hoursAgo * H + 30 * 60_000) });

  it("opens on the third episode inside seven days", () => {
    const d = decideOpen(rule("atis"), [ep(100), ep(50), ep(2)], null, NOW);
    expect(d).toMatchObject({ open: true, count: 3 });
  });

  it("does not open on two", () => {
    expect(decideOpen(rule("atis"), [ep(50), ep(2)], null, NOW).open).toBe(false);
  });

  it("does not open when the three are spread over more than seven days", () => {
    expect(decideOpen(rule("atis"), [ep(200), ep(100), ep(2)], null, NOW).open).toBe(false);
  });

  it("counts again from zero after the last follow-up was closed", () => {
    const closed = iso(NOW - 60 * H);
    expect(decideOpen(rule("atis"), [ep(100), ep(50), ep(2)], closed, NOW).open).toBe(false);
  });

  it("does not open from a burst that ended more than a window ago", () => {
    expect(decideOpen(rule("atis"), [ep(300), ep(299), ep(298)], null, NOW).open).toBe(false);
  });

  it("never opens for a disabled rule", () => {
    expect(decideOpen({ ...rule("atis"), enabled: false }, [ep(3), ep(2), ep(1)], null, NOW).open).toBe(false);
  });

  it("opens a serious safety event the first time", () => {
    const w = warning({ kind: "safety_serious", subjectKind: "driver", driverSamsaraId: "D1", happenedAt: iso(NOW - H), label: "RanRedLight" });
    expect(decideOpen(rule("safety_serious"), [w], null, NOW).open).toBe(true);
  });
});

describe("severity and derived states", () => {
  it("raises a line with a crash to urgent and a four-hour ATIS episode to high", () => {
    const crash = warning({ kind: "safety_serious", happenedAt: iso(NOW - H), label: "Crash, Braking" });
    expect(warningSeverity(rule("safety_serious"), [crash], NOW)).toBe("urgent");
    const long = warning({ happenedAt: iso(NOW - 5 * H), stillActive: true });
    expect(warningSeverity(rule("atis"), [long], NOW)).toBe("high");
    expect(warningSeverity(rule("atis"), [warning({ happenedAt: iso(NOW - H), endedAt: iso(NOW - H / 2) })], NOW)).toBe("normal");
  });

  it("looks fixed only when nothing is active and a day has passed", () => {
    expect(looksFixed(0, iso(NOW - 25 * H), NOW)).toBe(true);
    expect(looksFixed(0, iso(NOW - 23 * H), NOW)).toBe(false);
    expect(looksFixed(1, iso(NOW - 48 * H), NOW)).toBe(false);
  });

  it("warned again after the call when a warning is newer than the contact", () => {
    expect(warnedAfterContact(iso(NOW), iso(NOW - H))).toBe(true);
    expect(warnedAfterContact(iso(NOW - 2 * H), iso(NOW - H))).toBe(false);
    expect(warnedAfterContact(iso(NOW), null)).toBe(false);
  });
});

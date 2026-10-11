import { describe, it, expect } from "vitest";
import { correlateSignals } from "./cases.js";
import { RULE_IDS, SIGNAL_META, SUPPRESSED_RULE_IDS, type RuleId } from "./catalog.generated.js";
import type { RuleResult } from "./types.js";
import type { AnomalySeverity } from "../constants.js";

/**
 * CF5 (D-CF3/D-CF4, ruled 2026-10-02; Q-F10 (a) 2026-10-08): on an approved fill every rule is a NOTE
 * except the billed-vs-measured tank rise — `tank_fill_short` and `tank_chronic_short` stay Reviews.
 *
 * Asserted on the OUTCOME (`correlateSignals`), not on the numbers in catalog.yaml: a test that read the
 * weights back would pass for any weights at all. What the product promises is that no approved fill
 * can become an alert, and an alert is the only thing the fill email (`notifyForTransaction`) and the
 * bell (`fuel_alert`) send — both ask for high/critical, and only an alert is high or critical.
 */

const REVIEW_RULES: readonly RuleId[] = ["tank_fill_short", "tank_chronic_short"];
const LIVE_RULES = RULE_IDS.filter((id) => !SUPPRESSED_RULE_IDS.includes(id));
const NOTE_RULES = LIVE_RULES.filter((id) => !REVIEW_RULES.includes(id));

const fired = (ruleId: RuleId, severity: AnomalySeverity = "critical"): RuleResult => ({
  ruleId,
  fired: true,
  severity,
  message: `${ruleId} fired`,
  evidence: {},
});

describe("CF5 — approved-fill rules are notes; only the tank rise is a review", () => {
  it("covers every live rule in the catalog (no rule is left out of the checks below)", () => {
    expect(NOTE_RULES.length + REVIEW_RULES.length).toBe(LIVE_RULES.length);
    expect(NOTE_RULES.length).toBeGreaterThanOrEqual(20);
  });

  it.each(NOTE_RULES.map((id) => [id]))("%s alone is a note: no case, and recorded on the fill", (id) => {
    const c = correlateSignals([fired(id)]);
    expect(c.level).toBe("clear");
    expect(c.severity).toBeNull();
    expect(c.unscoredSignals.map((s) => s.ruleId)).toEqual([id]);
  });

  it("tank_fill_short alone still raises a Review (medium, so no email and no bell)", () => {
    const c = correlateSignals([fired("tank_fill_short", "low")]);
    expect(c.level).toBe("review");
    expect(c.severity).toBe("medium");
  });

  it("tank_chronic_short alone still raises a Review (Q-F10 (a))", () => {
    const c = correlateSignals([fired("tank_chronic_short")]);
    expect(c.level).toBe("review");
    expect(c.severity).toBe("medium");
  });

  it("every live rule firing at once, all critical, is still only a Review scoring 65", () => {
    const c = correlateSignals(LIVE_RULES.map((id) => fired(id)));
    expect(c.level).toBe("review");
    expect(c.severity).toBe("medium");
    // Both review rules are on the volume axis; the score takes the strongest per axis.
    expect(c.score).toBe(65);
    expect(c.axes).toEqual(["volume"]);
    expect(c.signals.map((s) => s.ruleId).sort()).toEqual([...REVIEW_RULES].sort());
    expect(c.unscoredSignals).toHaveLength(NOTE_RULES.length);
  });

  it("no note rule beside the tank rise lifts it to an alert", () => {
    for (const id of NOTE_RULES) {
      const c = correlateSignals([fired("tank_fill_short"), fired(id)]);
      expect([id, c.level]).toEqual([id, "review"]);
    }
  });

  it("a suppressed rule keeps its old weight, but it never reaches the correlation (rules.ts drops it)", () => {
    // reefer_fuel_diversion stays suppressed at 60. Re-enabling it at that weight would make it a
    // Review alone and, beside tank_fill_short, an alert — against Q-F10. Its catalog note says so.
    expect(SIGNAL_META.reefer_fuel_diversion.weight).toBe(60);
    expect(SUPPRESSED_RULE_IDS).toContain("reefer_fuel_diversion");
  });
});

/**
 * The 60 days to 2026-10-08 on production, replayed (read-only, measured that day). Each row is one set
 * of rules that fired together on a fill, with the level the engine gave it and how many fills had it:
 * 672 fills with something fired, 10 alerts and 18 reviews. A weight change alters only how fired
 * signals combine, never whether a rule fires, so correlating the stored sets is what a re-score
 * concludes for those fills. Expected under CF5: 0 alerts and 6 reviews, every one with tank_fill_short.
 */
type Row = [level: "clear" | "review" | "alert", fills: number, signals: [RuleId, AnomalySeverity][]];
const SIXTY_DAYS: Row[] = [
  ["clear", 505, [["odometer_mismatch", "high"]]],
  ["clear", 47, [["fuel_while_driver_home", "medium"]]],
  ["clear", 23, [["location_mismatch", "medium"]]],
  ["clear", 17, [["odometer_mismatch", "high"], ["rapid_repeat_fueling", "high"]]],
  ["clear", 10, [["mpg_sustained_decline", "medium"]]],
  ["clear", 9, [["location_mismatch", "high"]]],
  ["review", 8, [["card_multi_vehicle", "high"]]],
  ["clear", 6, [["rapid_repeat_fueling", "high"]]],
  ["clear", 5, [["fuel_while_driver_home", "medium"], ["odometer_mismatch", "high"]]],
  ["clear", 5, [["implausible_topoff", "high"], ["mpg_deviation", "high"]]],
  ["clear", 5, [["mpg_deviation", "high"]]],
  ["review", 4, [["card_multi_vehicle", "high"], ["odometer_mismatch", "high"]]],
  ["clear", 3, [["location_mismatch", "high"], ["odometer_mismatch", "high"]]],
  ["alert", 3, [["tank_fill_short", "low"], ["tank_space_exceeded", "critical"]]],
  ["review", 3, [["tank_fill_short", "low"]]],
  ["alert", 2, [["tank_space_exceeded", "critical"]]],
  ["clear", 2, [["fuel_while_driver_home", "medium"], ["location_mismatch", "medium"]]],
  ["clear", 2, [["mpg_deviation", "high"], ["mpg_sustained_decline", "medium"]]],
  ["alert", 2, [["impossible_travel", "high"], ["odometer_mismatch", "high"]]],
  ["clear", 2, [["fuel_while_driver_home", "medium"], ["odometer_mismatch", "high"], ["rapid_repeat_fueling", "high"]]],
  ["review", 2, [["impossible_travel", "high"]]],
  ["alert", 1, [["impossible_travel", "high"], ["odometer_implausible_jump", "high"], ["odometer_mismatch", "high"]]],
  ["clear", 1, [["implausible_topoff", "high"], ["mpg_deviation", "high"], ["mpg_sustained_decline", "medium"], ["odometer_mismatch", "high"]]],
  ["alert", 1, [["exceeds_tank_capacity", "critical"], ["odometer_mismatch", "high"]]],
  ["clear", 1, [["fuel_while_driver_home", "medium"], ["rapid_repeat_fueling", "high"]]],
  ["review", 1, [["exceeds_capacity_unverified", "medium"]]],
  ["clear", 1, [["mpg_deviation", "high"], ["odometer_mismatch", "high"]]],
  ["alert", 1, [["mpg_deviation", "high"], ["mpg_sustained_decline", "medium"], ["tank_space_exceeded", "critical"]]],
];

describe("CF5 — re-scoring production's 60 days", () => {
  const replay = (rows: Row[]) =>
    rows.map(([before, fills, sigs]) => ({ before, fills, sigs, after: correlateSignals(sigs.map(([id, sev]) => fired(id, sev))) }));
  const count = (rows: ReturnType<typeof replay>, pick: (r: ReturnType<typeof replay>[number]) => string) =>
    rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [pick(r)]: (acc[pick(r)] ?? 0) + r.fills }), {});

  it("the fixture is the measurement: 672 fills, 10 alerts and 18 reviews before CF5", () => {
    expect(count(replay(SIXTY_DAYS), (r) => r.before)).toEqual({ clear: 644, review: 18, alert: 10 });
  });

  it("raises 0 alerts and 6 reviews, every review carrying tank_fill_short", () => {
    const after = replay(SIXTY_DAYS);
    expect(count(after, (r) => r.after.level)).toEqual({ clear: 666, review: 6 });
    for (const r of after.filter((x) => x.after.level === "review")) {
      expect(r.after.signals.map((s) => s.ruleId)).toEqual(["tank_fill_short"]);
    }
  });

  it.each(["tank_space_exceeded", "odometer_mismatch", "card_multi_vehicle"] as RuleId[])(
    "raises no alert from %s, and no case it is the reason for",
    (id) => {
      const withRule = replay(SIXTY_DAYS).filter((r) => r.sigs.some(([s]) => s === id));
      expect(withRule.length).toBeGreaterThan(0);
      for (const r of withRule) {
        expect(r.after.level).not.toBe("alert");
        expect(r.after.signals.map((s) => s.ruleId)).not.toContain(id);
        expect(r.after.unscoredSignals.map((s) => s.ruleId)).toContain(id);
      }
    },
  );

  it("tank_fill_short alone still raises a Review on the 3 fills that had only it", () => {
    const alone = replay(SIXTY_DAYS).filter((r) => r.sigs.length === 1 && r.sigs[0]![0] === "tank_fill_short");
    expect(alone.reduce((n, r) => n + r.fills, 0)).toBe(3);
    for (const r of alone) expect(r.after.level).toBe("review");
  });
});

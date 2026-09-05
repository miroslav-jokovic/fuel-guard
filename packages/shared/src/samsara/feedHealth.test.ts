import { describe, expect, it } from "vitest";
import {
  SAMSARA_FEED_IDS,
  SAMSARA_RULED_TARGET_HOURS,
  describeSamsaraFeed,
  describeSamsaraFeeds,
  samsaraFeedSpecs,
  worstSamsaraFeed,
  type SamsaraFeedId,
  type SamsaraFeedObservation,
} from "./feedHealth.js";
import { FEED_LATE_AFTER_PASSES } from "../fuelSpend/feedFreshness.js";

const MIN = 60_000;
const HOUR = 3_600_000;
const NOW = "2026-09-05T12:00:00.000Z";

/** The intervals `apps/api/src/env.ts` actually defaults to, so the fixture is the real deployment. */
const CADENCES: Record<SamsaraFeedId, number> = {
  stats: 20 * MIN,
  telematics: 60 * MIN,
  identity: 12 * HOUR,
  driver_scores: 6 * HOUR,
  ifta: 24 * HOUR,
  odometer: 24 * HOUR,
  hos: 6 * HOUR,
  idle: 6 * HOUR,
};

const specs = (over: Partial<Record<SamsaraFeedId, number>> = {}) =>
  samsaraFeedSpecs({ ...CADENCES, ...over });
const specFor = (id: SamsaraFeedId, over: Partial<Record<SamsaraFeedId, number>> = {}) =>
  specs(over).find((s) => s.id === id)!;
const ago = (ms: number) => new Date(new Date(NOW).getTime() - ms).toISOString();
const obs = (id: SamsaraFeedId, o: Partial<SamsaraFeedObservation> = {}): SamsaraFeedObservation => ({
  id, lastSuccessAt: ago(5 * MIN), lastAttemptAt: ago(5 * MIN), lastError: null, ...o,
});

/**
 * Every feed healthy, then the named ones replaced. A partial set would leave the rest reading
 * `never` — correct, and asserted below — which is not what a sort or a scope test is about.
 */
const allObs = (over: Partial<Record<SamsaraFeedId, Partial<SamsaraFeedObservation>>> = {}) =>
  SAMSARA_FEED_IDS.map((id) => obs(id, over[id] ?? {}));

describe("the catalogue", () => {
  it("gives every feed a bound, and says which of the two kinds it is", () => {
    for (const s of specs()) {
      expect(s.targetMs, s.id).not.toBeNull();
      expect(s.label.length, s.id).toBeGreaterThan(0);
      expect(s.what.length, s.id).toBeGreaterThan(0);
    }
    const ruled = specs().filter((s) => s.targetSource === "ruling").map((s) => s.id).sort();
    expect(ruled).toEqual(["driver_scores", "identity", "ifta", "stats", "telematics"]);
  });

  it("takes the ruled bound verbatim where Q-SAM1 gave one", () => {
    for (const [id, hours] of Object.entries(SAMSARA_RULED_TARGET_HOURS)) {
      expect(specFor(id as SamsaraFeedId).targetMs, id).toBe(hours! * HOUR);
    }
    expect(specFor("stats").targetMs).toBe(HOUR);
    expect(specFor("ifta").targetMs).toBe(48 * HOUR);
  });

  it("derives the rest from the cadence they already promise, never from a number chosen here", () => {
    // The answer this repo already gave for the EFS pollers, reused rather than restated.
    expect(specFor("odometer").targetMs).toBe(24 * HOUR * FEED_LATE_AFTER_PASSES);
    expect(specFor("odometer").targetSource).toBe("cadence");
    // …and it MOVES with the setting, which is the whole point of deriving it.
    expect(specFor("odometer", { odometer: 2 * HOUR }).targetMs).toBe(2 * HOUR * FEED_LATE_AFTER_PASSES);
  });

  it("bounds nothing for a tier that is switched off", () => {
    const s = specFor("ifta", { ifta: 0 });
    expect(s.targetMs).toBeNull();
    expect(describeSamsaraFeed(s, undefined, NOW).state).toBe("disabled");
  });
});

describe("the verdict", () => {
  it("is fresh inside the bound and late outside it", () => {
    expect(describeSamsaraFeed(specFor("stats"), obs("stats", { lastSuccessAt: ago(50 * MIN) }), NOW).state).toBe("fresh");
    expect(describeSamsaraFeed(specFor("stats"), obs("stats", { lastSuccessAt: ago(70 * MIN) }), NOW).state).toBe("late");
    // Exactly at the bound is still inside it — a feed that lands on its promise has kept it.
    expect(describeSamsaraFeed(specFor("stats"), obs("stats", { lastSuccessAt: ago(60 * MIN) }), NOW).state).toBe("fresh");
  });

  it("tells never-arrived apart from being-refused, because they need different people", () => {
    const never = describeSamsaraFeed(specFor("ifta"), obs("ifta", { lastSuccessAt: null, lastAttemptAt: null }), NOW);
    expect(never.state).toBe("never");
    const refused = describeSamsaraFeed(specFor("ifta"), obs("ifta", { lastSuccessAt: null, lastAttemptAt: ago(MIN), lastError: "403" }), NOW);
    expect(refused.state).toBe("failing");
    // Alive and failing, with old data behind it — a state no "last seen" timestamp can express.
    const refusedWithHistory = describeSamsaraFeed(specFor("ifta"), obs("ifta", { lastSuccessAt: ago(2 * HOUR), lastError: "403" }), NOW);
    expect(refusedWithHistory.state).toBe("failing");
    expect(refusedWithHistory.lead).toContain("2 hours ago");
  });

  it("does not let a bare attempt stand in for a delivery", () => {
    // The discriminating case, and the one a first pass at this suite MISSED: tried, no error, and
    // nothing has ever landed. Reading the attempt stamp as a success here reports a feed as fresh
    // one minute after a run that delivered nothing at all.
    const h = describeSamsaraFeed(specFor("stats"), obs("stats", { lastSuccessAt: null, lastAttemptAt: ago(MIN), lastError: null }), NOW);
    expect(h.state).toBe("failing");
    expect(h.lastSuccessAt).toBeNull();
    expect(h.ageMinutes).toBeNull();
    expect(h.lead).toContain("nothing has arrived yet");
    expect(h.lead).not.toContain("refused");
  });

  it("reads the SUCCESS stamp, never the attempt stamp", () => {
    // A feed refused for two days still carries a fresh attempt stamp. Scoring on it would report
    // "arrived a minute ago" while nothing had arrived — the confidently-wrong answer this avoids.
    const h = describeSamsaraFeed(specFor("stats"), obs("stats", { lastSuccessAt: ago(3 * HOUR), lastAttemptAt: ago(MIN) }), NOW);
    expect(h.state).toBe("late");
    expect(h.ageMinutes).toBe(180);
  });
});

describe("only a ruled bound may page somebody (Q-SAM1's fallback)", () => {
  it("alerts on a breached ruled bound", () => {
    expect(describeSamsaraFeed(specFor("ifta"), obs("ifta", { lastSuccessAt: ago(72 * HOUR) }), NOW).alertable).toBe(true);
  });

  it("never alerts on a cadence-derived one, however far past it", () => {
    const h = describeSamsaraFeed(specFor("odometer"), obs("odometer", { lastSuccessAt: ago(30 * 24 * HOUR) }), NOW);
    expect(h.state).toBe("late");
    expect(h.needsAttention).toBe(true);
    expect(h.alertable).toBe(false);
  });

  it("never alerts on a feed that is merely fresh, or switched off", () => {
    expect(describeSamsaraFeed(specFor("stats"), obs("stats"), NOW).alertable).toBe(false);
    expect(describeSamsaraFeed(specFor("ifta", { ifta: 0 }), undefined, NOW).alertable).toBe(false);
  });
});

describe("a bound shorter than the cadence", () => {
  it("is reported as unreachable rather than paging every hour forever", () => {
    // 90-minute polling against the ruled 1-hour bound: the feed is breached the moment it succeeds.
    const h = describeSamsaraFeed(specFor("stats", { stats: 90 * MIN }), obs("stats", { lastSuccessAt: ago(75 * MIN) }), NOW);
    expect(h.targetUnreachable).toBe(true);
    expect(h.state).toBe("late");
    expect(h.alertable).toBe(false);
    expect(h.lead).toContain("cannot be met as configured");
  });

  it("does not silently move the owner's number — the bound stays what was ruled", () => {
    expect(specFor("stats", { stats: 90 * MIN }).targetMs).toBe(HOUR);
  });

  it("cannot happen to a derived bound, which is a multiple of the cadence by construction", () => {
    for (const cadence of [MIN, 90 * MIN, 24 * HOUR, 40 * 24 * HOUR]) {
      expect(describeSamsaraFeed(specFor("odometer", { odometer: cadence }), obs("odometer"), NOW).targetUnreachable).toBe(false);
    }
  });
});

describe("the whole catalogue", () => {
  it("puts the worst first, so the answer is the top of the list", () => {
    const health = describeSamsaraFeeds(specs(), allObs({
      identity: { lastSuccessAt: ago(40 * HOUR) },
      ifta: { lastSuccessAt: null, lastAttemptAt: null },
      driver_scores: { lastError: "429" },
    }), NOW);
    expect(health.map((h) => h.state).slice(0, 3)).toEqual(["never", "failing", "late"]);
    expect(health[0]!.id).toBe("ifta");
    expect(health).toHaveLength(SAMSARA_FEED_IDS.length);
  });

  it("treats a feed with no observation at all as never-arrived, not as fresh", () => {
    const health = describeSamsaraFeeds(specs(), [], NOW);
    expect(health.every((h) => h.state === "never")).toBe(true);
    expect(health.every((h) => h.lastSuccessAt === null)).toBe(true);
  });

  it("answers a strip with the worst feed the figure above it depends on", () => {
    const health = describeSamsaraFeeds(specs(), allObs({
      telematics: { lastSuccessAt: ago(9 * HOUR) },
      ifta: { lastSuccessAt: null, lastAttemptAt: null },
    }), NOW);
    // Scoped to the feeds a fuel figure reads: IFTA is worse, and irrelevant to it.
    expect(worstSamsaraFeed(health, ["stats", "telematics"])!.id).toBe("telematics");
    expect(worstSamsaraFeed(health)!.id).toBe("ifta");
    const allWell = describeSamsaraFeeds(specs(), allObs(), NOW);
    expect(worstSamsaraFeed(allWell)).toBeNull();
  });

  it("does not send somebody after a feed that is switched off", () => {
    const health = describeSamsaraFeeds(specs({ ifta: 0 }), allObs(), NOW);
    expect(health.find((h) => h.id === "ifta")!.state).toBe("disabled");
    expect(worstSamsaraFeed(health)).toBeNull();
  });
});

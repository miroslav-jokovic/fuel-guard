import { describe, expect, it } from "vitest";
import { decideSamsaraFeedAlerts, type SamsaraFeedAlertMemory } from "./feedAlerts.js";
import type { SamsaraFeedHealth, SamsaraFeedId } from "./feedHealth.js";

/**
 * When a stale feed pages somebody, and — the half that decides whether anybody reads the mail — when
 * it does not. Every assertion here is about repetition, because detection was settled in
 * `feedHealth.test.ts`.
 */
const NOW = "2026-09-05T12:00:00.000Z";
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(new Date(NOW).getTime() - ms).toISOString();

const health = (o: Partial<SamsaraFeedHealth> & { id: SamsaraFeedId }): SamsaraFeedHealth =>
  ({
    label: "IFTA jurisdiction miles", what: "Miles per state for the quarterly filing.",
    cadenceMs: 24 * HOUR, targetMs: 48 * HOUR, targetSource: "ruling",
    lastSuccessAt: ago(72 * HOUR), ageMinutes: 4320, targetMinutes: 2880, cadenceMinutes: 1440,
    lastError: null, state: "late", targetUnreachable: false, alertable: true,
    needsAttention: true, lead: "IFTA jurisdiction miles last arrived 3 days ago, past the 2 days this feed is held to.",
    ...o,
  }) as SamsaraFeedHealth;

const mem = (o: Partial<SamsaraFeedAlertMemory> & { feed: SamsaraFeedId }): SamsaraFeedAlertMemory => ({
  state: "late", notifiedAt: ago(72 * HOUR), clearedAt: null, ...o,
});

describe("raising", () => {
  it("pages once when a ruled bound is first breached", () => {
    const plan = decideSamsaraFeedAlerts([health({ id: "ifta" })], [], NOW);
    expect(plan.send).toHaveLength(1);
    expect(plan.send[0]!.action).toBe("raise");
    expect(plan.send[0]!.state).toBe("late");
    expect(plan.send[0]!.subject).toContain("late");
    expect(plan.send[0]!.body).toContain("past the 2 days");
    // What it costs the reader, not just what is broken.
    expect(plan.send[0]!.body).toContain("older data");
  });

  it("says nothing on the next evaluation, and the one after that", () => {
    // The branch that turns forty emails into one.
    const plan = decideSamsaraFeedAlerts([health({ id: "ifta" })], [mem({ feed: "ifta" })], NOW);
    expect(plan.send).toEqual([]);
    expect(plan.held).toEqual([{ feed: "ifta", why: "unchanged" }]);
  });

  it("carries the vendor's own words when there are any", () => {
    const plan = decideSamsaraFeedAlerts(
      [health({ id: "ifta", state: "failing", lastError: "403 Forbidden", lead: "IFTA is being refused." })],
      [], NOW,
    );
    expect(plan.send[0]!.body).toContain("403 Forbidden");
    expect(plan.send[0]!.subject).toContain("refused");
  });

  it("never pages for a bound nobody agreed to, however far past it", () => {
    // `alertable` is `describeSamsaraFeed`'s judgement and this file does not second-guess it —
    // a cadence-derived bound is shown on the card and mailed to nobody (Q-SAM1's fallback).
    const derived = health({ id: "odometer", targetSource: "cadence", alertable: false, ageMinutes: 100_000 });
    const plan = decideSamsaraFeedAlerts([derived], [], NOW);
    expect(plan.send).toEqual([]);
    expect(plan.held).toEqual([{ feed: "odometer", why: "not alertable" }]);
  });

  it("never pages for a bound the configured cadence cannot meet", () => {
    const impossible = health({ id: "stats", targetUnreachable: true, alertable: false });
    expect(decideSamsaraFeedAlerts([impossible], [], NOW).send).toEqual([]);
  });
});

describe("escalating", () => {
  it("speaks again when the state genuinely changes", () => {
    const plan = decideSamsaraFeedAlerts(
      [health({ id: "ifta", state: "failing", lastError: "403", lead: "IFTA is being refused." })],
      [mem({ feed: "ifta", state: "late", notifiedAt: ago(72 * HOUR) })],
      NOW,
    );
    expect(plan.send[0]!.action).toBe("raise");
    expect(plan.send[0]!.state).toBe("failing");
  });

  it("holds an escalation that arrives inside the feed's own bound", () => {
    // Not silence: the next evaluation past the window sends it. The alternative is a feed that
    // changes state twice an hour emailing twice an hour.
    const plan = decideSamsaraFeedAlerts(
      [health({ id: "ifta", state: "failing", lastError: "403" })],
      [mem({ feed: "ifta", state: "late", notifiedAt: ago(HOUR) })],
      NOW,
    );
    expect(plan.send).toEqual([]);
    expect(plan.held).toEqual([{ feed: "ifta", why: "cooldown" }]);
  });

  it("measures that window against THIS feed's bound, not a number chosen for all of them", () => {
    // Stats is held to an hour, so it may speak hourly. IFTA is held to two days and may not.
    const stats = health({
      id: "stats", label: "Live vehicle stats", targetMs: HOUR, targetMinutes: 60,
      cadenceMs: 20 * 60_000, state: "failing", lastError: "500",
    });
    const twoHoursAgo = [mem({ feed: "stats", state: "late", notifiedAt: ago(2 * HOUR) })];
    expect(decideSamsaraFeedAlerts([stats], twoHoursAgo, NOW).send).toHaveLength(1);
    const ifta = health({ id: "ifta", state: "failing", lastError: "500" });
    expect(decideSamsaraFeedAlerts([ifta], [mem({ feed: "ifta", notifiedAt: ago(2 * HOUR) })], NOW).send).toEqual([]);
  });
});

describe("clearing", () => {
  it("says so when a feed we chased comes back", () => {
    const ok = health({ id: "ifta", state: "fresh", alertable: false, needsAttention: false, lead: "IFTA arrived 10 minutes ago." });
    const plan = decideSamsaraFeedAlerts([ok], [mem({ feed: "ifta" })], NOW);
    expect(plan.send).toHaveLength(1);
    expect(plan.send[0]!.action).toBe("clear");
    expect(plan.send[0]!.state).toBeNull();
    expect(plan.send[0]!.subject).toContain("back on time");
  });

  it("does not announce a recovery nobody was told about", () => {
    const ok = health({ id: "ifta", state: "fresh", alertable: false, needsAttention: false });
    expect(decideSamsaraFeedAlerts([ok], [], NOW).send).toEqual([]);
  });

  it("does not announce the same recovery twice, even long after the cooldown has passed", () => {
    // Dated well past this feed's 48-hour bound ON PURPOSE. With a recent row the cooldown would hold
    // the second mail anyway, and the test would pass without `clearedAt` being read at all — which
    // is exactly how a first pass at this suite let that guard be deleted unnoticed.
    const ok = health({ id: "ifta", state: "fresh", alertable: false, needsAttention: false });
    const cleared = [mem({ feed: "ifta", clearedAt: ago(200 * HOUR), notifiedAt: ago(200 * HOUR) })];
    const plan = decideSamsaraFeedAlerts([ok], cleared, NOW);
    expect(plan.send).toEqual([]);
    expect(plan.held).toEqual([{ feed: "ifta", why: "not alertable" }]);
  });

  it("holds a raise that follows a recovery too closely — the flap this table exists for", () => {
    /*
     * A `late` feed cannot flap: going late again takes a whole target window with no delivery. A
     * `failing` one can, because `failing` comes from the most recent run's error — `sync_idle` on
     * production has 268 failed runs against 486 done. The memory row SURVIVES the recovery so
     * `notifiedAt` is still there to hold the next raise back.
     */
    const failing = health({ id: "stats", targetMs: HOUR, targetMinutes: 60, state: "failing", lastError: "500" });
    const justCleared = [mem({ feed: "stats", state: "failing", notifiedAt: ago(10 * 60_000), clearedAt: ago(10 * 60_000) })];
    expect(decideSamsaraFeedAlerts([failing], justCleared, NOW).held).toEqual([{ feed: "stats", why: "cooldown" }]);
    // …and it does go out once the feed's own bound has passed.
    const older = [mem({ feed: "stats", state: "failing", notifiedAt: ago(2 * HOUR), clearedAt: ago(2 * HOUR) })];
    expect(decideSamsaraFeedAlerts([failing], older, NOW).send).toHaveLength(1);
  });
});

describe("the whole plan", () => {
  it("decides every feed independently and accounts for each one", () => {
    const feeds = [
      health({ id: "ifta" }),
      health({ id: "stats", label: "Live vehicle stats", targetMs: HOUR, targetMinutes: 60, state: "fresh", alertable: false, needsAttention: false }),
      health({ id: "odometer", targetSource: "cadence", alertable: false, needsAttention: true }),
    ];
    const plan = decideSamsaraFeedAlerts(feeds, [mem({ feed: "stats" })], NOW);
    expect(plan.send.map((d) => [d.feed, d.action])).toEqual([["ifta", "raise"], ["stats", "clear"]]);
    expect(plan.held).toEqual([{ feed: "odometer", why: "not alertable" }]);
    expect(plan.send.length + plan.held.length).toBe(feeds.length);
  });

  it("says nothing at all when every feed is on time and nothing was ever raised", () => {
    const ok = health({ id: "ifta", state: "fresh", alertable: false, needsAttention: false });
    expect(decideSamsaraFeedAlerts([ok], [], NOW)).toEqual({ send: [], held: [{ feed: "ifta", why: "not alertable" }] });
  });
});

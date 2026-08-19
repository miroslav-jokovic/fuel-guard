import { describe, it, expect } from "vitest";
import { planDqAlerts, type DqAlert } from "./dqAlerts.js";
import type { DriverOverviewRow, DqAttentionItem } from "./dqFile.js";

/**
 * C3 — the alert schedule's dedupe design, exhaustively. Every case here is a way a notification
 * channel dies: double-sends after restarts, five alerts for one new item, daily overdue nagging,
 * or alerts about people who left.
 */
const TODAY = "2026-08-19";

const attention = (over: Partial<DqAttentionItem>): DqAttentionItem => ({
  key: "medical_card",
  label: "Medical examiner's certificate",
  citation: "49 CFR §391.43",
  group: "medical",
  state: "expiring",
  goodUntil: "2026-09-01",
  evidenceDate: null,
  daysRemaining: 13,
  ...over,
});

const driver = (over: Partial<DriverOverviewRow> = {}, items: DqAttentionItem[] = []): DriverOverviewRow => ({
  driver_id: "d1",
  driver_name: "Marcus Reyes",
  driver_status: "active",
  state: "incomplete",
  counts: { current: 0, expiring: 0, expired: 0, missing: 0 },
  groups: [],
  attention: items,
  ...over,
});

const plan = (rows: DriverOverviewRow[], sent: string[] = []): DqAlert[] =>
  planDqAlerts(rows, TODAY, new Set(sent));

describe("planDqAlerts — threshold crossings", () => {
  it("an item at exactly 60 days emits the 60 key", () => {
    const out = plan([driver({}, [attention({ daysRemaining: 60 })])]);
    expect(out).toHaveLength(1);
    expect(out[0]!.threshold).toBe(60);
    expect(out[0]!.dedupeKey).toBe("dq:d1:medical_card:60");
    expect(out[0]!.category).toBe("dq_expiring");
  });

  it("at 59 days it does NOT re-emit once the 60 key was sent", () => {
    const out = plan([driver({}, [attention({ daysRemaining: 59 })])], ["dq:d1:medical_card:60"]);
    expect(out).toHaveLength(0);
  });

  it("crossing the next threshold emits again — 30 fires even though 60 was sent", () => {
    const out = plan([driver({}, [attention({ daysRemaining: 30 })])], ["dq:d1:medical_card:60"]);
    expect(out).toHaveLength(1);
    expect(out[0]!.threshold).toBe(30);
  });

  it("an item FIRST seen at 10 days emits ONE alert (the 14 key), never a backlog of five", () => {
    const out = plan([driver({}, [attention({ daysRemaining: 10 })])]);
    expect(out).toHaveLength(1);
    expect(out[0]!.threshold).toBe(14);
    expect(out[0]!.severity).toBe("warning");
  });

  it("expiring today emits the 0 key with a today title", () => {
    const out = plan([driver({}, [attention({ daysRemaining: 0 })])]);
    expect(out[0]!.threshold).toBe(0);
    expect(out[0]!.title).toContain("expires today");
  });

  it("91 days out is not yet news", () => {
    expect(plan([driver({}, [attention({ daysRemaining: 91 })])])).toHaveLength(0);
  });

  it("far-out thresholds are informational, near ones are warnings", () => {
    const far = plan([driver({}, [attention({ daysRemaining: 88 })])]);
    expect(far[0]!.severity).toBe("info");
  });
});

describe("planDqAlerts — overdue weekly cadence", () => {
  it("an overdue item emits with a week-bucketed key and dq_expired", () => {
    const out = plan([driver({}, [attention({ daysRemaining: -3, state: "expired" })])]);
    expect(out).toHaveLength(1);
    expect(out[0]!.category).toBe("dq_expired");
    expect(out[0]!.dedupeKey).toMatch(/^dq:d1:medical_card:overdue:\d+$/);
    expect(out[0]!.title).toContain("expired 3 days ago");
  });

  it("re-running within the same week is silent; the key is deterministic", () => {
    const first = plan([driver({}, [attention({ daysRemaining: -3, state: "expired" })])]);
    const again = plan([driver({}, [attention({ daysRemaining: -3, state: "expired" })])], [first[0]!.dedupeKey]);
    expect(again).toHaveLength(0);
  });

  it("a NEW week emits again — weekly, not once-ever", () => {
    const thisWeek = plan([driver({}, [attention({ daysRemaining: -3, state: "expired" })])])[0]!.dedupeKey;
    const nextWeek = planDqAlerts(
      [driver({}, [attention({ daysRemaining: -10, state: "expired" })])],
      "2026-08-26",
      new Set([thisWeek]),
    );
    expect(nextWeek).toHaveLength(1);
    expect(nextWeek[0]!.dedupeKey).not.toBe(thisWeek);
  });
});

describe("planDqAlerts — who and what never alerts", () => {
  it("a terminated driver emits nothing", () => {
    const out = plan([
      driver({ driver_status: "terminated" }, [attention({ daysRemaining: -3, state: "expired" })]),
    ]);
    expect(out).toHaveLength(0);
  });

  it("undated (missing) items emit nothing — the strip and the digest carry those", () => {
    const out = plan([driver({}, [attention({ state: "missing", goodUntil: null, daysRemaining: null })])]);
    expect(out).toHaveLength(0);
  });

  it("output is worst first: overdue before due-soon", () => {
    const out = plan([
      driver({}, [
        attention({ key: "cdl", label: "CDL", daysRemaining: 12 }),
        attention({ daysRemaining: -5, state: "expired" }),
      ]),
    ]);
    expect(out.map((a) => a.itemKey)).toEqual(["medical_card", "cdl"]);
  });

  it("two drivers with the same item get distinct keys", () => {
    const out = plan([
      driver({}, [attention({ daysRemaining: 14 })]),
      driver({ driver_id: "d2", driver_name: "Dana Ellis" }, [attention({ daysRemaining: 14 })]),
    ]);
    expect(new Set(out.map((a) => a.dedupeKey)).size).toBe(2);
  });
});

import { describe, it, expect } from "vitest";
import { buildDqDigestSection, renderDqDigestHtml } from "./digestDq.js";
import type { DriverOverviewRow } from "./dqFile.js";

/** C4 — the Monday rollup: counts, the five worst pairs, and silence when there is nothing to say. */
const row = (over: Partial<DriverOverviewRow>): DriverOverviewRow => ({
  driver_id: "d1", driver_name: "Marcus Reyes", driver_status: "active",
  state: "incomplete", counts: { current: 10, expiring: 0, expired: 0, missing: 0 },
  groups: [], attention: [], requirements: [], documents: { onFile: 0, of: 0 }, ...over,
});

describe("buildDqDigestSection", () => {
  it("rolls up counts and ranks the top pairs worst first, capped at five", () => {
    const s = buildDqDigestSection([
      row({
        counts: { current: 8, expiring: 2, expired: 1, missing: 0 },
        attention: [
          { key: "cdl", label: "CDL", citation: "", group: "licence", state: "expired", goodUntil: "2026-08-01", evidenceDate: null, daysRemaining: -18 },
          { key: "medical_card", label: "Medical card", citation: "", group: "medical", state: "expiring", goodUntil: "2026-08-25", evidenceDate: null, daysRemaining: 6 },
        ],
      }),
      row({ driver_id: "d2", driver_name: "Dana Ellis", state: "not_started", counts: { current: 0, expiring: 0, expired: 0, missing: 16 } }),
    ]);
    expect(s).toMatchObject({ expired: 1, expiringSoon: 2, notStarted: 1 });
    expect(s.topPairs[0]).toEqual({ driver: "Marcus Reyes", label: "CDL", due: "18 days overdue" });
    expect(s.topPairs[1]!.due).toBe("due in 6 days");
  });

  it("a not_started file contributes to the count but never to the pairs", () => {
    const s = buildDqDigestSection([row({ state: "not_started" })]);
    expect(s.notStarted).toBe(1);
    expect(s.topPairs).toHaveLength(0);
  });
});

describe("renderDqDigestHtml", () => {
  it("renders counts and pairs, escaped", () => {
    const html = renderDqDigestHtml({
      expired: 1, expiringSoon: 2, notStarted: 3,
      topPairs: [{ driver: "A <B>", label: "CDL", due: "due today" }],
    });
    expect(html).toContain("Driver qualification");
    expect(html).toContain("1 expired");
    expect(html).toContain("A &lt;B&gt;");
  });

  it("is EMPTY when there is nothing to say — no zero-strip training readers to skip the email", () => {
    expect(renderDqDigestHtml({ expired: 0, expiringSoon: 0, notStarted: 0, topPairs: [] })).toBe("");
  });
});

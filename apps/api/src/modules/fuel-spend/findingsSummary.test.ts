import { describe, it, expect } from "vitest";
import { USER_ROLES, type FindingQueueState } from "@silvicom/shared";
import { readFindings, readFindingsSummary, quarterStart } from "./findingsRead.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";

/**
 * The Dashboard's two ledger figures (C9), and every assertion is about WHO sees WHAT.
 *
 * This is the strip that made C9's ledger half wait for a ruling: the Dashboard carries
 * `requiresAuth` and no section gate, so any authenticated member opens it, a driver included. The
 * 2026-09-06 ruling put the inbox's own per-row derivation behind it instead of introducing a gate on
 * a page that has none — the shape Q-SAM7 chose for the Samsara strips.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-09-06T12:00:00Z");

/** Answers by the table AND the filters, so a count cannot be satisfied by the wrong query. */
const seed = (o: { anomalies?: number; exceptions?: number; credited?: unknown[]; incidents?: number; epoch?: string | null } = {}) =>
  createSupabaseRecorder({
    tables: {
      anomalies: { count: o.anomalies ?? 82, data: [] },
      card_fraud_incidents: { count: o.incidents ?? 0, data: [] },
      organizations: [{ detection_epoch: o.epoch ?? null }],
      fuel_exceptions: (q: RecordedQuery) =>
        q.filters().some((f) => f.col === "status" && f.val === "credited")
          ? { data: o.credited ?? [] }
          : { count: o.exceptions ?? 76, data: [] },
    },
  });

describe("the Dashboard's findings figures", () => {
  it("counts both sources for somebody who works both, and stays org-scoped", async () => {
    const rec = seed();
    const s = await readFindingsSummary(rec.client, ORG, "admin", NOW);
    expect(s.open).toBe(158);
    expectOrgScoped(rec, ORG);
  });

  // The accountant is the money role and deliberately only the money role (D-SEP7). A theft case is
  // not theirs to see, so it is not theirs to be counted either.
  it("counts only money findings for the bookkeeper, and never reads the anomaly table", async () => {
    const rec = seed();
    const s = await readFindingsSummary(rec.client, ORG, "accountant", NOW);
    expect(s.open).toBe(76);
    expect(rec.forTable("anomalies")).toHaveLength(0);
  });

  /**
   * ⚠ The ruling in one assertion. A driver opens this page — it has no section gate — and must be
   * told NOTHING rather than told zero. "No findings you may see" and "no findings" are different
   * facts about the fleet, and a tile reading 0 would state the second.
   */
  it("answers a driver null rather than zero, which are different facts", async () => {
    const rec = seed();
    const s = await readFindingsSummary(rec.client, ORG, "driver", NOW);
    expect(s.open).toBeNull();
    expect(s.recoveredThisQuarter).toBeNull();
    expect(rec.writes()).toHaveLength(0);
    expect(rec.forTable("anomalies")).toHaveLength(0);
    expect(rec.forTable("fuel_exceptions")).toHaveLength(0);
  });

  // D-FUI7: an anomaly closes with a disposition and never with money, so `recovered` can only come
  // from the ledger — and `fuel` is the only section that could gate it.
  it("gives the money figure only to somebody who can see the ledger", async () => {
    const credited = [{ credited_amount: "900.00" }, { credited_amount: 261.55 }];
    expect((await readFindingsSummary(seed({ credited }).client, ORG, "accountant", NOW)).recoveredThisQuarter).toBe(1161.55);
    // `safety_manager` holds `fuel: "view"`, so they do see it; a role with safety and no fuel would
    // not — there is none today, which is why this asserts the derivation rather than a role list.
    expect((await readFindingsSummary(seed({ credited }).client, ORG, "safety_manager", NOW)).recoveredThisQuarter).toBe(1161.55);
  });

  it("reads zero recovered as zero, not as unknown", async () => {
    const s = await readFindingsSummary(seed({ credited: [] }).client, ORG, "admin", NOW);
    expect(s.recoveredThisQuarter).toBe(0);
  });

  // Bounded by quarter AND by being credited — which is what keeps this off Q-SAM8's list of reads
  // whose cost grows with history.
  it("asks only for credited findings inside the current quarter", async () => {
    const rec = seed();
    await readFindingsSummary(rec.client, ORG, "admin", NOW);
    const moneyQuery = rec.forTable("fuel_exceptions").find((q) =>
      q.filters().some((f) => f.col === "status" && f.val === "credited"),
    )!;
    expect(moneyQuery.filters()).toEqual(
      expect.arrayContaining([{ col: "credited_on", val: "2026-07-01" }]),
    );
  });
});

describe("which quarter the figure covers", () => {
  // In UTC, like every stored date, so a January the 1st in a western timezone cannot report Q4.
  it("starts the quarter on the first of its first month", () => {
    expect(quarterStart(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01");
    expect(quarterStart(new Date("2026-03-31T23:59:59Z"))).toBe("2026-01-01");
    expect(quarterStart(new Date("2026-04-01T00:00:00Z"))).toBe("2026-04-01");
    expect(quarterStart(new Date("2026-09-06T12:00:00Z"))).toBe("2026-07-01");
    expect(quarterStart(new Date("2026-12-31T23:00:00Z"))).toBe("2026-10-01");
  });
});

// Chunk 8c1: an open card-fraud incident is open fuel work, so the Dashboard's count includes it, on the
// same start-date rule as the queue's list — the 8c acceptance "the open count equals the dashboard's".
describe("card-fraud incidents in the Dashboard's count", () => {
  it("adds them for a fuel role, and stays org-scoped", async () => {
    const rec = seed({ incidents: 2 });
    const s = await readFindingsSummary(rec.client, ORG, "admin", NOW);
    expect(s.open).toBe(160);
    expectOrgScoped(rec, ORG);
  });

  it("counts only open and investigating incidents from the start date on", async () => {
    const rec = seed({ incidents: 2, epoch: "2026-10-08T15:28:02Z" });
    await readFindingsSummary(rec.client, ORG, "admin", NOW);
    const q = rec.forTable("card_fraud_incidents")[0]!;
    expect([...(q.filters().find((f) => f.col === "status")?.val as string[])].sort()).toEqual(["investigating", "open"]);
    expect(q.ops.filter((o) => o.method === "or").map((o) => o.args[0]))
      .toEqual(["opened_at.gte.2026-10-08T15:28:02.000Z,status.eq.investigating"]);
  });

  it("never reads them for a role without fuel", async () => {
    const rec = seed({ incidents: 2 });
    await readFindingsSummary(rec.client, ORG, "technician", NOW);
    expect(rec.forTable("card_fraud_incidents")).toHaveLength(0);
  });
});

/**
 * Chunk 8c4's acceptance: "the open count on the page equals the dashboard's". The recorder does not
 * filter (it answers whatever a fixture says), so equal NUMBERS from it would prove nothing; what can be
 * proved is that both sides ask each table the same question. The page opens on the queue's default
 * states with no other narrowing, which is exactly what the Dashboard's door sends, so for every role the
 * count's WHERE must equal the list's WHERE, table by table, and neither may read a table the other skips.
 *
 * ⚠ The date WINDOW is outside this: the page always reads one (90 days by default) and the Dashboard
 * counts every open item. They agree today only because the oldest open item is younger than 90 days —
 * Q-F13 in the plan.
 */
describe("the Dashboard's count and the queue it opens", () => {
  const QUEUE_DEFAULT: FindingQueueState[] = ["open", "investigating", "working"];
  const CASE_TABLES = ["anomalies", "fuel_exceptions", "card_fraud_incidents"] as const;
  const WHERE = new Set(["eq", "neq", "in", "or", "gte", "lte", "gt", "lt", "is", "not"]);
  const where = (q: RecordedQuery) =>
    q.ops.filter((o) => WHERE.has(o.method)).map((o) => JSON.stringify([o.method, o.args])).sort();
  const isCreditedRead = (q: RecordedQuery) => q.filters().some((f) => f.col === "status" && f.val === "credited");

  it("asks every table the same question as the queue, for every role", async () => {
    for (const role of USER_ROLES) {
      const listRec = seed({ epoch: "2026-10-08T15:28:02Z" });
      const countRec = seed({ epoch: "2026-10-08T15:28:02Z" });
      await readFindings(listRec.client, ORG, role, { states: QUEUE_DEFAULT });
      await readFindingsSummary(countRec.client, ORG, role, NOW);
      for (const table of CASE_TABLES) {
        const list = listRec.forTable(table).map(where);
        const count = countRec.forTable(table).filter((q) => !isCreditedRead(q)).map(where);
        expect({ role, table, where: count }).toEqual({ role, table, where: list });
      }
    }
  });
});

/**
 * Q-F13 (a), ruled 2026-10-08: the tile counts every open item and the page reads a date window, so the
 * Dashboard's door carries the date of the oldest item counted. Read in the same query as each count.
 */
describe("the oldest open item the count covers", () => {
  const dated = (o: { anomaly?: string; exception?: string; incident?: string }) =>
    createSupabaseRecorder({
      tables: {
        anomalies: { count: o.anomaly ? 1 : 0, data: o.anomaly ? [{ fueled_at: o.anomaly }] : [] },
        card_fraud_incidents: { count: o.incident ? 1 : 0, data: o.incident ? [{ opened_at: o.incident }] : [] },
        organizations: [{ detection_epoch: null }],
        fuel_exceptions: (q: RecordedQuery) =>
          q.filters().some((f) => f.col === "status" && f.val === "credited")
            ? { data: [] }
            : { count: o.exception ? 1 : 0, data: o.exception ? [{ occurred_on: o.exception }] : [] },
      },
    });

  it("is the earliest across the sources, as a day", async () => {
    const rec = dated({ anomaly: "2026-09-02T03:10:00+00:00", exception: "2026-08-01", incident: "2026-10-05T14:10:00+00:00" });
    expect((await readFindingsSummary(rec.client, ORG, "admin", NOW)).oldestOpenOn).toBe("2026-08-01");
    expectOrgScoped(rec, ORG);
  });

  it("reads each source's oldest row in the count's own query, by that source's date", async () => {
    const rec = dated({ exception: "2026-08-01" });
    await readFindingsSummary(rec.client, ORG, "admin", NOW);
    const asked = (table: string) =>
      rec.forTable(table).filter((q) => !q.filters().some((f) => f.val === "credited"))
        .map((q) => q.ops.filter((o) => o.method === "order" || o.method === "limit").map((o) => [o.method, o.args[0]]));
    expect(asked("anomalies")).toEqual([[["order", "fueled_at"], ["limit", 1]]]);
    expect(asked("fuel_exceptions")).toEqual([[["order", "occurred_on"], ["limit", 1]]]);
    expect(asked("card_fraud_incidents")).toEqual([[["order", "opened_at"], ["limit", 1]]]);
    for (const t of ["anomalies", "fuel_exceptions", "card_fraud_incidents"]) {
      const order = rec.forTable(t).flatMap((q) => q.ops).find((o) => o.method === "order")!;
      expect(order.args[1]).toEqual({ ascending: true });
    }
  });

  it("ignores a source the caller may not see", async () => {
    const rec = dated({ anomaly: "2026-07-01T00:00:00+00:00", exception: "2026-08-01" });
    expect((await readFindingsSummary(rec.client, ORG, "accountant", NOW)).oldestOpenOn).toBe("2026-08-01");
  });

  // Chunk 10: the door's `?from=` must start the page at or before the row it was read from. 01:00Z on
  // 10-06 is 20:00 on 10-05 in Chicago, and the page now starts 10-06 at 05:00Z — so the day must be 10-05.
  it("is a case's day on the carrier's clock, not its UTC day, so the link's page still lists it", async () => {
    const rec = dated({ anomaly: "2026-10-06T01:00:00+00:00", incident: "2026-10-07T01:00:00+00:00" });
    expect((await readFindingsSummary(rec.client, ORG, "admin", NOW)).oldestOpenOn).toBe("2026-10-05");
  });

  it("keeps the ledger's stored date as it is, because it is already a day", async () => {
    const rec = dated({ exception: "2026-10-06" });
    expect((await readFindingsSummary(rec.client, ORG, "admin", NOW)).oldestOpenOn).toBe("2026-10-06");
  });

  it("is null when nothing is open", async () => {
    expect((await readFindingsSummary(dated({}).client, ORG, "admin", NOW)).oldestOpenOn).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { findingFromAnomaly, findingFromException, byOccurredDesc } from "./findingMappers.js";
import { ANOMALY_STATUSES } from "./constants.js";
import { FUEL_EXCEPTION_KINDS, FUEL_EXCEPTION_STATUSES } from "./fuelSpend/exceptions.js";
import { findingAgeDays } from "./findingQueue.js";

/**
 * The mapping is the part that can be wrong in a way nobody notices — a status landing in the wrong
 * queue state, an anomaly acquiring money — so it is pure, in shared, and tested without a database.
 */

const anomaly = (o: Record<string, unknown> = {}) =>
  findingFromAnomaly({ id: "a-1", status: "open", created_at: "2026-09-01T10:00:00Z", ...o } as never);
const exception = (o: Record<string, unknown> = {}) =>
  findingFromException({ id: "e-1", kind: "off_network_premium", status: "open", ...o } as never);

describe("a theft case read as a finding", () => {
  // D-FUI7's first half, enforced in the mapper as well as in the type: a confirmed case is a TRUE
  // finding that recovered nothing, and giving it a face value here would be the same mistake made
  // one layer down from the enum.
  it("never carries money, in any status or disposition", () => {
    for (const status of ANOMALY_STATUSES) {
      expect(anomaly({ status, disposition: "confirmed" }).amountUsd).toBeNull();
    }
  });

  it("lands in safety, so the accountant reading the money ledger never sees it", () => {
    expect(anomaly().section).toBe("safety");
    expect(anomaly().source).toBe("anomaly");
  });

  // Q-FUI13 (b): the feed stays on the detection instant. Trimmed so the two sources sort together,
  // and deliberately NOT relabelled as a business date, which it is not.
  it("dates from the fill instant, falling back to when the case was raised", () => {
    expect(anomaly({ fueled_at: "2026-08-31T23:00:00Z" }).occurredOn).toBe("2026-08-31");
    expect(anomaly({ fueled_at: null }).occurredOn).toBe("2026-09-01");
  });

  it("carries the rule's own message, and says something when there is none", () => {
    expect(anomaly({ message: "  Billed 179 gal into a 140 gal space  " }).summary).toBe("Billed 179 gal into a 140 gal space");
    expect(anomaly({ message: "   " }).summary).toBe("Fuel anomaly");
  });
});

describe("a ledger exception read as a finding", () => {
  it("lands in fuel for every kind the ledger can hold", () => {
    for (const kind of FUEL_EXCEPTION_KINDS) expect(exception({ kind }).section).toBe("fuel");
  });

  // E3: what a finding is WORTH and what came BACK are two figures. The row carries the first; the
  // close carries the second. Merging them is the mistake a list somebody totals would hide.
  it("separates the identified amount from what was actually credited", () => {
    const row = exception({ status: "credited", amount: "1218.74", credited_amount: "900.00" });
    expect(row.amountUsd).toBe(1218.74);
    expect(row.close).toEqual({ via: "money", outcome: "credited", amountUsd: 900 });
  });

  it("has no close while it is open, whatever amount it carries", () => {
    expect(exception({ amount: "500" }).close).toBeNull();
  });

  it("places every status on the axis", () => {
    for (const status of FUEL_EXCEPTION_STATUSES) {
      expect(["open", "investigating", "working", "closed"]).toContain(exception({ status }).queueState);
    }
  });

  it("labels itself from the kind vocabulary rather than printing the token", () => {
    expect(exception({ kind: "recon_missing_in_system" }).summary).toBe("Billed, never recorded");
  });
});

describe("ordering a mixed queue", () => {
  // Two sources merged in memory share no ordering. Without a stable tie-break a page-two request
  // can return a row page one already showed — the paging bug that looks like a data bug.
  it("sorts newest first and breaks ties stably, so paging cannot repeat a row", () => {
    const rows = [
      exception({ id: "e-b", occurred_on: "2026-09-01" }),
      anomaly({ id: "a-a", fueled_at: "2026-09-01T00:00:00Z" }),
      exception({ id: "e-c", occurred_on: "2026-09-03" }),
    ].sort(byOccurredDesc);
    expect(rows.map((r) => r.id)).toEqual(["e-c", "a-a", "e-b"]);
  });

  it("sorts a finding with no date last rather than dropping it", () => {
    const rows = [exception({ id: "e-none", occurred_on: null }), exception({ id: "e-dated", occurred_on: "2026-01-01" })].sort(byOccurredDesc);
    expect(rows.map((r) => r.id)).toEqual(["e-dated", "e-none"]);
  });
});

describe("aging", () => {
  const NOW = new Date("2026-09-06T12:00:00Z");
  it("counts whole days since the finding opened", () => {
    expect(findingAgeDays({ openedAt: "2026-09-01T12:00:00Z" }, NOW)).toBe(5);
    expect(findingAgeDays({ openedAt: "2026-09-06T11:00:00Z" }, NOW)).toBe(0);
  });

  it("answers null rather than a number when nothing recorded the opening", () => {
    expect(findingAgeDays({ openedAt: null }, NOW)).toBeNull();
    expect(findingAgeDays({ openedAt: "not a date" }, NOW)).toBeNull();
  });

  // A clock skew must not make a finding look like it opened in the future and age backwards.
  it("floors at zero rather than reporting a negative age", () => {
    expect(findingAgeDays({ openedAt: "2026-09-08T00:00:00Z" }, NOW)).toBe(0);
  });
});

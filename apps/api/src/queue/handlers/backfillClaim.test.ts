import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * What `backfill` means is decided ENTIRELY by its payload (SAM-S3, plan A2).
 *
 * One handler now serves three callers with three different intents, and the difference matters: the
 * two manual buttons are unbounded sweeps a person asked for and watches, while the scheduled tier
 * takes a bounded bite it can finish inside its rate budget and leaves the rest for the next tick.
 * Collapsing them — a scheduled run that behaves like "Re-check all history" — would put an
 * unbounded vendor sweep on an hourly timer.
 */

const scoring = vi.hoisted(() => ({ backfillOrg: vi.fn(), scoreImportWithCascade: vi.fn() }));
const audit = vi.hoisted(() => ({ writeAudit: vi.fn() }));
const org = vi.hoisted(() => ({ jobCancelRequested: vi.fn().mockResolvedValue(false) }));

vi.mock("../../modules/anomalies/index.js", () => ({
  backfillOrg: scoring.backfillOrg,
  scoreImportWithCascade: scoring.scoreImportWithCascade,
  runPatternSweep: vi.fn(),
  markPatternSweepOutcome: vi.fn(),
  scoreDeclinedImport: vi.fn(),
  scoreDeclinedOrg: vi.fn(),
}));
vi.mock("../../lib/audit.js", () => ({ writeAudit: audit.writeAudit }));
vi.mock("../../modules/org/index.js", () => ({ jobCancelRequested: org.jobCancelRequested }));

import { backfillHandler } from "./scoring.js";
import type { JobContext, QueueJob } from "../types.js";

const ctx = { admin: {}, env: {} } as unknown as JobContext;
const job = (payload: Record<string, unknown> = {}): QueueJob =>
  ({ id: "j1", org_id: "org-1", kind: "backfill", payload, attempts: 1, max_attempts: 5 }) as unknown as QueueJob;

const optsPassed = () => scoring.backfillOrg.mock.calls[0]![3];

afterEach(() => vi.clearAllMocks());

describe("backfillHandler — the payload decides the sweep", () => {
  it("a scheduled tick claims a BOUNDED batch, never the whole history", async () => {
    scoring.backfillOrg.mockResolvedValue(7);
    await backfillHandler(ctx, job({ reconBatch: 250, reconRetryAfterHours: 72 }), vi.fn());
    expect(optsPassed()).toEqual({ reconClaim: { limit: 250, retryAfterHours: 72 } });
  });

  it("the cooldown falls back to a day rather than to zero, so a missing knob cannot mean 'retry always'", async () => {
    scoring.backfillOrg.mockResolvedValue(0);
    await backfillHandler(ctx, job({ reconBatch: 100 }), vi.fn());
    expect(optsPassed()).toEqual({ reconClaim: { limit: 100, retryAfterHours: 24 } });
  });

  it("'Re-check all history' is still unbounded — the manual button did not change", async () => {
    scoring.backfillOrg.mockResolvedValue(1);
    await backfillHandler(ctx, job({ full: true }), vi.fn());
    expect(optsPassed()).toEqual({});
  });

  it("'Reconcile new fills' is still the never-reconciled sweep", async () => {
    scoring.backfillOrg.mockResolvedValue(1);
    await backfillHandler(ctx, job({}), vi.fn());
    expect(optsPassed()).toEqual({ onlyUnreconciled: true });
  });

  /**
   * SAM-S6's shape. The distinction that matters is COLLECTION vs RE-SCORE: `full` re-fetches
   * telematics, `rebuild` relearns and re-scores from what S4 already collected and fetches nothing.
   * Confusing the two spends the vendor rate budget recomputing values already in the database.
   */
  it("'rebuild' re-scores from stored telematics and fetches NOTHING", async () => {
    scoring.backfillOrg.mockResolvedValue(15953);
    await backfillHandler(ctx, job({ rebuild: true }), vi.fn());
    expect(optsPassed()).toEqual({ skipRecon: true });
  });

  it("a rebuild covers ALL history unless a window is asked for", async () => {
    scoring.backfillOrg.mockResolvedValue(400);
    await backfillHandler(ctx, job({ rebuild: true, sinceDays: 30 }), vi.fn());
    expect(optsPassed()).toEqual({ skipRecon: true, sinceDays: 30 });
  });

  // `rebuild` must win over `full`: the two are opposites (re-score vs re-fetch), and a payload
  // carrying both should take the one that spends no vendor budget.
  it("rebuild takes precedence over full when a payload carries both", async () => {
    scoring.backfillOrg.mockResolvedValue(1);
    await backfillHandler(ctx, job({ rebuild: true, full: true }), vi.fn());
    expect(optsPassed()).toEqual({ skipRecon: true });
  });

  // A tier that runs hourly and records nothing is a tier nobody can tell is working.
  it("records what a scheduled tick fetched, actor or no actor", async () => {
    scoring.backfillOrg.mockResolvedValue(42);
    const result = await backfillHandler(ctx, job({ reconBatch: 250 }), vi.fn());
    expect(result).toMatchObject({ count: 42, batch: 250 });
    expect(audit.writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "transactions.backfill", meta: expect.objectContaining({ count: 42, batch: 250 }) }),
    );
  });
});

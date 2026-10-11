import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * A queued `financial_projection` row (an operator's repair; `inprocessDrain` claims the kind) must
 * project the same trailing window as the nightly scheduler. D-FIN7: the projection window is never
 * shorter than the agent's 75-day sweep, or a row the sweep can still change is staged and never
 * projected. The handler hardcoded 50 until 2026-10-05.
 */
const financial = vi.hoisted(() => ({ projectFinancialWindow: vi.fn() }));
vi.mock("../../modules/financial/index.js", async (orig) => ({
  ...(await orig<typeof import("../../modules/financial/index.js")>()),
  projectFinancialWindow: financial.projectFinancialWindow,
}));

import { financialProjectionHandler } from "./financial.js";
import type { JobContext, QueueJob } from "../types.js";

const run = (payload: Record<string, unknown>) =>
  financialProjectionHandler({ admin: {} } as unknown as JobContext, { org_id: "org1", payload } as unknown as QueueJob, async () => {});

describe("financialProjectionHandler window", () => {
  afterEach(() => {
    vi.useRealTimers();
    financial.projectFinancialWindow.mockReset();
  });

  it("a routine job projects the scheduler's trailing 75 days, through tomorrow", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-05T18:00:00Z") });
    financial.projectFinancialWindow.mockResolvedValue({ entriesUpserted: 0 });
    const stats = await run({});
    expect(financial.projectFinancialWindow).toHaveBeenCalledWith({}, "org1", "2026-07-22", "2026-10-06");
    expect(stats).toMatchObject({ from: "2026-07-22", to: "2026-10-06" });
  });

  it("payload.full still backfills from 2024-01-01 (D-FS3)", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-05T18:00:00Z") });
    financial.projectFinancialWindow.mockResolvedValue({ entriesUpserted: 0 });
    await run({ full: true });
    expect(financial.projectFinancialWindow).toHaveBeenCalledWith({}, "org1", "2024-01-01", "2026-10-06");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The feed job's outcome is what `financialFreshness` reads: it measures "EFS transactions have not
 * updated" from the last DONE `efs_soap_posted`. A refused feed recorded as done silences that alert.
 */
const ingest = vi.hoisted(() => ({ runEfsSoapIngest: vi.fn() }));
const audit = vi.hoisted(() => ({ writeAudit: vi.fn() }));
vi.mock("../../modules/efs/services/efsSoapIngest.js", () => ({ runEfsSoapIngest: ingest.runEfsSoapIngest }));
vi.mock("../../modules/efs/services/efsWindowRefetch.js", () => ({ runEfsWindowRefetch: vi.fn() }));
vi.mock("../../lib/audit.js", () => ({ writeAudit: audit.writeAudit }));

import { efsSoapHandler } from "./efsSoap.js";
import type { JobContext, QueueJob } from "../types.js";

const ctx = { admin: {}, env: {} } as unknown as JobContext;
const job = (payload: Record<string, unknown> = {}): QueueJob =>
  ({ id: "j1", org_id: "org-1", kind: "efs_soap_posted", payload, attempts: 1, max_attempts: 5 }) as unknown as QueueJob;
const REFUSED = 'EFS blocked this request at their firewall. (EFS said: "Not Allowed 23602315833")';

afterEach(() => vi.clearAllMocks());

describe("efsSoapHandler", () => {
  it("fails the job when EFS refuses the feed, so the run is not recorded as done", async () => {
    ingest.runEfsSoapIngest.mockResolvedValue({ feed: "posted", status: "failed", pagesFetched: 0, rowsFetched: 0, error: REFUSED });
    await expect(efsSoapHandler(ctx, job(), vi.fn())).rejects.toThrow(/posted feed failed: EFS blocked this request/);
  });

  it("still writes the Sync now audit before failing", async () => {
    ingest.runEfsSoapIngest.mockResolvedValue({ feed: "posted", status: "failed", pagesFetched: 0, rowsFetched: 0, error: REFUSED });
    await expect(efsSoapHandler(ctx, job({ actorId: "u-1" }), vi.fn())).rejects.toThrow();
    expect(audit.writeAudit).toHaveBeenCalledWith(ctx.admin, expect.objectContaining({ action: "integration.efs_soap.sync_now.posted", meta: expect.objectContaining({ status: "failed" }) }));
  });

  it.each(["ingested", "empty", "skipped_disabled", "skipped_no_config", "not_implemented"])(
    "a %s run is an answer, not a fault, and completes",
    async (status) => {
      ingest.runEfsSoapIngest.mockResolvedValue({ feed: "posted", status, pagesFetched: 0, rowsFetched: 0 });
      await expect(efsSoapHandler(ctx, job(), vi.fn())).resolves.toMatchObject({ status });
    },
  );
});

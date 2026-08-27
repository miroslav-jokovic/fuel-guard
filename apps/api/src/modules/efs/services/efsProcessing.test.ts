import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  scoreImport: vi.fn(),
  scoreDeclined: vi.fn(),
  notify: vi.fn(),
}));

// efsProcessing invokes scoring through the anomalies module index (2026-08-27 carve-out).
vi.mock("../../anomalies/index.js", () => ({
  scoreImportWithCascade: mocks.scoreImport,
  scoreDeclinedImport: mocks.scoreDeclined,
}));
vi.mock("../../../services/notify.js", () => ({ notify: mocks.notify }));

import { processEfsProcessingRun } from "./efsProcessing.js";

function fakeAdmin() {
  const updates: { table: string; patch: Record<string, unknown> }[] = [];
  const processing = {
    id: "processing-1",
    org_id: "org-1",
    import_id: "import-1",
    feed: "posted",
    status: "pending",
    attempts: 0,
  };

  const admin = {
    rpc: async (fn: string) => {
      if (fn === "claim_efs_processing_run") {
        if (processing.status === "succeeded") return { data: [], error: null };
        processing.status = "running";
        processing.attempts += 1;
        return { data: [processing], error: null };
      }
      return { data: null, error: null };
    },
    from(table: string) {
      let mode: "select" | "update" = "select";
      let patch: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        update: (value: Record<string, unknown>) => {
          mode = "update";
          patch = value;
          updates.push({ table, patch: value });
          return chain;
        },
        maybeSingle: async () => {
          if (table === "efs_processing_runs") {
            return processing.status === "succeeded" ? { data: null, error: null } : { data: processing, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(
            mode === "update"
              ? (() => {
                  if (table === "efs_processing_runs" && patch.status === "succeeded") processing.status = "succeeded";
                  return { data: null, error: null };
                })()
              : table === "fuel_transactions"
                ? { data: [{ id: "txn-1" }], error: null }
                : table === "anomalies"
                  ? { data: [{ id: "anomaly-1", transaction_id: "txn-1", severity: "critical", message: "Overfill" }], error: null }
                  : table === "memberships"
                    ? { data: [{ user_id: "user-1" }, { user_id: "user-2" }], error: null }
                    : { data: null, error: null },
          ).then(resolve, reject),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { admin, processing, updates };
}

describe("processEfsProcessingRun", () => {
  it("scores once and emits deduplicated notifications for a new fuel alert", async () => {
    mocks.scoreImport.mockResolvedValueOnce({ scored: 1, cascaded: 0, vehicles: 1 });
    mocks.notify.mockResolvedValue("notification-id");
    const { admin, processing, updates } = fakeAdmin();

    const result = await processEfsProcessingRun(admin, {} as never, processing.id);

    expect(result).toMatchObject({ feed: "posted", alerts: 1, notifications: 2 });
    expect(mocks.scoreImport).toHaveBeenCalledWith(admin, {}, "org-1", "import-1");
    expect(mocks.notify).toHaveBeenCalledTimes(2);
    expect(updates.some((u) => u.table === "efs_processing_runs" && u.patch.status === "succeeded")).toBe(true);
  });
});

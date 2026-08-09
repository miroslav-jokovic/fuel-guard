import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  failScoringAttempt,
  persistScoringOutcome,
  scoringResultHash,
  startScoringAttempt,
} from "./persist.js";

interface FakeOptions {
  rpcData?: unknown;
  rpcError?: { message: string } | null;
  insertError?: { message: string } | null;
  updateData?: unknown;
  updateError?: { message: string } | null;
}

function fakeAdmin(options: FakeOptions = {}) {
  const calls: { kind: string; payload?: Record<string, unknown> }[] = [];
  const admin = {
    from(table: string) {
      return {
        insert(payload: Record<string, unknown>) {
          calls.push({ kind: `${table}.insert`, payload });
          return {
            select() {
              return {
                single: async () => ({
                  data: options.insertError ? null : { id: payload.id },
                  error: options.insertError ?? null,
                }),
              };
            },
          };
        },
        update(payload: Record<string, unknown>) {
          calls.push({ kind: `${table}.update`, payload });
          const chain = {
            eq: () => chain,
            select: () => ({
              maybeSingle: async () => ({
                data: options.updateError ? null : (options.updateData ?? { id: "attempt-1" }),
                error: options.updateError ?? null,
              }),
            }),
          };
          return chain;
        },
      };
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ kind: `rpc:${fn}`, payload: args });
      return { data: options.rpcData ?? { idempotent: false, anomaly_id: null }, error: options.rpcError ?? null };
    },
  } as unknown as SupabaseClient;
  return { admin, calls };
}

describe("scoring persistence contract", () => {
  it("hashes equivalent objects independently of key order", () => {
    expect(scoringResultHash({ b: 2, a: { d: 4, c: 3 } })).toBe(
      scoringResultHash({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it("creates a running attempt and returns its identity", async () => {
    const { admin, calls } = fakeAdmin();
    const attempt = await startScoringAttempt(admin, {
      orgId: "org-1",
      txnId: "txn-1",
      engineVersion: "commit-1",
      resultHash: "sha256:result",
    });

    expect(attempt.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[0]).toMatchObject({
      kind: "scoring_attempts.insert",
      payload: {
        org_id: "org-1",
        transaction_id: "txn-1",
        engine_version: "commit-1",
        result_hash: "sha256:result",
        status: "running",
      },
    });
  });

  it("sends the complete outcome to the atomic RPC and exposes idempotent retries", async () => {
    const { admin, calls } = fakeAdmin({ rpcData: { idempotent: true, anomaly_id: "case-1" } });
    const result = await persistScoringOutcome(admin, {
      attempt: { id: "attempt-1", engineVersion: "commit-1", resultHash: "sha256:result" },
      orgId: "org-1",
      txnId: "txn-1",
      vehicleId: "vehicle-1",
      fueledAt: "2026-08-08T12:00:00Z",
      caseFired: [],
      outcome: { case_level: "clear", has_anomaly: false },
    });

    expect(result).toEqual({ idempotent: true, anomalyId: "case-1" });
    expect(calls[0]).toMatchObject({
      kind: "rpc:persist_scoring_outcome",
      payload: {
        p_attempt_id: "attempt-1",
        p_org_id: "org-1",
        p_transaction_id: "txn-1",
        p_vehicle_id: "vehicle-1",
        p_engine_version: "commit-1",
        p_result_hash: "sha256:result",
        p_case: null,
        p_outcome: { case_level: "clear", has_anomaly: false },
      },
    });
  });

  it("surfaces atomic persistence failures", async () => {
    const { admin } = fakeAdmin({ rpcError: { message: "database unavailable" } });
    await expect(
      persistScoringOutcome(admin, {
        attempt: { id: "attempt-1", engineVersion: "commit-1", resultHash: "sha256:result" },
        orgId: "org-1",
        txnId: "txn-1",
        vehicleId: null,
        fueledAt: "2026-08-08T12:00:00Z",
        caseFired: [],
        outcome: {},
      }),
    ).rejects.toThrow("atomic persistence failed");
  });

  it("records a failed running attempt and surfaces failure to record it", async () => {
    const { admin, calls } = fakeAdmin();
    await failScoringAttempt(admin, "attempt-1", "database unavailable");
    expect(calls[0]).toMatchObject({
      kind: "scoring_attempts.update",
      payload: { status: "failed", error: "database unavailable" },
    });

    const failing = fakeAdmin({ updateError: { message: "ledger unavailable" } });
    await expect(failScoringAttempt(failing.admin, "attempt-1", "database unavailable")).rejects.toThrow(
      "could not record failed attempt",
    );
  });
});

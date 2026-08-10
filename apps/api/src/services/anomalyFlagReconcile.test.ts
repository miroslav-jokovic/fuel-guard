import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../testing/supabaseRecorder.js";
import { reconcileAnomalyFlags } from "./anomalyFlagReconcile.js";

/**
 * These tests used to build a chainable Proxy whose fallthrough was `return () => proxy`, which
 * accepted `.eq("org_id", orgId)` and threw it away. Every assertion below passed identically whether
 * or not this service scoped its four queries to one tenant — and since the API talks to Postgres
 * with the service role, RLS was not going to catch it either (audit 2026-08-09, Stage 2.5).
 * The shared recorder keeps the same ergonomics and remembers the query, so `expectOrgScoped` can
 * assert the thing that actually matters.
 */
const ORG = "org1";

/** Ids named in the `.in("id", [...])` of a write — what the old fake exposed as `updates[].ids`. */
const writtenIds = (q: { filters(): Array<{ col: string; val: unknown }> }) =>
  (q.filters().find((f) => f.col === "id")?.val ?? []) as string[];

/** The row patch a recorded write carried. */
const patchOf = (q: { write: { payload: unknown } | null }): Record<string, unknown> =>
  (q.write?.payload ?? {}) as Record<string, unknown>;

describe("reconcileAnomalyFlags", () => {
  it("clears flags whose anomalies are all superseded/absent, restores missing flags with max severity", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        anomalies: [
          { transaction_id: "t2", severity: "medium" },
          { transaction_id: "t2", severity: "critical" },
          { transaction_id: "t3", severity: "low" },
        ],
        // t1 is flagged but has NO live anomaly (dead link) → cleared.
        // t2 is flagged AND live → untouched. t3 has live anomalies but no flag → restored.
        fuel_transactions: [{ id: "t1" }, { id: "t2" }],
      },
    });

    const res = await reconcileAnomalyFlags(rec.client, ORG);
    expect(res).toEqual({ cleared: 1, restored: 1 });

    const writes = rec.writes();
    const clear = writes.find((w) => patchOf(w).has_anomaly === false);
    const restore = writes.find((w) => patchOf(w).has_anomaly === true);
    if (!clear || !restore) throw new Error("expected one clearing and one restoring update");

    expect(writtenIds(clear)).toEqual(["t1"]);
    expect(patchOf(clear).max_severity).toBeNull();
    expect(writtenIds(restore)).toEqual(["t3"]);
    expect(patchOf(restore).max_severity).toBe("low");

    // The point of the recorder: every read AND every write named this org.
    expectOrgScoped(rec, ORG);
  });

  it("does nothing when flags already match the live anomalies", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        anomalies: [{ transaction_id: "t1", severity: "high" }],
        fuel_transactions: [{ id: "t1" }],
      },
    });
    const res = await reconcileAnomalyFlags(rec.client, ORG);
    expect(res).toEqual({ cleared: 0, restored: 0 });
    expect(rec.writes()).toHaveLength(0);
    expectOrgScoped(rec, ORG);
  });
});

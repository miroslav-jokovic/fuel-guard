import { describe, it, expect } from "vitest";
import {
  runDataRetention,
  RETENTION_RULES,
  RETENTION_FORBIDDEN,
  type RetentionRule,
} from "./dataRetention.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../testing/supabaseRecorder.js";

/**
 * Migrated off the local `makeAdmin` Proxy (audit 2026-08-09, Stage 2.5). Retention DELETES rows, and
 * the only thing that keeps a run inside its own tenant is `.eq("org_id", orgId)` on both the select
 * and the delete of every org-scoped rule — the filter the old fake threw away. A dropped filter here
 * is not a wrong number in a report, it is another fleet's telematics history gone. The recorder
 * reproduces the old capture (which statements ran, which ids they named) from the recorded chain.
 */
const ORG = "org1";
const oldIso = new Date(Date.now() - 500 * 86_400_000).toISOString();

/** Delete statements issued against `table` (the old fake's `deletes[table]` counter). */
const deleteStatements = (rec: SupabaseRecorder, table: string) =>
  rec.forTable(table).filter((q) => q.write?.method === "delete");
/** Ids named in `.in("id", […])` across those deletes (the old fake's `deletedIds[table]`). */
const deletedIds = (rec: SupabaseRecorder, table: string) =>
  deleteStatements(rec, table).flatMap((q) => (q.filters().find((f) => f.col === "id")?.val ?? []) as string[]);

describe("retention policy (the config itself)", () => {
  it("never lists a forbidden table (audit ledger, business records, identity)", () => {
    const listed = new Set(RETENTION_RULES.map((r) => r.table));
    expect(RETENTION_FORBIDDEN).toContain("efs_card_mutations");
    // The §391.51 file and everything that dates it — the binder exists to reproduce this material
    // years later (§390.32(d)), so a retention rule must never be able to reach it (D-BD12).
    for (const t of ["certifications", "qualification_records", "documents", "driver_employment_history", "driver_authorizations", "psp_requests", "esign_consents"]) {
      expect(RETENTION_FORBIDDEN).toContain(t);
    }
    for (const t of RETENTION_FORBIDDEN) expect(listed.has(t)).toBe(false);
  });

  it("keeps raw telematics at least 13 months and only prunes finished jobs", () => {
    for (const r of RETENTION_RULES) {
      if (["idle_events", "hos_duty_segments", "idle_park_sessions", "vehicle_engine_days"].includes(r.table)) {
        expect(r.keepDays).toBeGreaterThanOrEqual(395);
      }
    }
    const jobs = RETENTION_RULES.find((r) => r.table === "jobs")!;
    expect(jobs.onlyWhenIn).toEqual({ column: "status", values: ["done", "failed"] });
  });
});

describe("runDataRetention", () => {
  const idRule: RetentionRule = {
    table: "idle_events", timeColumn: "started_at", keepDays: 400,
    strategy: "id", orgScoped: true, why: "test",
  };
  const sliceRule: RetentionRule = {
    table: "weather_cache", timeColumn: "hour_utc", keepDays: 400,
    strategy: "timeSlice", orgScoped: false, why: "test",
  };

  it("id strategy: deletes selected ids in batches until the select drains", async () => {
    const rec = createSupabaseRecorder({
      tables: { idle_events: { pages: [[{ id: "a" }, { id: "b" }], []] } },
    });
    const res = await runDataRetention(rec.client, ORG, [idRule]);
    expect(res.totalDeleted).toBe(2);
    expect(deletedIds(rec, "idle_events")).toEqual(["a", "b"]);
    expect(res.tables[0]).toMatchObject({ table: "idle_events", deleted: 2, capped: false });
    // rule.orgScoped === true → both the id select and the delete must carry the tenant filter.
    expectOrgScoped(rec, ORG);
  });

  it("id strategy: nothing past the cutoff → zero deletes issued", async () => {
    const rec = createSupabaseRecorder({ tables: { idle_events: { pages: [[]] } } });
    const res = await runDataRetention(rec.client, ORG, [idRule]);
    expect(res.totalDeleted).toBe(0);
    expect(deleteStatements(rec, "idle_events")).toHaveLength(0);
    expectOrgScoped(rec, ORG);
  });

  it("timeSlice strategy: deletes oldest-first slices and stops at the cutoff", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        weather_cache: {
          // 1st oldest probe: ancient row → slice delete; 2nd probe: only a recent row → stop.
          pages: [[{ hour_utc: oldIso }], [{ hour_utc: new Date().toISOString() }]],
          count: 1234, // what `.delete({ count: "exact" })` reports back
        },
      },
    });
    const res = await runDataRetention(rec.client, ORG, [sliceRule]);
    expect(deleteStatements(rec, "weather_cache")).toHaveLength(1);
    expect(res.totalDeleted).toBe(1234);
    // weather_cache is exempt because the RULE says so: `orgScoped: false` — it is the global hourly
    // weather grid, which has no org_id column at all. That the runner honours the flag is the point.
    expectOrgScoped(rec, ORG, { exempt: ["weather_cache"] });
    expect(rec.forTable("weather_cache").every((q) => !q.filters().some((f) => f.col === "org_id"))).toBe(true);
  });

  it("a failing table doesn't stop the others, and the error still fails the run", async () => {
    const failing: RetentionRule = { ...idRule, table: "boom" };
    const rec = createSupabaseRecorder({
      tables: {
        boom: { error: { message: "nope" } }, // its select errors out
        idle_events: { pages: [[{ id: "x" }], []] },
      },
    });
    await expect(runDataRetention(rec.client, ORG, [failing, idRule])).rejects.toThrow("nope");
    expect(deletedIds(rec, "idle_events")).toEqual(["x"]); // the healthy table was still pruned
    expectOrgScoped(rec, ORG);
  });
});

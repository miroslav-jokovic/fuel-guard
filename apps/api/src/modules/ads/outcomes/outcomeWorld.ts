import { ADS_SETTINGS_UNSET, type AdsSettings, type LeadOutcome } from "@silvicom/shared";
import { postgrestFixture, type FixtureRow } from "../../../testing/postgrestFixture.js";
import { createSupabaseRecorder, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import type { OutcomeFeedTargets } from "./feedTarget.js";

/**
 * The outcome feed's test world (B6, Q-AD40, the L3 sweep): a ledger that keeps 0537's two rules the feed leans on —
 * the unique `(org_id, provider, source_event_ref)` (23505) and the guard's "only a queued or failed row is
 * written" (AX011) — one connection, the bell with `emit_notification`'s dedupe, and the settings versions as
 * `saveSettingsVersion` appends them (newest in force). The append-only trigger itself is the PGlite matrix's
 * (`ads-foundation`). A test helper, not a test: no `.test.ts`, so the suites that share it read one fake.
 *
 * `crashUpdates(n)` / `crashInserts(n)`: the next n ledger writes of that kind fail as the process dying there would;
 * `crashAtWrite(kind, n)`: the Nth one does (the L3 sweep's kill points).
 */

export const ORG = "00000000-0000-4000-8000-0000000000a1";
export const CONN = "00000000-0000-4000-8000-0000000000c1";
export const ADMIN = "00000000-0000-4000-8000-0000000000d1";
export const CAMP = "00000000-0000-4000-8000-0000000000e1";
export const DATASET = "770000000000001";
export const TOKEN = "fake-system-user-token";
export const NOW = "2026-11-06T18:00:00.000Z";
export const lead = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const hoursAgo = (h: number) => new Date(Date.parse(NOW) - h * 3_600_000).toISOString();

export function outcome(n: number, reached: LeadOutcome["reached"], patch: Partial<LeadOutcome> = {}): LeadOutcome {
  return { lead_id: lead(n), provider: "meta", platform_lead_ref: `12000000000000${n}`, campaign_id: CAMP, arrived_at: hoursAgo(72), reached, ...patch };
}

export function world(opts: { outcomes: LeadOutcome[]; target?: boolean; provider?: "meta" | "simulator"; settings?: AdsSettings[] }) {
  const events: FixtureRow[] = [];
  const connections: FixtureRow[] = [{ id: CONN, org_id: ORG, provider: opts.provider ?? "meta", is_sandbox: true, token_sealed: "v1.sealed", status: "connected" }];
  const versions: FixtureRow[] = (opts.settings ?? [ADS_SETTINGS_UNSET]).map((settings, i) => ({
    id: `set-${i + 1}`, org_id: ORG, version: i + 1, settings, kill_switch: false, kill_reason: null, created_at: NOW, created_by_name: "Owner",
  }));
  let crashInserts = 0;
  const seen = { insert: 0, update: 0 };
  const crashAt = { insert: 0, update: 0 };
  const bell: Array<{ category: string; dedupe: string | null }> = [];
  let seq = 0;
  let crashUpdates = 0;
  const matching = (rows: FixtureRow[], q: RecordedQuery) =>
    rows.filter((r) => postgrestFixture([{ ...r }])({ ...q, ops: q.ops.filter((o) => o.method !== "select") }).length > 0);
  const rec = createSupabaseRecorder({
    tables: {
      ads_outcome_events: (q) => {
        if (q.write?.method === "insert") {
          if (++seen.insert === crashAt.insert) crashInserts += 1;
          if (crashInserts > 0) {
            crashInserts -= 1;
            const dead = { message: "connection terminated (injected crash)" };
            return { data: null, error: dead, writeError: dead };
          }
          const row = q.write.payload as FixtureRow;
          if (events.some((e) => e.org_id === row.org_id && e.provider === row.provider && e.source_event_ref === row.source_event_ref)) {
            const dup = { code: "23505", message: "duplicate key value violates unique constraint" };
            return { data: null, error: dup, writeError: dup };
          }
          events.push({ id: `oe-${++seq}`, attempts: 0, sent_at: null, response: null, status: "queued", campaign_id: null, created_at: `${NOW}#${String(seq).padStart(4, "0")}`, ...row });
          return [];
        }
        if (q.write?.method === "update") {
          if (++seen.update === crashAt.update) crashUpdates += 1;
          if (crashUpdates > 0) {
            crashUpdates -= 1;
            const dead = { message: "connection terminated (injected crash)" };
            return { data: null, error: dead, writeError: dead };
          }
          for (const e of matching(events, q)) {
            if (e.status !== "queued" && e.status !== "failed") throw new Error("AX011: only a queued or failed event is sent");
            Object.assign(e, q.write.payload as object);
          }
          return [];
        }
        return postgrestFixture(events)(q);
      },
      ads_platform_connections: (q) => {
        if (q.write?.method === "update") {
          for (const c of matching(connections, q)) Object.assign(c, q.write.payload as object);
          return [];
        }
        return postgrestFixture(connections)(q);
      },
      memberships: postgrestFixture([{ org_id: ORG, user_id: ADMIN, role: "admin", suspended_at: null }]),
      ads_settings_versions: (q) => {
        if (q.write?.method === "insert") {
          const row = q.write.payload as FixtureRow;
          if (versions.some((v) => v.org_id === row.org_id && v.version === row.version)) {
            const dup = { code: "23505", message: "duplicate key value violates unique constraint" };
            return { data: null, error: dup, writeError: dup };
          }
          versions.push({ id: `set-${versions.length + 1}`, created_at: NOW, ...row });
          return [{ id: `set-${versions.length}`, version: row.version }];
        }
        return postgrestFixture(versions)(q);
      },
    },
    rpc: (fn, args) => {
      if (fn !== "emit_notification") return null;
      const a = args as { p_category: string; p_dedupe_key: string | null };
      if (a.p_dedupe_key && bell.some((b) => b.dedupe === a.p_dedupe_key)) return null;
      bell.push({ category: a.p_category, dedupe: a.p_dedupe_key });
      return `ntf-${bell.length}`;
    },
  });
  const targets: OutcomeFeedTargets = { targetFor: async (o, c) => (opts.target === false || o !== ORG || c !== CONN ? null : { dataset_id: DATASET }) };
  return {
    rec, events, connections, bell, targets, versions,
    outcomes: { outcomesSince: async () => opts.outcomes.map((o) => ({ ...o, reached: { ...o.reached } })) },
    /** The next `n` ledger UPDATEs fail as the process dying there would. */
    crashUpdates: (n = 1) => { crashUpdates += n; },
    crashInserts: (n = 1) => { crashInserts += n; },
    /** The Nth ledger write of this kind (1-based, counted from the world's start) fails as a crash there would. */
    crashAtWrite: (kind: "insert" | "update", n: number) => { crashAt[kind] = n; },
  };
}


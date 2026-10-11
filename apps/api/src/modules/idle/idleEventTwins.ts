import type { SupabaseClient } from "@supabase/supabase-js";
import { idleEventKey, isEncodedIdleEventId } from "@silvicom/shared";
import { writeAudit } from "../../lib/audit.js";
import { syncIdleRollup } from "./idleRollup.js";

/**
 * The twin clean-up for `idle_events` (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md I0, W1; migration 0398).
 *
 * Samsara sent every idling event since 2026-08-15 under two spellings of its id, and 0042 keyed the table
 * on the spelling, so 58,143 events were stored twice (measured 2026-10-01) and every driver idle figure over
 * that span read double. This keys every row that has no `event_key` yet, and of each set of rows sharing a
 * key keeps ONE — the real-UUID spelling, which names the event in full — and deletes the rest.
 *
 * It is a job, and an audited one, rather than SQL run by hand: production deletes go through code that
 * says what it removed (plan §6 I0). Every pass that changes anything writes one `idle.event_twins_removed`
 * audit row with its counts and the time span it touched. A pass that finds nothing unkeyed is one indexed
 * read and writes nothing, so it runs every scheduler cycle ahead of `sync_idle` at no cost — which is also
 * what removes any twin the sync inserted while rows were still unkeyed (see keyIdleEventRows).
 */

const PAGE = 1000;
const LOOKUP_CHUNK = 200;
/** Ids per RPC call; a key group is never split across two calls, so a pair is resolved in one statement. */
const RPC_IDS = 500;
const DAY_MS = 86_400_000;

interface StoredEvent {
  id: string;
  samsara_event_id: string;
  started_at: string;
  created_at: string;
  event_key: string | null;
}

export interface IdleEventTwinsResult {
  /** Rows that had no key when the pass began. */
  unkeyed: number;
  keyed: number;
  deleted: number;
  /** Earliest `started_at` of any event that had a twin — where the derived figures must be rebuilt from. */
  earliestTwinStartedAt: string | null;
  latestTwinStartedAt: string | null;
  /** When the first deleted twin was WRITTEN — anything computed before it never saw a twin. */
  earliestTwinCreatedAt: string | null;
}

async function readUnkeyed(admin: SupabaseClient, orgId: string): Promise<StoredEvent[]> {
  const out: StoredEvent[] = [];
  let after: string | null = null;
  // Keyset by id, not offsets: nothing is written until every unkeyed row has been read, but a sync running
  // beside this pass may insert rows, and an offset walk would skip or repeat around them.
  for (;;) {
    let q = admin
      .from("idle_events")
      .select("id, samsara_event_id, started_at, created_at, event_key")
      .eq("org_id", orgId)
      .is("event_key", null)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (after) q = q.gt("id", after);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const page = (data ?? []) as StoredEvent[];
    out.push(...page);
    if (page.length < PAGE) return out;
    after = page[page.length - 1]!.id;
  }
}

async function readKeyed(admin: SupabaseClient, orgId: string, keys: string[]): Promise<StoredEvent[]> {
  const out: StoredEvent[] = [];
  for (let i = 0; i < keys.length; i += LOOKUP_CHUNK) {
    const { data, error } = await admin
      .from("idle_events")
      .select("id, samsara_event_id, started_at, created_at, event_key")
      .eq("org_id", orgId)
      .in("event_key", keys.slice(i, i + LOOKUP_CHUNK));
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as StoredEvent[]));
  }
  return out;
}

/** The row of a key group that survives: the real-UUID spelling if there is one, else the first. */
function survivorOf(group: StoredEvent[]): StoredEvent {
  return group.find((e) => !isEncodedIdleEventId(e.samsara_event_id)) ?? group[0]!;
}

/** Key every unkeyed row, delete every twin, audit what was done. */
export async function resolveIdleEventTwins(admin: SupabaseClient, orgId: string): Promise<IdleEventTwinsResult> {
  const unkeyed = await readUnkeyed(admin, orgId);
  const result: IdleEventTwinsResult = {
    unkeyed: unkeyed.length,
    keyed: 0,
    deleted: 0,
    earliestTwinStartedAt: null,
    latestTwinStartedAt: null,
    earliestTwinCreatedAt: null,
  };
  if (unkeyed.length === 0) return result;

  const groups = new Map<string, StoredEvent[]>();
  for (const e of unkeyed) {
    const k = idleEventKey(e.samsara_event_id);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  for (const e of await readKeyed(admin, orgId, [...groups.keys()])) groups.get(e.event_key!)?.push(e);

  let batchDelete: string[] = [];
  let batchKeys: { id: string; event_key: string }[] = [];
  const flush = async () => {
    if (batchDelete.length === 0 && batchKeys.length === 0) return;
    const { data, error } = await admin.rpc("resolve_idle_event_twins", {
      p_org: orgId,
      p_delete: batchDelete,
      p_keys: batchKeys,
    });
    if (error) throw new Error(error.message);
    const r = (data ?? {}) as { deleted?: number; keyed?: number };
    result.deleted += r.deleted ?? 0;
    result.keyed += r.keyed ?? 0;
    batchDelete = [];
    batchKeys = [];
  };

  for (const [key, group] of groups) {
    const keep = survivorOf(group);
    const twins = group.filter((e) => e.id !== keep.id);
    if (keep.event_key === null) batchKeys.push({ id: keep.id, event_key: key });
    if (twins.length > 0) {
      batchDelete.push(...twins.map((e) => e.id));
      for (const t of twins)
        if (result.earliestTwinCreatedAt === null || t.created_at < result.earliestTwinCreatedAt)
          result.earliestTwinCreatedAt = t.created_at;
      for (const e of group) {
        if (result.earliestTwinStartedAt === null || e.started_at < result.earliestTwinStartedAt)
          result.earliestTwinStartedAt = e.started_at;
        if (result.latestTwinStartedAt === null || e.started_at > result.latestTwinStartedAt)
          result.latestTwinStartedAt = e.started_at;
      }
    }
    if (batchDelete.length + batchKeys.length >= RPC_IDS) await flush();
  }
  await flush();

  await writeAudit(admin, {
    orgId,
    action: "idle.event_twins_removed",
    entity: "idle_events",
    meta: { ...result, reason: "Samsara sent one idling event under two id spellings (plan I0, W1)" },
  });
  return result;
}

export interface IdleEventTwinsRepair extends IdleEventTwinsResult {
  rollupDays: number | null;
  weeksRefrozen: string[];
}

/**
 * The clean-up and what it owes downstream. Deleting a twin corrects `idle_events`, but two things were
 * computed FROM the doubled rows and keep the doubling until recomputed:
 *  - `idle_rollup_days`, whose rolling window is 30 days while the twins reach back further, so the rollup
 *    is rebuilt from the earliest twinned day;
 *  - the frozen driver-performance weeks (`driver_performance_weeks`), which the owner ruled are re-frozen
 *    (2026-10-01) rather than left doubled. Only a week frozen AFTER the first twin was written, and whose
 *    window reaches a twinned event, was computed from doubled rows: week 08/10 was frozen 08/21, before
 *    any twin existed (the first arrived 09/14), and re-freezing it would restate a clean ledger row for
 *    nothing. Freezing belongs to the performance module, so the caller passes it in.
 * A pass that deleted nothing owes nothing.
 */
export async function repairIdleEventTwins(
  admin: SupabaseClient,
  orgId: string,
  deps: {
    refreeze: (span: { windowFromIso: string; settledSinceIso: string }) => Promise<string[]>;
    /** The rollup rebuild; the real one unless a test stands in for its eight-table read. */
    rollup?: (sinceDays: number) => Promise<unknown>;
    nowMs?: number;
  },
): Promise<IdleEventTwinsRepair> {
  const r = await resolveIdleEventTwins(admin, orgId);
  if (r.deleted === 0 || r.earliestTwinStartedAt === null || r.earliestTwinCreatedAt === null)
    return { ...r, rollupDays: null, weeksRefrozen: [] };
  const now = deps.nowMs ?? Date.now();
  const rollupDays = Math.ceil((now - Date.parse(r.earliestTwinStartedAt)) / DAY_MS) + 1;
  await (deps.rollup ?? ((sinceDays) => syncIdleRollup(admin, orgId, { sinceDays })))(rollupDays);
  const weeksRefrozen = await deps.refreeze({
    windowFromIso: r.earliestTwinStartedAt,
    settledSinceIso: r.earliestTwinCreatedAt,
  });
  return { ...r, rollupDays, weeksRefrozen };
}

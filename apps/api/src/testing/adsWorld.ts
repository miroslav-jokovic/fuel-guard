import { ADS_SETTINGS_UNSET, type AdsSettings, type CampaignState } from "@silvicom/shared";
import { postgrestFixture, type FixtureRow } from "./postgrestFixture.js";
import { createSupabaseRecorder, type RecordedQuery } from "./supabaseRecorder.js";

/**
 * A STATEFUL ads database for the orchestrator's tests (A6). The recorder's fixtures answer reads; the
 * orchestrator's properties are about WRITES racing each other — a compare-and-set that must lose, an
 * idempotency key that must collide, a crash between two writes — and a fixture that returns the same
 * rows whatever was written cannot show any of them.
 *
 * It holds exactly the constraints the runner leans on, as 0537 states them, and nothing else:
 *   · `ads_actions`: `unique (org_id, idempotency_key)` → 23505; a completion only from `started`;
 *   · `ads_campaigns`: an UPDATE touches the rows its filters match, so a stale `state` /
 *     `state_changed_at` matches none (the CAS).
 * Reads go through `postgrestFixture`, so filters, order and limit are applied as PostgREST would.
 * A query settles synchronously, so `Promise.all` over two runners interleaves at awaits exactly as
 * two processes interleave at round trips. Not a database: no triggers, no joins (postgrestFixture's
 * own rule) — the append-only and fence triggers are the PGlite matrix's (`ads-foundation.test.mjs`).
 *
 * `crash` makes the Nth write to a table fail as the process dying there would: the write does not
 * happen and the caller sees an error. Counted per table, consumed once.
 */

export const ORG = "00000000-0000-4000-8000-0000000000a1";
export const CONN = "00000000-0000-4000-8000-0000000000c1";
export const T0 = "2026-11-02T12:00:00.000Z";
export const ADMIN_USER = "00000000-0000-4000-8000-0000000000d1";

export const LIVE_SETTINGS: AdsSettings = {
  ...ADS_SETTINGS_UNSET,
  limits: { monthly_cap_cents: { meta: 300_000 }, daily_max_cents: 10_000, lifetime_max_cents: 150_000, max_raise_pct: 25, max_raise_cents: 5_000 },
};

export interface WorldCampaign extends FixtureRow {
  id: string;
  org_id: string;
  state: CampaignState;
  state_changed_at: string;
}

export function campaign(id: string, state: CampaignState, patch: Partial<WorldCampaign> = {}): WorldCampaign {
  return {
    id, org_id: ORG, connection_id: CONN, state, state_changed_at: T0,
    daily_budget_cents: 5_000, lifetime_cap_cents: 50_000, platform_refs: {}, last_error: null, ...patch,
  };
}

export function createAdsWorld(opts: {
  campaigns: WorldCampaign[];
  kill?: boolean;
  settings?: AdsSettings;
  approvals?: FixtureRow[];
  actions?: FixtureRow[];
  /** Spend rows (`ads_spend_hourly`) — the guard's month-to-date; the insights pull's upserts land here. */
  spend?: FixtureRow[];
  /** The org's connections (B3: a simulator row lets the real adapter run); default one bare Meta row. */
  connections?: FixtureRow[];
  /**
   * The scenario's clock (7d, `FakeClock.now`). Every reading is still strictly after the last — a
   * millisecond on when the clock has not moved — so two stamps never tie, the property the
   * transition keys and `launchThisStint`'s `started_at >= state_changed_at` lean on.
   */
  clock?: () => Date;
  /** Active members (`memberships`), for alert recipients; default one admin. */
  members?: FixtureRow[];
  /**
   * Read-only rows for tables the world does not model (B2c2: `ads_creatives`, the preset tables the
   * publisher reads). Filtered as PostgREST would, never written.
   */
  extraTables?: Record<string, FixtureRow[]>;
  /** Storage handlers by method (`download`…), passed to the recorder — the publisher reads ad images. */
  storage?: Record<string, (...args: never[]) => unknown>;
}) {
  const campaigns = opts.campaigns.map((c) => ({ ...c }));
  const actions: FixtureRow[] = (opts.actions ?? []).map((a) => ({ ...a }));
  // Mutable on purpose (7d): a golden scenario presses the switch or saves new settings mid-run, and
  // each save is a new version, as `saveSettingsVersion` makes one.
  const settings = { kill: opts.kill ?? false, value: opts.settings ?? LIVE_SETTINGS, version: 1 };
  const approvals: FixtureRow[] = (opts.approvals ?? []).map((a) => ({ ...a }));
  const spend: FixtureRow[] = (opts.spend ?? []).map((r) => ({ ...r }));
  const connections: FixtureRow[] = (opts.connections ?? [{ id: CONN, org_id: ORG, provider: "meta" }]).map((c) => ({ ...c }));
  const members: FixtureRow[] = (opts.members ?? [{ org_id: ORG, user_id: ADMIN_USER, role: "admin", suspended_at: null }]).map((m) => ({ ...m }));
  // The bell as `emit_notification` keeps it: one row per (user, dedupe key), a repeat returns no id.
  const bell: Array<{ user: string; category: string; title: string; severity: string; dedupe: string | null }> = [];
  const crashes = new Map<string, number[]>();
  const writes = new Map<string, number>();
  let seq = actions.length;
  // A monotonic clock: every reading is one second after the last, so stamps never tie. With a
  // scenario clock, its reading — or one millisecond after the last, when it has not moved.
  let tick = 0;
  let last = 0;
  const now = opts.clock
    ? () => new Date((last = Math.max(opts.clock!().getTime(), last + 1)))
    : () => new Date(Date.parse(T0) + 1000 * ++tick);

  const crashed = (table: string): boolean => {
    const n = (writes.get(table) ?? 0) + 1;
    writes.set(table, n);
    const at = crashes.get(table) ?? [];
    if (!at.includes(n)) return false;
    crashes.set(table, at.filter((x) => x !== n));
    return true;
  };
  const dead = { data: null, error: { message: "connection terminated (injected crash)" }, writeError: { message: "connection terminated (injected crash)" } };
  const matching = <R extends FixtureRow>(rows: R[], q: RecordedQuery): R[] =>
    rows.filter((r) => postgrestFixture([{ ...r }])({ ...q, ops: q.ops.filter((o) => o.method !== "select" && o.method !== "limit") }).length > 0);

  const rec = createSupabaseRecorder({
    tables: {
      ads_campaigns: (q) => {
        if (q.write?.method === "update") {
          if (crashed("ads_campaigns")) return dead;
          const hit = matching(campaigns, q);
          for (const c of hit) Object.assign(c, q.write.payload as object);
          return hit.map((c) => ({ id: c.id }));
        }
        return postgrestFixture(campaigns)(q);
      },
      ads_actions: (q) => {
        if (q.write?.method === "insert") {
          if (crashed("ads_actions")) return dead;
          const row = { ...(q.write.payload as FixtureRow) };
          if (row.idempotency_key != null && actions.some((a) => a.org_id === row.org_id && a.idempotency_key === row.idempotency_key)) {
            const dup = { code: "23505", message: "duplicate key value violates unique constraint" };
            return { data: null, error: dup, writeError: dup };
          }
          const stored = { id: `act-${++seq}`, platform_refs: null, response: null, error_code: null, approval_id: null, ...row };
          actions.push(stored);
          return [{ id: stored.id }];
        }
        if (q.write?.method === "update") {
          if (crashed("ads_actions")) return dead;
          for (const a of matching(actions, q)) Object.assign(a, q.write.payload as object);
          return [];
        }
        return postgrestFixture(actions)(q);
      },
      ads_settings_versions: () => [{
        id: `set-${settings.version}`, version: settings.version, settings: settings.value, kill_switch: settings.kill,
        kill_reason: settings.kill ? "owner pressed it" : null, created_at: T0, created_by_name: "Owner",
      }],
      ads_approvals: postgrestFixture(approvals),
      ads_platform_connections: (q) => {
        if (q.write?.method === "update") {
          const hit = matching(connections, q);
          for (const c of hit) Object.assign(c, q.write.payload as object);
          return hit.map((c) => ({ id: c.id }));
        }
        return postgrestFixture(connections)(q);
      },
      memberships: postgrestFixture(members),
      ads_spend_hourly: (q) => {
        // As PostgREST applies the pull's upsert: one row per (campaign, hour), the newest write replacing the
        // last, unless the call asked to skip duplicates (the one option that would keep a revised hour stale).
        if (q.write?.method === "upsert") {
          const skip = (q.ops.find((o) => o.method === "upsert")?.args[1] as { ignoreDuplicates?: boolean } | undefined)?.ignoreDuplicates === true;
          for (const row of ([] as FixtureRow[]).concat(q.write.payload as FixtureRow[])) {
            const at = spend.findIndex((r) => r.campaign_id === row.campaign_id && Date.parse(String(r.hour)) === Date.parse(String(row.hour)));
            if (at < 0) spend.push({ ...row });
            else if (!skip) spend[at] = { ...row };
          }
          return [];
        }
        return postgrestFixture(spend)(q);
      },
      ...Object.fromEntries(Object.entries(opts.extraTables ?? {}).map(([t, rows]) => [t, postgrestFixture(rows.map((r) => ({ ...r })))])),
    },
    ...(opts.storage ? { storage: opts.storage as Record<string, (...args: unknown[]) => unknown> } : {}),
    rpc: (fn, args) => {
      if (fn !== "emit_notification") return null;
      const a = args as { p_user: string; p_category: string; p_title: string; p_severity: string; p_dedupe_key: string | null };
      if (a.p_dedupe_key && bell.some((b) => b.user === a.p_user && b.dedupe === a.p_dedupe_key)) return null;
      bell.push({ user: a.p_user, category: a.p_category, title: a.p_title, severity: a.p_severity, dedupe: a.p_dedupe_key });
      return `ntf-${bell.length}`;
    },
  });

  return {
    rec,
    admin: rec.client,
    now,
    campaigns,
    actions,
    settings,
    approvals,
    spend,
    connections,
    /** What reached the bell (after `emit_notification`'s dedupe). */
    bell,
    /** A new settings version in force from the next read (the owner saved). */
    saveSettings(value: AdsSettings) {
      settings.value = value;
      settings.version += 1;
    },
    /** Writes so far to `table` (the crash sweep counts a clean run's, then crashes at each). */
    writesTo: (table: "ads_campaigns" | "ads_actions") => writes.get(table) ?? 0,
    byId: (id: string) => campaigns.find((c) => c.id === id)!,
    transitions: (id?: string) => actions.filter((a) => a.kind === "transition" && (!id || a.campaign_id === id)),
    /** The Nth write (1-based, counted from now) to `table` fails as a crash there would. */
    crashOnWrite(table: "ads_campaigns" | "ads_actions", nth = 1) {
      const base = writes.get(table) ?? 0;
      crashes.set(table, [...(crashes.get(table) ?? []), base + nth]);
    },
  };
}

export type AdsWorld = ReturnType<typeof createAdsWorld>;

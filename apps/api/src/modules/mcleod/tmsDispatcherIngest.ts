import type { SupabaseClient } from "@supabase/supabase-js";
import type { TmsDispatcherInput } from "@silvicom/shared";

/**
 * The TMS's dispatcher roster → `tms_dispatchers` (LOADS-GO-LIVE-PLAN.md L4, LIVE-MAP-PLAN.md LM3).
 *
 * Who EXISTS in the TMS, not who owns what: ownership rides on each load as
 * `loads.dispatcher_external_id`, written by `ingestLoads`. This table is what turns that key into a
 * name on the board, and — once an office maps one (LM11) — into a Silvicom person.
 *
 * ⚠ `user_id` IS NEVER IN THE ROW, and that absence is the whole contract of this file (D-LM4). The
 * link between a McLeod account and a Silvicom user is an office act. PostgREST's upsert compiles to
 * `INSERT … ON CONFLICT DO UPDATE SET <the columns sent>`, so a column the row does not carry is a
 * column the re-sync cannot touch — and a `user_id: null` here would silently unlink, on the next
 * poll, every person an admin had mapped. Pinned by "a re-sync never carries user_id, so an office's
 * link survives it"; adding the key fails that test.
 *
 * The row is otherwise COMPLETE (`lint:upserts`): every NOT NULL column without a default —
 * `org_id`, `provider`, `external_id` — plus `is_system` and `is_active`, which have defaults but are
 * always sent, because a default on the insert branch would be a fact the feed never stated.
 * `created_at` is left to its default on insert and, being absent, is never rewritten on conflict.
 *
 * `is_system` is taken as sent. The agent decides it from `MCLEOD_SYSTEM_DISPATCHERS` (loadmaster,
 * lmeadm); this side never infers it from a display name, because the carrier can rename an account
 * and a rule that reads names would start filing a person's loads under a robot.
 *
 * Not evidence and not append-only: a dispatcher row is current state, re-derivable from McLeod on
 * the next sweep (see 0344's header).
 */
export interface DispatcherIngestResult {
  received: number;
  upserted: number;
}

export async function ingestDispatchers(
  admin: SupabaseClient,
  orgId: string,
  provider: string,
  dispatchers: TmsDispatcherInput[],
): Promise<DispatcherIngestResult> {
  if (dispatchers.length === 0) return { received: 0, upserted: 0 };

  // One row per account even if the feed repeats one: Postgres refuses an ON CONFLICT batch that
  // names the same key twice ("cannot affect row a second time"), so a duplicate would fail the
  // whole roster rather than one line of it. Last one wins, as it would across two polls.
  const byId = new Map<string, TmsDispatcherInput>();
  for (const d of dispatchers) byId.set(d.external_id, d);

  const syncedAt = new Date().toISOString();
  const rows = [...byId.values()].map((d) => ({
    org_id: orgId,
    provider,
    external_id: d.external_id,
    // Absent is not the empty string (the D-LM12 lesson): the schema trims, so a blank name arrives
    // as "" and is stored as null.
    display_name: d.display_name ? d.display_name : null,
    is_system: d.is_system,
    is_active: d.is_active,
    updated_at: syncedAt,
  }));

  const { error } = await admin
    .from("tms_dispatchers")
    .upsert(rows, { onConflict: "org_id,provider,external_id" });
  if (error) throw new Error(`[tms-dispatchers] ${rows.length} dispatcher(s) not recorded: ${error.message}`);
  return { received: dispatchers.length, upserted: rows.length };
}

/**
 * The dispatcher ids this org already knows, for reporting a load whose dispatcher has not arrived.
 *
 * Reported, never refused: `loads.dispatcher_external_id` deliberately has no foreign key (0344), so
 * one account the roster has not carried yet cannot fail a whole board. It just gets said out loud,
 * the way an unmatched driver code is.
 */
export async function knownDispatcherIds(
  admin: SupabaseClient,
  orgId: string,
  provider: string,
): Promise<Set<string>> {
  const { data } = await admin
    .from("tms_dispatchers")
    .select("external_id")
    .eq("org_id", orgId)
    .eq("provider", provider);
  return new Set(((data ?? []) as { external_id: string }[]).map((r) => r.external_id));
}

/**
 * Dispatcher display names for the loads that name them (LOADS-MIRROR-PLAN.md LR7, the board's
 * Dispatcher column).
 *
 * `tms_dispatchers` is this collector's raw table, so `loads` asks here rather than reading it
 * (D-SEP1, `lint:table-access`). Keyed `provider:external_id`, because the roster is keyed on both and
 * two TMSs may reuse an id. An id the roster has not carried yet is simply absent — the board shows
 * the McLeod id rather than nothing, the same "say it out loud" rule as `knownDispatcherIds`.
 */
export async function readDispatcherNames(
  admin: SupabaseClient,
  orgId: string,
  refs: { provider: string; externalId: string }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byProvider = new Map<string, Set<string>>();
  for (const r of refs) {
    if (!r.provider || !r.externalId) continue;
    const ids = byProvider.get(r.provider) ?? new Set<string>();
    ids.add(r.externalId);
    byProvider.set(r.provider, ids);
  }
  for (const [provider, ids] of byProvider) {
    const { data, error } = await admin
      .from("tms_dispatchers")
      .select("external_id, display_name")
      .eq("org_id", orgId)
      .eq("provider", provider)
      .in("external_id", [...ids]);
    if (error) throw new Error(error.message);
    for (const d of (data ?? []) as { external_id: string; display_name: string | null }[]) {
      if (d.display_name) out.set(`${provider}:${d.external_id}`, d.display_name);
    }
  }
  return out;
}

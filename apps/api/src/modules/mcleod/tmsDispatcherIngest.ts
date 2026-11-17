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
 * Add the McLeod logins another feed names that the roster has never carried — INSERT OR SKIP, never
 * an update (LUMPER-REVISED-RC-PLAN Q-LRC5, 2026-11-17).
 *
 * The roster above is read from the open board's movements, so a login that runs orders but is not on
 * today's board never arrives. Measured on LME that day: `roman` ("ROMAN", 377 orders in 90 days) and
 * `jake` (30) are the order's `operations_user` on lumper cases and are absent here, while `romann` —
 * a different McLeod user — is present; so their cases could not be linked to anybody on Settings ›
 * McLeod fleets. The lumper sweep carries each order's `operations_user` and its name; this adds the
 * missing ones so the office (or `autoLinkDispatchers`) can link them.
 *
 * `ignoreDuplicates`: a login the roster already holds is not touched at all — not its name, not its
 * `is_system`, not its link — so this cannot fight the roster's own upsert. The row is complete for
 * the insert (`lint:upserts`). `is_system` is false because only the agent decides system accounts
 * (`MCLEOD_SYSTEM_DISPATCHERS`), and the two it names (loadmaster, lmeadm) are already held here; the
 * roster's next sweep corrects any row it carries.
 */
export async function addUnknownDispatchers(
  admin: SupabaseClient,
  orgId: string,
  provider: string,
  seen: readonly { external_id: string | null; display_name: string | null }[],
): Promise<number> {
  const byId = new Map<string, string | null>();
  for (const d of seen) if (d.external_id && d.external_id.trim()) byId.set(d.external_id.trim(), d.display_name?.trim() || null);
  if (byId.size === 0) return 0;
  // Its own read, and a failed one THROWS: read as "none known", every login would be offered again.
  // (`knownDispatcherIds` below answers empty on a failed read, which is right for its reporting use.)
  const { data: have, error: readErr } = await admin.from("tms_dispatchers").select("external_id").eq("org_id", orgId).eq("provider", provider);
  if (readErr) throw new Error(`[tms-dispatchers] not read: ${readErr.message}`);
  const known = new Set(((have ?? []) as { external_id: string }[]).map((r) => r.external_id));
  const rows = [...byId]
    .filter(([id]) => !known.has(id))
    .map(([external_id, display_name]) => ({ org_id: orgId, provider, external_id, display_name, is_system: false, is_active: true, updated_at: new Date().toISOString() }));
  if (rows.length === 0) return 0;
  const { error } = await admin.from("tms_dispatchers").upsert(rows, { onConflict: "org_id,provider,external_id", ignoreDuplicates: true });
  if (error) throw new Error(`[tms-dispatchers] ${rows.length} unknown dispatcher(s) not added: ${error.message}`);
  return rows.length;
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

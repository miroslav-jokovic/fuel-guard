import type { SupabaseClient } from "@supabase/supabase-js";
import type { DispatchScope } from "@silvicom/shared";

/**
 * Whose fleet is whose (DISPATCH-BOARD-PLAN DB2, D-DB3): two links an office confirms, and the scope
 * they add up to.
 *
 *   fleet code ('VINNIEV')  →  McLeod login ('vinniev')   `tms_fleets.dispatcher_external_id` (0450)
 *   McLeod login ('vinniev') →  our user                  `tms_dispatchers.user_id` (0344, LM11)
 *
 * Both are office acts and the feed never writes either (D-LM4): a re-sync that relinked a person
 * would silently move a dispatcher's whole board. "My fleet" is DERIVED from the two at request time
 * and stored nowhere — a third copy of who-runs-what would drift from these the first day someone
 * changed one.
 *
 * Both tables are layer=raw and sealed to mcleod (`check-table-access.mjs`), so every reader and
 * writer of them is here. Service role: the `.eq("org_id", …)` on every statement is the tenant boundary.
 */
export const DISPATCH_PROVIDER = "mcleod";

export interface DispatchLinks {
  scope: DispatchScope;
  fleets: Array<{ code: string; dispatcherId: string | null }>;
  dispatchers: Array<{ id: string; name: string | null; isSystem: boolean; isActive: boolean; userId: string | null }>;
}

export async function readDispatchLinks(admin: SupabaseClient, orgId: string, userId: string): Promise<DispatchLinks> {
  const { data: dData, error: dErr } = await admin
    .from("tms_dispatchers")
    .select("external_id, display_name, is_system, is_active, user_id")
    .eq("org_id", orgId)
    .eq("provider", DISPATCH_PROVIDER);
  if (dErr) throw new Error(dErr.message);
  const dispatchers = ((dData ?? []) as Array<{
    external_id: string; display_name: string | null; is_system: boolean; is_active: boolean; user_id: string | null;
  }>)
    .map((d) => ({ id: d.external_id, name: d.display_name, isSystem: d.is_system, isActive: d.is_active, userId: d.user_id }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const { data: fData, error: fErr } = await admin
    .from("tms_fleets")
    .select("code, dispatcher_external_id")
    .eq("org_id", orgId)
    .eq("provider", DISPATCH_PROVIDER);
  if (fErr) throw new Error(fErr.message);
  const fleets = ((fData ?? []) as Array<{ code: string; dispatcher_external_id: string | null }>)
    .map((f) => ({ code: f.code, dispatcherId: f.dispatcher_external_id }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const dispatcherIds = dispatchers.filter((d) => d.userId === userId).map((d) => d.id);
  const fleetCodes = fleets.filter((f) => f.dispatcherId && dispatcherIds.includes(f.dispatcherId)).map((f) => f.code);
  return { scope: { linked: dispatcherIds.length > 0, fleetCodes, dispatcherIds }, fleets, dispatchers };
}

export type LinkWrite = { ok: true } | { ok: false; status: 404; code: string; message: string };

/** Has McLeod sent this fleet code? Literal table names, so every table gate can see the read. */
async function fleetExists(admin: SupabaseClient, orgId: string, code: string): Promise<boolean> {
  const { data, error } = await admin
    .from("tms_fleets")
    .select("code")
    .eq("org_id", orgId)
    .eq("provider", DISPATCH_PROVIDER)
    .eq("code", code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data != null;
}

/** Has McLeod sent this dispatcher login? */
async function dispatcherExists(admin: SupabaseClient, orgId: string, id: string): Promise<boolean> {
  const { data, error } = await admin
    .from("tms_dispatchers")
    .select("external_id")
    .eq("org_id", orgId)
    .eq("provider", DISPATCH_PROVIDER)
    .eq("external_id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data != null;
}

/** Link a fleet code to the McLeod login that runs it, or unlink it (null). Both must already exist. */
export async function linkFleet(
  admin: SupabaseClient,
  orgId: string,
  code: string,
  dispatcherId: string | null,
  actorId: string,
  now: Date = new Date(),
): Promise<LinkWrite> {
  if (!(await fleetExists(admin, orgId, code)))
    return { ok: false, status: 404, code: "unknown_fleet", message: `McLeod has sent no fleet "${code}"` };
  if (dispatcherId && !(await dispatcherExists(admin, orgId, dispatcherId)))
    return { ok: false, status: 404, code: "unknown_dispatcher", message: `McLeod has sent no dispatcher "${dispatcherId}"` };
  const at = now.toISOString();
  const { error } = await admin
    .from("tms_fleets")
    .update({
      dispatcher_external_id: dispatcherId,
      linked_by: dispatcherId ? actorId : null,
      linked_at: dispatcherId ? at : null,
      updated_at: at,
    })
    .eq("org_id", orgId)
    .eq("provider", DISPATCH_PROVIDER)
    .eq("code", code);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/**
 * Link a McLeod login to one of our users, or unlink it (null). The caller has already checked the
 * user is a member of THIS org (org's `lookupMemberRole`) — a link to a stranger is refused there.
 */
export async function linkDispatcherUser(
  admin: SupabaseClient,
  orgId: string,
  dispatcherId: string,
  userId: string | null,
  now: Date = new Date(),
): Promise<LinkWrite> {
  if (!(await dispatcherExists(admin, orgId, dispatcherId)))
    return { ok: false, status: 404, code: "unknown_dispatcher", message: `McLeod has sent no dispatcher "${dispatcherId}"` };
  const { error } = await admin
    .from("tms_dispatchers")
    .update({ user_id: userId, updated_at: now.toISOString() })
    .eq("org_id", orgId)
    .eq("provider", DISPATCH_PROVIDER)
    .eq("external_id", dispatcherId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

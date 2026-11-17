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
  const { fleets, dispatchers } = await readFleetDispatchers(admin, orgId);
  const dispatcherIds = dispatchers.filter((d) => d.userId === userId).map((d) => d.id);
  const fleetCodes = fleets.filter((f) => f.dispatcherId && dispatcherIds.includes(f.dispatcherId)).map((f) => f.code);
  return { scope: { linked: dispatcherIds.length > 0, fleetCodes, dispatcherIds }, fleets, dispatchers };
}

/**
 * The two link tables without a caller's scope — for a reader that asks "whose fleet is this truck in?"
 * about somebody else's driver (Safety's random-draw list, MEDSTOP-PLAN §7A.19), not "which are mine?".
 */
export async function readFleetDispatchers(
  admin: SupabaseClient,
  orgId: string,
): Promise<Pick<DispatchLinks, "fleets" | "dispatchers">> {
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
  return { fleets, dispatchers };
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
 *
 * The office's word is final both ways (0626): an UNLINK of a linked login leaves a hold, so the
 * automatic linker below never puts it back; a LINK by hand releases any hold on the login.
 */
export async function linkDispatcherUser(
  admin: SupabaseClient,
  orgId: string,
  dispatcherId: string,
  userId: string | null,
  now: Date = new Date(),
  actorId: string | null = null,
): Promise<LinkWrite> {
  if (!(await dispatcherExists(admin, orgId, dispatcherId)))
    return { ok: false, status: 404, code: "unknown_dispatcher", message: `McLeod has sent no dispatcher "${dispatcherId}"` };
  const { data: before, error: readErr } = await admin
    .from("tms_dispatchers")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("provider", DISPATCH_PROVIDER)
    .eq("external_id", dispatcherId)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  const was = (before as { user_id: string | null } | null)?.user_id ?? null;

  if (userId === null && was !== null) {
    // The hold FIRST: if it cannot be written, the link stays and the office sees the error, rather
    // than an unlink the next automatic pass would quietly undo.
    const { error: holdErr } = await admin.from("tms_dispatcher_link_holds").upsert(
      { org_id: orgId, provider: DISPATCH_PROVIDER, external_id: dispatcherId, user_id: was, held_by: actorId, held_at: now.toISOString() },
      { onConflict: "org_id,provider,external_id" },
    );
    if (holdErr) throw new Error(`tms_dispatcher_link_holds: ${holdErr.message}`);
  }

  const { error } = await admin
    .from("tms_dispatchers")
    .update({ user_id: userId, updated_at: now.toISOString() })
    .eq("org_id", orgId)
    .eq("provider", DISPATCH_PROVIDER)
    .eq("external_id", dispatcherId);
  if (error) throw new Error(error.message);

  if (userId !== null) {
    const { error: releaseErr } = await admin
      .from("tms_dispatcher_link_holds")
      .delete()
      .eq("org_id", orgId)
      .eq("provider", DISPATCH_PROVIDER)
      .eq("external_id", dispatcherId);
    if (releaseErr) throw new Error(`tms_dispatcher_link_holds: ${releaseErr.message}`);
  }
  return { ok: true };
}

export interface AutoLink {
  dispatcherId: string;
  userId: string;
}

/** The part of an email address before the @, lower-cased; null for anything that is not an address. */
const loginOf = (email: string | null): string | null => {
  const at = (email ?? "").trim().toLowerCase().split("@");
  return at.length === 2 && at[0] && at[1] ? at[0] : null;
};

/**
 * Which McLeod logins to link to which person, from proof only — pure, so every rule below is a test.
 *
 * A login is linked when ALL of these hold:
 *  · it is a person's login (not `is_system`), active, and linked to nobody;
 *  · the office has not unlinked it (no hold, 0626);
 *  · exactly ONE active office member's login email has, before the @, exactly the McLeod login
 *    (`steve` ↔ steve@silvicominc.com), compared without case;
 *  · that member is linked to no other McLeod login, and no other login in this pass picks them.
 * Anything less is left for a person: two members called steve@ at two domains, a member who already
 * holds a login, a name that only looks alike ("asen" and "Asen Manager" <alex@…>). A wrong link sends
 * one dispatcher's reminders and board to somebody else; a missing link costs one manual pick.
 */
export function planAutoLinks(
  dispatchers: readonly Pick<DispatchLinks["dispatchers"][number], "id" | "isSystem" | "isActive" | "userId">[],
  members: readonly { userId: string; email: string | null; role: string }[],
  held: ReadonlySet<string>,
): AutoLink[] {
  const taken = new Set(dispatchers.map((d) => d.userId).filter((u): u is string => u !== null));
  const byLogin = new Map<string, string[]>();
  for (const m of members) {
    const login = loginOf(m.email);
    if (login) byLogin.set(login, [...(byLogin.get(login) ?? []), m.userId]);
  }
  const wanted = new Map<string, string[]>(); // userId → logins that would pick them
  for (const d of dispatchers) {
    if (d.isSystem || !d.isActive || d.userId !== null || held.has(d.id)) continue;
    const found = byLogin.get(d.id.trim().toLowerCase()) ?? [];
    if (found.length !== 1 || taken.has(found[0]!)) continue;
    wanted.set(found[0]!, [...(wanted.get(found[0]!) ?? []), d.id]);
  }
  return [...wanted].filter(([, logins]) => logins.length === 1).map(([userId, [dispatcherId]]) => ({ dispatcherId: dispatcherId!, userId }));
}

/**
 * Make the links `planAutoLinks` proves, for one org. Each write only fills an EMPTY link
 * (`user_id is null`), so an office link made a moment earlier is never overwritten. Returns what was
 * linked, for the caller's audit rows and log. A failed read throws: nothing is linked on half the facts.
 */
export async function autoLinkDispatchers(
  admin: SupabaseClient,
  orgId: string,
  members: readonly { userId: string; email: string | null; role: string }[],
  now: Date = new Date(),
): Promise<AutoLink[]> {
  const [{ dispatchers }, holds] = await Promise.all([
    readFleetDispatchers(admin, orgId),
    admin.from("tms_dispatcher_link_holds").select("external_id").eq("org_id", orgId).eq("provider", DISPATCH_PROVIDER),
  ]);
  if (holds.error) throw new Error(`tms_dispatcher_link_holds: ${holds.error.message}`);
  const held = new Set(((holds.data ?? []) as { external_id: string }[]).map((h) => h.external_id));
  const made: AutoLink[] = [];
  for (const link of planAutoLinks(dispatchers, members, held)) {
    const { data, error } = await admin
      .from("tms_dispatchers")
      .update({ user_id: link.userId, updated_at: now.toISOString() })
      .eq("org_id", orgId)
      .eq("provider", DISPATCH_PROVIDER)
      .eq("external_id", link.dispatcherId)
      .is("user_id", null)
      .select("external_id");
    if (error) throw new Error(error.message);
    if ((data ?? []).length === 1) made.push(link);
  }
  return made;
}

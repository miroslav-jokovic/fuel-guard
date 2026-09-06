import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CASE_RULE_ID,
  rolesAssignableIn,
  rolesThatManageFinding,
  sectionOfFinding,
  type FindingKind,
  type FindingSource,
  type UserRole,
} from "@silvicom/shared";
import { assignAnomalies } from "../anomalies/index.js";

/**
 * Giving a finding an owner — the one act both case tables genuinely share (C7b merge 3).
 *
 * ── WHY ASSIGNMENT AND NOT CLOSING ──────────────────────────────────────────────────────────────
 * D-FUI7 unifies the QUEUE axis and leaves each source its own close: an anomaly closes with a
 * disposition, an exception with money, and no single verb can mean both. Assignment is the exception
 * to that — "this is yours" means exactly one thing on either table — so it is the act that belongs
 * in a shared inbox, and closing stays behind each source's own affordance.
 *
 * ⚠ It is also the only BULK act offered, and that is a decision rather than a scope cut. Bulk
 * closing a queue whose post-ruling precision nobody has measured would manufacture ground truth for
 * the accuracy programme out of one careless click — 82 cases dispositioned in a gesture, feeding the
 * same precision figure C7 is gated on. Assigning forty findings to somebody is reversible and
 * decides nothing.
 *
 * ── THE GATE IS THE FINDING'S OWN SECTION ───────────────────────────────────────────────────────
 * `rolesThatManageFinding` (Q-FUI4), so a safety manager may assign a theft case and not a policy
 * premium, and a dispatcher — `fuel: "view"` — may assign neither. The caller's claim about which
 * table a row lives in is NOT trusted: every id is read back, org-scoped, and its kind comes from the
 * row rather than from the request.
 */

/** Bounded so one request cannot walk a whole ledger; the page pages at 25. */
export const MAX_ASSIGN_BATCH = 200;

export interface FindingRef {
  source: FindingSource;
  id: string;
}

export type AssignResult =
  | { ok: true; assigned: number }
  | { ok: false; code: "not_found" | "forbidden" | "bad_assignee" | "too_many"; message: string };

interface Resolved {
  ref: FindingRef;
  kind: FindingKind;
}

/**
 * Assign, or refuse the whole batch.
 *
 * ⚠ ALL OR NOTHING, deliberately. A partial success — "38 of 40 assigned" — is the shape where
 * somebody believes they cleared a queue and two findings sit unowned with nothing on screen saying
 * which. Refusing names the count and the reason, and the caller narrows their selection.
 */
export async function assignFindings(
  admin: SupabaseClient,
  orgId: string,
  actorId: string | null,
  role: UserRole | null | undefined,
  assignee: string | null,
  refs: FindingRef[],
): Promise<AssignResult> {
  if (refs.length === 0) return { ok: true, assigned: 0 };
  if (refs.length > MAX_ASSIGN_BATCH) {
    return { ok: false, code: "too_many", message: `Assign at most ${MAX_ASSIGN_BATCH} findings at once.` };
  }

  const resolved = await resolveKinds(admin, orgId, refs);
  if (resolved.length !== refs.length) {
    // An id that resolves to nothing is either gone or another org's. Both are "not yours".
    return { ok: false, code: "not_found", message: "Some of those findings are no longer in your queue." };
  }

  const sections = new Set(resolved.map((r) => sectionOfFinding(r.kind)));
  const refused = resolved.filter((r) => !rolesThatManageFinding(r.kind).includes(role as UserRole));
  if (refused.length > 0) {
    return {
      ok: false,
      code: "forbidden",
      message: `You cannot assign ${refused.length} of those findings. Narrow the selection to the ones you work.`,
    };
  }

  /*
   * The assignee must be able to CLOSE what they are being given.
   *
   * This is the identity the picker was built on (Q-FUI15): the candidate list is the same set as the
   * write gate, because offering somebody who could not then close it is a menu whose only product is
   * a stuck finding. Enforced here as well as offered there, because a picker is a convenience and an
   * API is a contract — and a mixed selection can span two sections whose manage sets differ.
   */
  if (assignee) {
    const assigneeRole = await roleOf(admin, orgId, assignee);
    const canTakeAll = assigneeRole != null && [...sections].every((s) => rolesAssignableIn(s).includes(assigneeRole));
    if (!canTakeAll) {
      return {
        ok: false,
        code: "bad_assignee",
        message: "That person cannot close every finding in this selection, so it would sit with them unresolvable.",
      };
    }
  }

  const exceptionIds = resolved.filter((r) => r.ref.source === "exception").map((r) => r.ref.id);
  const anomalyIds = resolved.filter((r) => r.ref.source === "anomaly").map((r) => r.ref.id);

  /*
   * Two literal writes rather than a loop over a table name.
   *
   * `admin.from(table)` reads better and is invisible to `check-table-access` — every table gate in
   * this repo greps for the literal, so a dynamic name is a write no gate can see. The duplication is
   * the price of staying countable, and `lint:boundaries` refused the loop before this comment
   * existed. Both are set-based UPDATEs, org-scoped AGAIN at the write: the read that authorised
   * these ids and the write that acts on them are two statements, and the second must not inherit
   * the first's scope on trust.
   */
  if (exceptionIds.length > 0) {
    const { error } = await admin
      .from("fuel_exceptions")
      .update({ assigned_to: assignee })
      .eq("org_id", orgId)
      .in("id", exceptionIds);
    if (error) return { ok: false, code: "not_found", message: "Could not assign those findings." };
  }
  // Through the anomalies module's own interface: `anomalies` is its table and this would have been
  // the first write from outside it. `lint:table-writers` refused the direct update, which is the
  // same instruction that sent the fuel sweep's stamp through `markFuelSweepComplete`.
  if (anomalyIds.length > 0) {
    const { ok } = await assignAnomalies(admin, orgId, anomalyIds, assignee);
    if (!ok) return { ok: false, code: "not_found", message: "Could not assign those findings." };
  }
  void actorId;
  return { ok: true, assigned: resolved.length };
}

/** Each id's kind, read from its own row — never taken from the request. */
async function resolveKinds(admin: SupabaseClient, orgId: string, refs: FindingRef[]): Promise<Resolved[]> {
  const exceptionIds = refs.filter((r) => r.source === "exception").map((r) => r.id);
  const anomalyIds = refs.filter((r) => r.source === "anomaly").map((r) => r.id);

  const [exceptions, anomalies] = await Promise.all([
    exceptionIds.length
      ? admin.from("fuel_exceptions").select("id, kind").eq("org_id", orgId).in("id", exceptionIds)
      : Promise.resolve({ data: [] }),
    anomalyIds.length
      ? admin.from("anomalies").select("id").eq("org_id", orgId).in("id", anomalyIds)
      : Promise.resolve({ data: [] }),
  ]);

  const out: Resolved[] = [];
  for (const row of ((exceptions.data ?? []) as { id: string; kind: FindingKind }[])) {
    out.push({ ref: { source: "exception", id: row.id }, kind: row.kind });
  }
  for (const row of ((anomalies.data ?? []) as { id: string }[])) {
    // The anomaly feed has exactly one kind and expresses it by being the anomaly feed.
    out.push({ ref: { source: "anomaly", id: row.id }, kind: CASE_RULE_ID as FindingKind });
  }
  return out;
}

/** The assignee's role in THIS org — a membership elsewhere is not one here. */
async function roleOf(admin: SupabaseClient, orgId: string, userId: string): Promise<UserRole | null> {
  const { data } = await admin
    .from("memberships")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  return ((data as { role?: UserRole } | null)?.role) ?? null;
}

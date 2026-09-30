import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError } from "../../lib/http.js";
import { forgetMembership } from "../../middleware/membershipCurrent.js";

/**
 * The API's half of SP8 (SETTINGS-PERMISSIONS-PLAN §4b, Q-SET7 (a)): every change to who may do what
 * is ONE call to a function migration 0395 wrote, which reads the before-state under a row lock, makes
 * the change and inserts the audit row in the same transaction. Before it, each write was a delete, an
 * insert and a `writeAudit()` whose `false` nobody read — so a failure between them could leave a
 * change nobody could account for, or an audit row for a change that never landed.
 *
 * Shared by `routes/sectionAccess.ts`, `routes/surfaceAccess.ts`, `routes/members.ts` and
 * `routes/invites.ts`, so the error codes each function raises are named once and each route maps
 * them to the same answer.
 */

/** 0392/0393's deferred trigger: the write would leave the organisation with no active admin. */
export const LAST_ADMIN_REFUSED = "AM010";
/** 0395's invite_delete / invite_reissue: the invite's status does not allow the act (re-checked under lock). */
export const INVITE_STATUS_REFUSED = "AM020";
/** Postgres unique_violation — invite_create's duplicate (org_id, email). */
export const UNIQUE_VIOLATION = "23505";

export const lastAdminError = () =>
  apiError("last_admin", "This is the only admin — promote someone else to admin first.");

export function errorCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

/** The four access tables `write_access_cell` accepts (0395 refuses any other name with 22023). */
export type AccessTable = "org_section_access" | "user_section_access" | "org_role_surface_access" | "user_surface_access";

export interface AccessCellWrite {
  table: AccessTable;
  orgId: string;
  /** The role layer's subject; null on a per-person table. */
  role: string | null;
  /** The person layer's subject; null on a per-role table. */
  userId: string | null;
  key: string;
  /**
   * The stored value, or null to REMOVE the row — D-PERM4's "back to the default" at the role layer and
   * "follow the role" at the person layer. Screens are booleans in the table and travel as "true"/"false"
   * here, because the function takes one text parameter for both kinds and casts it to the column's type.
   */
  value: string | null;
  actorId: string;
  action: string;
  /** The route's own audit meta; the function merges `from` and `to` into it. */
  meta: Record<string, unknown>;
}

/**
 * Write one access cell and its audit row, atomically. `false` means nothing changed and nothing was
 * recorded — the route answers 500 and never reports a success the database did not commit.
 */
export async function writeAccessCell(admin: SupabaseClient, w: AccessCellWrite): Promise<boolean> {
  const { error } = await admin.rpc("write_access_cell", {
    p_table: w.table,
    p_org_id: w.orgId,
    p_role: w.role,
    p_user_id: w.userId,
    p_key: w.key,
    p_value: w.value,
    p_actor: w.actorId,
    p_action: w.action,
    p_meta: w.meta,
  });
  if (error) {
    console.error(`[access] write_access_cell ${w.table} failed: ${(error as { message?: string }).message ?? "unknown"}`);
    return false;
  }
  return true;
}

/**
 * End a person's sessions after their access was taken away or changed (Q-SET6 (a): remove, revoke,
 * demote and suspend take effect immediately, not at the next token refresh).
 *
 * Two halves, both needed:
 *   · `revoke_user_sessions` (0363) deletes their refresh sessions, so the next refresh fails and the
 *     web signs them out.
 *   · `forgetMembership` drops THIS process's cached "current" answer (membershipCurrent.ts), so the
 *     access token they already hold is refused here on its next request rather than up to 15 s later.
 *     The other service's cache expires on its own within that window.
 *
 * ⚠ A failure of the first half is LOGGED, not returned. By the time this runs the membership change
 * has committed together with its audit row, and the membership check already refuses the person's
 * token on every request — the sessions outliving it only means a refresh that mints a token the API
 * then refuses (or, for a suspension, a token with no org at all). Answering the admin with an error
 * for a change that did happen would be the less true of the two responses.
 */
export async function endSessions(admin: SupabaseClient, userId: string, why: string): Promise<void> {
  forgetMembership(userId);
  const { error } = await admin.rpc("revoke_user_sessions", { p_user_id: userId });
  if (error) {
    console.error(
      `[members] revoke_user_sessions failed after ${why} for ${userId}: ${(error as { message?: string }).message ?? "unknown"}`,
    );
  }
}

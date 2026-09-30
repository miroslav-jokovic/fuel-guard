import { isRosterIssuedRole, type OrgMember } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { useToastStore } from "@/stores/toast";

/**
 * The Users page's access acts on one office member — remove, suspend, reinstate — and the sentences
 * that confirm them (SP7, SETTINGS-PERMISSIONS-PLAN §4b).
 *
 * ── WHAT THE CONFIRMATIONS PROMISE, AND WHY IT IS NOW TRUE ────────────────────────────────────
 * Q-SET6 (a), ruled 2026-09-30: removing, demoting or suspending a person ends their sessions at once.
 * Until SP7 it did not — the API trusted a signed token until it expired, up to an hour — so the page
 * could not honestly say "signed out now". It can since the API ends the sessions
 * (`revoke_user_sessions`) and refuses a token whose membership changed (`membershipCurrent.ts`), and
 * the web turns that refusal into a sign-out (`apiFetch`'s `access_changed` handling). The Permissions
 * page's "applies within an hour" is a DIFFERENT fact and stays: a matrix edit changes what a token
 * carries, not whether the person holds a membership, and it lands at the next token refresh.
 *
 * Split out of `SettingsUsersPage.vue` so the page stays inside its 500-line budget, and because the
 * copy is what the tests pin: the sentence an admin reads before acting is the product here.
 */

const who = (m: OrgMember) => m.fullName ?? m.email ?? "this member";

/**
 * Whether the page offers access acts on this row at all: never on yourself (the API refuses it, and
 * a self-suspension would sign you out mid-click), and never on a driver-app login, whose membership
 * IS the credential and is switched off on the Drivers page (DC10). The API already leaves driver
 * logins out of this list; the check is here as well because the page must not depend on that to be
 * right.
 */
export function offersAccessActions(m: OrgMember, selfId: string | null | undefined): boolean {
  return m.userId !== selfId && !isRosterIssuedRole(m.role);
}

export const isSuspended = (m: OrgMember): boolean => Boolean(m.suspendedAt);

export const removeConfirmText = (m: OrgMember) =>
  `Remove ${who(m)} from the organization? They are signed out immediately, and their personal permissions are deleted. To bring them back you will need to invite them again.`;

export const bulkRemoveConfirmText = (n: number) =>
  `Remove ${n} member${n > 1 ? "s" : ""}? They are signed out immediately, and their personal permissions are deleted.`;

export const suspendConfirmText = (m: OrgMember) =>
  `Suspend ${who(m)}? They are signed out now and cannot sign in until you reinstate them. Their role and personal permissions are kept.`;

export const reinstateConfirmText = (m: OrgMember) =>
  `Reinstate ${who(m)}? They can sign in again with the role and personal permissions they had before.`;

/** Ask, act, report. `true` when the API made the change, so the caller reloads. */
async function act(
  question: string,
  path: string,
  method: "POST" | "DELETE",
  done: [string, string],
  failed: string,
): Promise<boolean> {
  // window.confirm, the destructive-action pattern this page already uses for deleting an invitation.
  if (!confirm(question)) return false;
  const toast = useToastStore();
  const res = await apiFetch(path, { method });
  if (res.ok) toast.success(done[0], done[1]);
  else toast.error(failed, res.error?.message);
  return res.ok;
}

export const removeMember = (m: OrgMember) =>
  act(removeConfirmText(m), `/api/members/${m.userId}`, "DELETE", ["Member removed", `${who(m)} was signed out.`], "Could not remove member");

export const suspendMember = (m: OrgMember) =>
  act(suspendConfirmText(m), `/api/members/${m.userId}/suspend`, "POST", ["Member suspended", `${who(m)} was signed out.`], "Could not suspend member");

export const reinstateMember = (m: OrgMember) =>
  act(reinstateConfirmText(m), `/api/members/${m.userId}/reinstate`, "POST", ["Member reinstated", `${who(m)} can sign in again.`], "Could not reinstate member");

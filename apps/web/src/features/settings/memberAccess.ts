import { isRosterIssuedRole, type OrgMember } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { apiRefusal } from "@/composables/useStepUpRetry";
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

/**
 * The page's `holdForStepUp` (useStepUpRetry): true when the refusal was `step_up_required`, the
 * password prompt is now showing, and `retry` will run once it is confirmed.
 */
export type StepUpHold = (error: unknown, retry: () => Promise<void>) => boolean;

/**
 * Ask, act, report — then `after` (the page's reload) when the API made the change.
 *
 * Since SP9 (Q-SET8 (a), 2026-09-30) every one of these routes asks for the password again, so the
 * send is split from the question: a step-up refusal hands `send` to the page's prompt, and the retry
 * runs WITHOUT asking "are you sure?" a second time — the admin already answered it, and a second
 * confirm after typing a password reads as the first one having been lost. EfsSoapPage's
 * `disableConfirmed` is the same split for the same reason.
 */
async function act(
  question: string,
  path: string,
  method: "POST" | "DELETE",
  done: [string, string],
  failed: string,
  hold: StepUpHold,
  after: () => Promise<void>,
): Promise<void> {
  // window.confirm, the destructive-action pattern this page already uses for deleting an invitation.
  if (!confirm(question)) return;
  const toast = useToastStore();
  const send = async (): Promise<void> => {
    const res = await apiFetch(path, { method });
    if (!res.ok && hold(apiRefusal(res.error, failed), send)) return;
    if (!res.ok) {
      toast.error(failed, res.error?.message);
      return;
    }
    toast.success(done[0], done[1]);
    await after();
  };
  await send();
}

export const removeMember = (m: OrgMember, hold: StepUpHold, after: () => Promise<void>) =>
  act(removeConfirmText(m), `/api/members/${m.userId}`, "DELETE", ["Member removed", `${who(m)} was signed out.`], "Could not remove member", hold, after);

export const suspendMember = (m: OrgMember, hold: StepUpHold, after: () => Promise<void>) =>
  act(suspendConfirmText(m), `/api/members/${m.userId}/suspend`, "POST", ["Member suspended", `${who(m)} was signed out.`], "Could not suspend member", hold, after);

export const reinstateMember = (m: OrgMember, hold: StepUpHold, after: () => Promise<void>) =>
  act(reinstateConfirmText(m), `/api/members/${m.userId}/reinstate`, "POST", ["Member reinstated", `${who(m)} can sign in again.`], "Could not reinstate member", hold, after);

/**
 * Remove several members, one DELETE each (the API answers one member at a time), counting what
 * actually happened. The loop used to discard every response and report success unconditionally, so a
 * refused removal — the API refuses a driver-app login (DC10) — was announced as done. A bulk action
 * that cannot fail out loud is how a fleet-wide mistake stays invisible until somebody cannot sign in.
 *
 * A step-up refusal (SP9) stops the loop where it is and hands the REST of the list, with the tally so
 * far, to the prompt: without a token the first DELETE is refused and nothing was removed; if the
 * token lapsed mid-list, the members already removed stay counted in the one toast at the end.
 */
export async function bulkRemoveMembers(
  ids: string[],
  hold: StepUpHold,
  after: () => Promise<void>,
  tally: { removed: number; failed: string[]; total: number } = { removed: 0, failed: [], total: ids.length },
): Promise<void> {
  const toast = useToastStore();
  for (const [i, id] of ids.entries()) {
    const res = await apiFetch(`/api/members/${id}`, { method: "DELETE" });
    if (!res.ok && hold(apiRefusal(res.error, "Could not remove member"), () => bulkRemoveMembers(ids.slice(i), hold, after, tally))) return;
    if (res.ok) tally.removed++;
    else tally.failed.push(res.error?.message ?? id);
  }
  const { removed, failed, total } = tally;
  if (failed.length === 0) toast.success(`${removed} member${removed === 1 ? "" : "s"} removed`);
  else toast.error(`Removed ${removed} of ${total}`, failed[0]);
  await after();
}

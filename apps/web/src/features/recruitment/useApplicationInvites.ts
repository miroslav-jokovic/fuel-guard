import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";

/** `/api/recruitment/application-invites` — the link that carries an applicant to the form (H5). */

export interface ApplicationInvitation {
  id: string;
  driver_id: string;
  email: string | null;
  expires_at: string;
  /** The three dated phases 0225 replaced the single-use fuse with (D-APP1). */
  consented_at: string | null;
  releases_completed_at: string | null;
  submitted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

const inviteKey = (driverId: string) => ["recruitment", "application-invites", driverId] as const;

export function useApplicationInvitesQuery(driverId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => inviteKey(driverId.value)),
    enabled: computed(() => Boolean(driverId.value)),
    queryFn: async (): Promise<ApplicationInvitation[]> => {
      const res = await apiFetch<{ invitations: ApplicationInvitation[] }>(
        `/api/recruitment/drivers/${driverId.value}/application-invites`,
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the invitations.");
      return res.data.invitations;
    },
  });
}

/**
 * Creating one returns the link, and this is the only moment it exists.
 *
 * The server stores a SHA-256; there is nothing to re-read and no resend that recovers it. The
 * mutation therefore hands the link straight back to the caller rather than relying on a refetch —
 * a component that re-queried for it would find a row with no token in it.
 */
/**
 * What became of the email (D, 2026-08-22). `sent: false` is an outcome the UI reports beside the
 * link, never an error: the recruiter's next action is the same either way, and only the sentence
 * above it changes.
 */
export interface ApplicationInviteDelivery {
  sent: boolean;
  email: string | null;
  /** `no_address` | `mail_disabled` | `send_failed`. null when it went. */
  reason: string | null;
}

export function useCreateApplicationInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      driverId: string;
      email: string | null;
    }): Promise<{ link: string; delivery: ApplicationInviteDelivery }> => {
      const res = await apiFetch<{ link: string; delivery: ApplicationInviteDelivery }>("/api/recruitment/application-invites", {
        method: "POST",
        body: { driver_id: input.driverId, email: input.email },
      });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not create the invitation.");
      return res.data;
    },
    onSuccess: (_r, input) => void qc.invalidateQueries({ queryKey: inviteKey(input.driverId) }),
  });
}

export function useRevokeApplicationInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; driverId: string }): Promise<void> => {
      const res = await apiFetch(`/api/recruitment/application-invites/${input.id}/revoke`, { method: "POST" });
      if (!res.ok) throw new Error(res.error?.message ?? "Could not revoke the invitation.");
    },
    onSuccess: (_r, input) => void qc.invalidateQueries({ queryKey: inviteKey(input.driverId) }),
  });
}

/**
 * What an invitation is doing right now — derived, never a stored status column.
 *
 * ⚠ Folds on `submitted_at` since A5, not `used_at`. They said the same thing while the link was a
 * one-shot fuse; since 0225 it is a session with three spendable phases, and `used_at` survived only
 * as a mirror for this fold and two API reads. All three are gone now, and the column is dropped once
 * this code is provably deployed.
 *
 * `signing` is a real state and a useful one for the office: it means the driver opened the link,
 * agreed to sign electronically and started working through the authorizations. Before A5 nobody
 * could be in it, because nothing called the signing endpoint.
 */
export type InviteState = "open" | "signing" | "used" | "revoked" | "expired";

export function inviteState(invite: ApplicationInvitation, now: Date): InviteState {
  if (invite.submitted_at) return "used";
  if (invite.revoked_at) return "revoked";
  if (Date.parse(invite.expires_at) <= now.getTime()) return "expired";
  return invite.consented_at ? "signing" : "open";
}

/**
 * The submitted application itself (A6).
 *
 * PSP's §0.2 lesson applied before it can repeat: a document filed only where somebody would have to
 * go looking is a document nobody reads. The recruiter asks about the application on the driver's
 * page, so the PDF is offered there. The server renders it on demand if the submit-time render did
 * not land, which is also what makes "logged and retried" true.
 */
export interface SubmittedApplication {
  id: string;
  certified_at: string;
  signed_name: string;
}

export function useDriverApplicationQuery(driverId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => ["recruitment", "application", driverId.value] as const),
    enabled: computed(() => Boolean(driverId.value)),
    queryFn: async (): Promise<{ application: SubmittedApplication | null; documentUrl: string | null }> => {
      const res = await apiFetch<{ application: SubmittedApplication | null; documentUrl: string | null }>(
        `/api/recruitment/drivers/${driverId.value}/application`,
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the application.");
      return res.data;
    },
  });
}

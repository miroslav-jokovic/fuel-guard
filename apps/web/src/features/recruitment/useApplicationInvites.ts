import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";

/** `/api/recruitment/application-invites` — the link that carries an applicant to the form (H5). */

export interface ApplicationInvitation {
  id: string;
  driver_id: string;
  email: string | null;
  expires_at: string;
  used_at: string | null;
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
export function useCreateApplicationInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { driverId: string; email: string | null }): Promise<{ link: string }> => {
      const res = await apiFetch<{ link: string }>("/api/recruitment/application-invites", {
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

/** What an invitation is doing right now — derived, never a stored status column. */
export type InviteState = "open" | "used" | "revoked" | "expired";

export function inviteState(invite: ApplicationInvitation, now: Date): InviteState {
  if (invite.used_at) return "used";
  if (invite.revoked_at) return "revoked";
  return Date.parse(invite.expires_at) <= now.getTime() ? "expired" : "open";
}

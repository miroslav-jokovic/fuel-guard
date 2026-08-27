import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { DriverCredentialIssued } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * Company-issued driver-app logins (DRIVER-CREDENTIALS-PLAN.md) — the Drivers page's write surface.
 * Create/reset return the generated password EXACTLY ONCE; it exists only in the response and the
 * open modal, never in a store or cache.
 */

const driversKey = ["drivers"] as const;

function useCredentialAction<T>(path: (driverId: string) => string, method: "POST" | "DELETE") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (driverId: string): Promise<T> => {
      const res = await apiFetch<T>(path(driverId), { method });
      if (!res.ok || res.data == null) throw new Error(res.error?.message ?? "The action failed.");
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: driversKey }),
  });
}

export function useCreateDriverLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { driverId: string; username?: string; password?: string }): Promise<DriverCredentialIssued> => {
      const res = await apiFetch<DriverCredentialIssued>(`/api/roster/drivers/${args.driverId}/credentials`, {
        method: "POST",
        body: {
          ...(args.username ? { username: args.username } : {}),
          ...(args.password ? { password: args.password } : {}),
        },
      });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not create the login.");
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: driversKey }),
  });
}

export function useResetDriverPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { driverId: string; password?: string }): Promise<DriverCredentialIssued> => {
      const res = await apiFetch<DriverCredentialIssued>(`/api/roster/drivers/${args.driverId}/credentials/reset`, {
        method: "POST",
        body: args.password ? { password: args.password } : {},
      });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not reset the password.");
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: driversKey }),
  });
}
export const useDisableDriverLogin = () =>
  useCredentialAction<{ ok: boolean }>((id) => `/api/roster/drivers/${id}/credentials/disable`, "POST");
export const useEnableDriverLogin = () =>
  useCredentialAction<{ ok: boolean }>((id) => `/api/roster/drivers/${id}/credentials/enable`, "POST");
export const useRevokeDriverLogin = () =>
  useCredentialAction<{ ok: boolean }>((id) => `/api/roster/drivers/${id}/credentials`, "DELETE");

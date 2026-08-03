import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";

/**
 * EFS SOAP integration — client composables. Wraps the /api/integrations/efs-soap/* endpoints in
 * TanStack Vue Query, matching the pattern used by useJob and useOrgSettings elsewhere in the app.
 *
 * All requests hit the Express API (never Supabase directly) because the SOAP password is stored
 * with service-role-only RLS — no client role has read/write access to efs_soap_credentials.
 */

export type EfsSoapEnvironment = "sandbox" | "production";
export type EfsSoapFeed = "posted" | "rejected";

export interface EfsSoapFeedStatus {
  lastPolledAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

/** Non-secret status shape returned by GET /api/integrations/efs-soap/config. */
export interface EfsSoapStatus {
  /** True when a row exists in efs_soap_credentials OR the env-var fallback is fully set. */
  configured: boolean;
  /** True when BOTH the org row's `enabled` flag AND the platform kill switch (EFS_SOAP_ENABLED) are on. */
  enabled: boolean;
  environment: EfsSoapEnvironment | null;
  endpointUrl: string | null;
  accountId: string | null;
  posted: EfsSoapFeedStatus;
  rejected: EfsSoapFeedStatus;
  /** Transport security. Present since mutual-TLS support; never carries key material. */
  tls: EfsSoapTlsStatus;
}

/** What identity (if any) we present to EFS at the TLS layer. */
export interface EfsSoapTlsStatus {
  /** Human summary, e.g. "client certificate (PEM, CN=…) + per-org". */
  description: string;
  /** "org" = a stored certificate, "env" = the deploy-wide fallback, null = ordinary TLS. */
  source: "org" | "env" | null;
  /** Metadata for the active stored certificate — see useEfsClientCert for the full lifecycle. */
  activeCert: { fingerprintSha256: string; subject: string; notAfter: string; daysUntilExpiry: number } | null;
  expiringSoon: boolean;
}

const QUERY_KEY = ["efs_soap", "config"];

/** Current EFS SOAP configuration + freshness. Refetched on every mutation. */
export function useEfsSoapStatus() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<EfsSoapStatus> => {
      const res = await apiFetch<EfsSoapStatus>("/api/integrations/efs-soap/config");
      if (!res.ok || !res.data) {
        throw new Error(res.error?.message ?? "Could not load EFS SOAP config");
      }
      return res.data;
    },
  });
}

/** Payload accepted by POST /api/integrations/efs-soap/enable (also the ROTATE path — re-calling
 *  overwrites the password). */
export interface EnableEfsSoapInput {
  environment: EfsSoapEnvironment;
  endpointUrl: string;
  soapUsername: string;
  soapPassword: string;
  accountId?: string | null;
}

/** Upsert + enable. Invalidates the config query on success so the UI reflects the new state. */
export function useEnableEfsSoap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: EnableEfsSoapInput): Promise<void> => {
      const res = await apiFetch<{ enabled: true }>("/api/integrations/efs-soap/enable", {
        method: "POST",
        body: {
          environment: input.environment,
          endpointUrl: input.endpointUrl,
          soapUsername: input.soapUsername,
          soapPassword: input.soapPassword,
          accountId: input.accountId ?? null,
        },
      });
      if (!res.ok) throw new Error(res.error?.message ?? "Could not save credentials");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

/** Disable + wipe the stored password. Invalidates the config query on success. */
export function useDisableEfsSoap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      const res = await apiFetch<{ enabled: false }>("/api/integrations/efs-soap/disable", {
        method: "POST",
      });
      if (!res.ok) throw new Error(res.error?.message ?? "Could not disable EFS SOAP");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

/** Test-connection response — three shapes: success, expected-pre-WSDL (200 with notImplemented),
 *  or hard failure (thrown). */
export type TestConnectionResult =
  | { kind: "success"; roundtripMs: number; tls?: string }
  | { kind: "not_implemented"; message: string }
  | { kind: "failure"; message: string };

/** Fires one probe against EFS. NEVER throws for expected "waiting on WSDL" state — that returns
 *  kind: "not_implemented" so the UI can render a friendly message. Real errors throw. */
export function useTestEfsSoapConnection() {
  return useMutation({
    mutationFn: async (): Promise<TestConnectionResult> => {
      const res = await apiFetch<{
        ok: boolean;
        roundtripMs?: number;
        notImplemented?: boolean;
        message?: string;
        /** What was presented at the TLS layer — surfaced so a handshake problem is visible here. */
        tls?: string;
      }>("/api/integrations/efs-soap/test-connection", { method: "POST" });

      if (res.ok && res.data?.ok) {
        return { kind: "success", roundtripMs: res.data.roundtripMs ?? 0, tls: res.data.tls };
      }
      if (res.ok && res.data?.notImplemented) {
        return { kind: "not_implemented", message: res.data.message ?? "EFS SOAP client not yet implemented" };
      }
      // Real failure (4xx or 5xx from the API).
      throw new Error(res.error?.message ?? "Test connection failed");
    },
  });
}

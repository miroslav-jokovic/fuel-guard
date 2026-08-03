import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";

/**
 * EFS SOAP client certificate (mutual TLS) — client composables.
 *
 * Wraps /api/integrations/efs-soap/client-cert/*. Kept separate from useEfsSoap.ts because the
 * lifecycle is genuinely different: credentials are a single upsert, a certificate is a staged
 * rotation with its own states, and mixing them produced a composable nobody could read.
 *
 * The private key travels ONE WAY — into POST, never back. Every response type below is metadata
 * only; there is no field on any of them that could carry key material, by construction.
 */

export type ClientCertStatus = "pending" | "active" | "retired";
export type CertExpiryState = "valid" | "expiring" | "expired" | "not_yet_valid";

export interface ClientCertSummary {
  id: string;
  status: ClientCertStatus;
  fingerprintSha256: string;
  subject: string;
  issuer: string;
  serialNumber: string;
  keyType: string | null;
  notBefore: string;
  notAfter: string;
  expiryState: CertExpiryState;
  daysUntilExpiry: number;
  hasCaBundle: boolean;
  lastHandshakeAt: string | null;
  lastHandshakeOk: boolean | null;
  lastHandshakeError: string | null;
  createdAt: string;
  createdBy: string | null;
  activatedAt: string | null;
  retiredAt: string | null;
  retiredReason: string | null;
}

export interface ClientCertState {
  active: ClientCertSummary | null;
  pending: ClientCertSummary | null;
  history: ClientCertSummary[];
}

export interface UploadClientCertInput {
  certPem: string;
  keyPem: string;
  passphrase?: string;
  caPem?: string;
  /** Skip staging and go live immediately. Off by default — stage, test, then activate. */
  activate?: boolean;
}

export interface UploadClientCertResult {
  cert: ClientCertSummary;
  warnings: string[];
  activated: boolean;
  replacedPending?: boolean;
}

const CERT_KEY = ["efs_soap", "client_cert"];
const CONFIG_KEY = ["efs_soap", "config"];

/** Installed + historical certificates. Metadata only. */
export function useClientCerts() {
  return useQuery({
    queryKey: CERT_KEY,
    queryFn: async (): Promise<ClientCertState> => {
      const res = await apiFetch<ClientCertState>("/api/integrations/efs-soap/client-cert");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load client certificates");
      return res.data;
    },
  });
}

/** Both queries refresh after any lifecycle action — the config card shows the TLS summary too. */
function invalidateAll(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: CERT_KEY });
  void qc.invalidateQueries({ queryKey: CONFIG_KEY });
}

export function useUploadClientCert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UploadClientCertInput): Promise<UploadClientCertResult> => {
      const res = await apiFetch<UploadClientCertResult>("/api/integrations/efs-soap/client-cert", {
        method: "POST",
        body: {
          certPem: input.certPem,
          keyPem: input.keyPem,
          ...(input.passphrase ? { passphrase: input.passphrase } : {}),
          ...(input.caPem ? { caPem: input.caPem } : {}),
          ...(input.activate ? { activate: true } : {}),
        },
      });
      // The API's rejections are the actionable ones ("the private key does not match the
      // certificate", "expired on …"), so they are surfaced verbatim rather than replaced.
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not store the certificate");
      return res.data;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export type CertTestResult =
  | { kind: "success"; roundtripMs: number; tls: string; fingerprint: string }
  | { kind: "failure"; message: string; tls?: string };

/**
 * Real EFS login using the PENDING certificate. This is the gate that makes staged rotation worth
 * having: an unenrolled certificate fails here while the working one keeps serving traffic.
 */
export function useTestClientCert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<CertTestResult> => {
      const res = await apiFetch<{ ok: boolean; roundtripMs?: number; tls?: string; fingerprint?: string }>(
        "/api/integrations/efs-soap/client-cert/test",
        { method: "POST" },
      );
      if (res.ok && res.data?.ok) {
        return {
          kind: "success",
          roundtripMs: res.data.roundtripMs ?? 0,
          tls: res.data.tls ?? "",
          fingerprint: res.data.fingerprint ?? "",
        };
      }
      return { kind: "failure", message: res.error?.message ?? "The test connection failed." };
    },
    // A test writes the handshake outcome onto the certificate row, so the card must refresh.
    onSuccess: () => invalidateAll(qc),
  });
}

export function useActivateClientCert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ activated: ClientCertSummary; retired: ClientCertSummary | null }> => {
      const res = await apiFetch<{ activated: ClientCertSummary; retired: ClientCertSummary | null }>(
        "/api/integrations/efs-soap/client-cert/activate",
        { method: "POST" },
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not activate the certificate");
      return res.data;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export function useRollbackClientCert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ restored: ClientCertSummary; rolledBack: ClientCertSummary | null }> => {
      const res = await apiFetch<{ restored: ClientCertSummary; rolledBack: ClientCertSummary | null }>(
        "/api/integrations/efs-soap/client-cert/rollback",
        { method: "POST" },
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not roll back");
      return res.data;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export function useWithdrawClientCert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ retired: number; tls: string }> => {
      const res = await apiFetch<{ retired: number; tls: string }>("/api/integrations/efs-soap/client-cert", {
        method: "DELETE",
      });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not withdraw the certificate");
      return res.data;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

/** Short fingerprint for display — full value stays available for copy/paste to EFS. */
export function shortFingerprint(fp: string): string {
  return fp.replace(/(.{4})/g, "$1 ").trim().slice(0, 24) + "…";
}

/** Colour intent for an expiry badge. */
export function expiryTone(cert: ClientCertSummary): "ok" | "warn" | "bad" {
  if (cert.expiryState === "expired" || cert.expiryState === "not_yet_valid") return "bad";
  if (cert.expiryState === "expiring") return "warn";
  return "ok";
}

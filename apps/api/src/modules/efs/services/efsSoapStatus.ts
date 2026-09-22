import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../../env.js";
import { describeTlsMaterial, type EfsTlsMaterial } from "../lib/soapClient.js";
import { CERT_EXPIRY_WARN_DAYS, listCerts, type StoredCertSummary } from "./efsSoapClientCerts.js";
import { getEfsSoapCredentials } from "./efsSoapCredentials.js";

/**
 * The NON-SECRET status surface for the EFS SOAP integration — what the settings page is allowed to
 * see. Split out of `efsSoapCredentials.ts` on 2026-09-22 when that file crossed the 500-line budget
 * (`lint:filesize`) while gaining `processingAbandoned`, and the seam was already there: everything
 * here READS and renders, while what remains in `efsSoapCredentials.ts` stores, seals and rotates the
 * credential itself. Nothing in this module touches a password — that is the property worth keeping
 * the two apart for, not the line count.
 */

export interface EfsSoapStatus {
  configured: boolean;
  enabled: boolean;
  environment: "sandbox" | "production" | null;
  endpointUrl: string | null;
  accountId: string | null;
  posted: {
    lastPolledAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    processingPending: number;
    processingLastError: string | null;
    /**
     * Runs that reached the attempt ceiling (migration 0354) and will never be retried. Counted
     * separately from `processingPending` on purpose — an abandoned run is not waiting for anything.
     */
    processingAbandoned: number;
  };
  rejected: {
    lastPolledAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    processingPending: number;
    processingLastError: string | null;
    processingAbandoned: number;
  };
  /** Transport security, described without exposing any key material. */
  tls: {
    /** Human summary, e.g. "client certificate (PEM, CN=...) + per-org". */
    description: string;
    /** "org" when a stored certificate is presenting, "env" for the deploy-wide fallback, else null. */
    source: "org" | "env" | null;
    /** The active stored certificate, when there is one. Never includes the private key. */
    activeCert: StoredCertSummary | null;
    /** True when a certificate is presenting and it expires within the warning band. */
    expiringSoon: boolean;
  };
}

/** Zero-configured status — reported to the UI when no row exists AND no env fallback is set. */
const EMPTY_STATUS: Omit<EfsSoapStatus, "configured" | "enabled" | "tls"> = {
  environment: null,
  endpointUrl: null,
  accountId: null,
  posted: { lastPolledAt: null, lastSuccessAt: null, lastError: null, processingPending: 0, processingLastError: null, processingAbandoned: 0 },
  rejected: { lastPolledAt: null, lastSuccessAt: null, lastError: null, processingPending: 0, processingLastError: null, processingAbandoned: 0 },
};

/**
 * Non-secret status for the settings UI. NEVER returns password, cursors (opaque provider tokens),
 * or anything that could leak credential material. Safe to expose to admin-role clients.
 */
export async function getEfsSoapStatus(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
): Promise<EfsSoapStatus> {
  const creds = await getEfsSoapCredentials(admin, env, orgId);
  const tls = await tlsStatus(admin, orgId, creds?.tls ?? null);
  if (!creds) return { configured: false, enabled: false, ...EMPTY_STATUS, tls };
  // `abandoned` (0354) is read here for the reason the ceiling needed a surface at all: without it,
  // a run that has permanently stopped simply DROPS OUT of this query, and the operator sees the
  // count fall to zero — the same picture as work that finished. The three runs 0354 was written for
  // were invisible for 25 days while being 48.9% of all scoring, and a fix whose only visible effect
  // is that a number goes down would have preserved exactly that.
  const { data: processing } = await admin
    .from("efs_processing_runs")
    .select("feed, status, last_error")
    .eq("org_id", orgId)
    .in("status", ["pending", "running", "failed", "abandoned"])
    .order("updated_at", { ascending: false })
    .limit(100);
  const processingRows = (processing ?? []) as { feed: "posted" | "rejected"; status: string; last_error: string | null }[];
  const processingFor = (feed: "posted" | "rejected") => {
    const rows = processingRows.filter((r) => r.feed === feed);
    const abandoned = rows.filter((r) => r.status === "abandoned");
    return {
      // An abandoned run is NOT pending: nothing will pick it up, so counting it here would report
      // work in progress that does not exist.
      processingPending: rows.length - abandoned.length,
      // An abandoned run's `last_error` outranks a retrying one's. A `failed` run is mid-ladder and
      // its error may be transient; an abandoned run's error is the final word on that import, and
      // it is the message the operator has to act on.
      processingLastError:
        abandoned.find((r) => r.last_error)?.last_error ??
        rows.find((r) => r.status === "failed")?.last_error ??
        null,
      processingAbandoned: abandoned.length,
    };
  };
  return {
    configured: true,
    enabled: creds.enabled && env.EFS_SOAP_ENABLED, // both must be true for the poller to run
    environment: creds.environment,
    endpointUrl: creds.endpointUrl,
    accountId: creds.accountId,
    posted: {
      lastPolledAt: creds.postedLastPolledAt,
      lastSuccessAt: creds.postedLastSuccessAt,
      lastError: creds.postedLastError,
      ...processingFor("posted"),
    },
    rejected: {
      lastPolledAt: creds.rejectedLastPolledAt,
      lastSuccessAt: creds.rejectedLastSuccessAt,
      lastError: creds.rejectedLastError,
      ...processingFor("rejected"),
    },
    tls,
  };
}

/**
 * Transport-security block for the settings UI. Reads the ACTIVE certificate's metadata (never its
 * key) so an admin can see, in one place: what identity we present, who issued it, when it expires,
 * and whether the last handshake actually worked. That last field is what makes an EFS-side
 * enrolment problem visible before it becomes a silent gap in the fuel feed.
 */
async function tlsStatus(
  admin: SupabaseClient,
  orgId: string,
  material: EfsTlsMaterial | null,
): Promise<EfsSoapStatus["tls"]> {
  let activeCert: StoredCertSummary | null = null;
  if (material?.source === "org") {
    const certs = await listCerts(admin, orgId, new Date(), 5);
    activeCert = certs.find((c) => c.status === "active") ?? null;
  }
  const expiringSoon = activeCert
    ? activeCert.expiryState === "expiring" || activeCert.expiryState === "expired"
    : !!material?.notAfter && Date.parse(material.notAfter) - Date.now() <= CERT_EXPIRY_WARN_DAYS * 86_400_000;
  return {
    description: describeTlsMaterial(material),
    source: material?.source ?? null,
    activeCert,
    expiringSoon,
  };
}

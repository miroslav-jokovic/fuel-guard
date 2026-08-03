import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";
import { isSecretBoxConfigured, open, seal, secretAad, SecretBoxError } from "../lib/secretBox.js";
import { CertificateError, certExpiryState, daysUntil, normalizePem, validateClientCert, type CertExpiryState, type CertInfo } from "../lib/x509.js";
import type { EfsTlsMaterial } from "../lib/soapClient.js";

/**
 * EFS SOAP client certificates — storage, validated upload, staged rotation, and resolution into the
 * TLS material the SOAP client presents.
 *
 * Backing table: `efs_soap_client_certs` (migration 0106). Service-role only.
 *
 * ── The rotation model, and why it is stage-then-activate ───────────────────────────────────────
 * A TLS identity cannot be swapped by writing a column and hoping. If the new certificate is wrong —
 * wrong issuer, missing intermediate, not yet enrolled on EFS's side — every subsequent call fails,
 * including the call you would use to diagnose it. So:
 *
 *   upload   → row lands as `pending`, fully validated locally but NOT presenting
 *   test     → a real login()/logout() against EFS using the pending certificate
 *   activate → pending becomes active, the previous active becomes retired
 *   rollback → the most recently retired certificate becomes active again
 *
 * Partial unique indexes make "two active" and "two pending" unrepresentable, so the invariant is
 * enforced by Postgres rather than by remembering to check.
 *
 * ── Purpose string ──────────────────────────────────────────────────────────────────────────────
 * The sealed key is AAD-bound to (org, purpose). Changing this constant invalidates every stored key,
 * so it is a versioned identifier, not a description.
 */
const KEY_PURPOSE = "efs_soap_client_key.v1";
const PASSPHRASE_PURPOSE = "efs_soap_client_key_passphrase.v1";

/** Default warning band for an approaching expiry. Also the default for the daily sweep. */
export const CERT_EXPIRY_WARN_DAYS = 30;

export type CertStatus = "pending" | "active" | "retired";

/** Everything about a stored certificate EXCEPT its private key. Safe to return over the API. */
export interface StoredCertSummary {
  id: string;
  status: CertStatus;
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

interface CertRow {
  id: string;
  org_id: string;
  status: CertStatus;
  cert_pem: string;
  ca_pem: string | null;
  key_sealed: string;
  key_passphrase_sealed: string | null;
  fingerprint_sha256: string;
  subject: string;
  issuer: string;
  serial_number: string;
  key_type: string | null;
  not_before: string;
  not_after: string;
  last_handshake_at: string | null;
  last_handshake_ok: boolean | null;
  last_handshake_error: string | null;
  created_at: string;
  created_by: string | null;
  activated_at: string | null;
  retired_at: string | null;
  retired_reason: string | null;
}

/** Columns that are safe to select when we only need metadata — keeps key material out of memory. */
const META_COLS =
  "id, org_id, status, ca_pem, fingerprint_sha256, subject, issuer, serial_number, key_type, not_before, not_after, last_handshake_at, last_handshake_ok, last_handshake_error, created_at, created_by, activated_at, retired_at, retired_reason";

function toSummary(row: Partial<CertRow> & { fingerprint_sha256: string }, now: Date): StoredCertSummary {
  const notBefore = row.not_before!;
  const notAfter = row.not_after!;
  return {
    id: row.id!,
    status: row.status!,
    fingerprintSha256: row.fingerprint_sha256,
    subject: row.subject!,
    issuer: row.issuer!,
    serialNumber: row.serial_number!,
    keyType: row.key_type ?? null,
    notBefore,
    notAfter,
    expiryState: certExpiryState({ notBefore, notAfter }, now, CERT_EXPIRY_WARN_DAYS),
    daysUntilExpiry: daysUntil(notAfter, now),
    hasCaBundle: !!row.ca_pem,
    lastHandshakeAt: row.last_handshake_at ?? null,
    lastHandshakeOk: row.last_handshake_ok ?? null,
    lastHandshakeError: row.last_handshake_error ?? null,
    createdAt: row.created_at!,
    createdBy: row.created_by ?? null,
    activatedAt: row.activated_at ?? null,
    retiredAt: row.retired_at ?? null,
    retiredReason: row.retired_reason ?? null,
  };
}

/** Raised for anything an operator can act on; the routes map `code` to an HTTP status. */
export class ClientCertServiceError extends Error {
  constructor(
    message: string,
    public code:
      | "not_configured"
      | "invalid_certificate"
      | "no_pending"
      | "no_active"
      | "nothing_to_roll_back"
      | "key_unreadable",
  ) {
    super(message);
    this.name = "ClientCertServiceError";
  }
}

export interface UploadClientCertInput {
  certPem: string;
  keyPem: string;
  passphrase?: string | undefined;
  caPem?: string | undefined;
}

export interface UploadClientCertResult {
  cert: StoredCertSummary;
  warnings: string[];
  /** True when the upload replaced an earlier pending certificate that was never activated. */
  replacedPending: boolean;
}

/**
 * Validate and store a client certificate as `pending`. Never activates — an operator (or the caller)
 * must test it and then activate, so a bad certificate cannot take the integration down on upload.
 *
 * Refuses outright when SECRETS_ENCRYPTION_KEY is unset: writing a private key into Postgres in the
 * clear because a deploy forgot an env var is exactly the failure this design exists to prevent.
 */
export async function uploadClientCert(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  input: UploadClientCertInput,
  actorId: string | null,
  now = new Date(),
): Promise<UploadClientCertResult> {
  if (!isSecretBoxConfigured(env)) {
    throw new ClientCertServiceError(
      "SECRETS_ENCRYPTION_KEY is not configured on this deployment, so a private key cannot be stored securely. Set it (openssl rand -base64 32) and redeploy before uploading a certificate.",
      "not_configured",
    );
  }

  let validated;
  try {
    validated = validateClientCert(
      { certPem: input.certPem, keyPem: input.keyPem, passphrase: input.passphrase, caPem: input.caPem },
      now,
      CERT_EXPIRY_WARN_DAYS,
    );
  } catch (e) {
    if (e instanceof CertificateError) throw new ClientCertServiceError(e.message, "invalid_certificate");
    throw e;
  }

  // Clear any earlier pending row — the partial unique index allows only one, and "the last thing I
  // uploaded is what's staged" is the behaviour an operator expects.
  const { data: priorPending } = await admin
    .from("efs_soap_client_certs")
    .select("id")
    .eq("org_id", orgId)
    .eq("status", "pending")
    .maybeSingle();
  if (priorPending?.id) {
    await admin
      .from("efs_soap_client_certs")
      .update({ status: "retired", retired_at: now.toISOString(), retired_by: actorId, retired_reason: "superseded_before_activation" })
      .eq("id", priorPending.id as string);
  }

  const { data, error } = await admin
    .from("efs_soap_client_certs")
    .insert({
      org_id: orgId,
      status: "pending",
      cert_pem: validated.certPem,
      ca_pem: validated.caPem,
      key_sealed: seal(env, validated.keyPem, secretAad(orgId, KEY_PURPOSE)),
      key_passphrase_sealed: input.passphrase
        ? seal(env, input.passphrase, secretAad(orgId, PASSPHRASE_PURPOSE))
        : null,
      fingerprint_sha256: validated.info.fingerprintSha256,
      subject: validated.info.subject,
      issuer: validated.info.issuer,
      serial_number: validated.info.serialNumber,
      key_type: validated.info.keyType,
      not_before: validated.info.notBefore,
      not_after: validated.info.notAfter,
      created_by: actorId,
    })
    .select(META_COLS)
    .single();
  if (error) throw new Error(error.message);

  return {
    cert: toSummary(data as CertRow, now),
    warnings: validated.warnings,
    replacedPending: !!priorPending?.id,
  };
}

/** Promote the pending certificate to active and retire the one it replaces. */
export async function activatePendingCert(
  admin: SupabaseClient,
  orgId: string,
  actorId: string | null,
  now = new Date(),
): Promise<{ activated: StoredCertSummary; retired: StoredCertSummary | null }> {
  const { data: pending } = await admin
    .from("efs_soap_client_certs")
    .select(META_COLS)
    .eq("org_id", orgId)
    .eq("status", "pending")
    .maybeSingle();
  if (!pending) {
    throw new ClientCertServiceError("No pending certificate to activate — upload one first.", "no_pending");
  }

  const { data: current } = await admin
    .from("efs_soap_client_certs")
    .select(META_COLS)
    .eq("org_id", orgId)
    .eq("status", "active")
    .maybeSingle();

  // Retire the incumbent FIRST. The partial unique index would reject two actives, and doing it in
  // this order means a failure here leaves the old certificate still presenting — the safe direction.
  if (current) {
    const { error } = await admin
      .from("efs_soap_client_certs")
      .update({ status: "retired", retired_at: now.toISOString(), retired_by: actorId, retired_reason: "rotated" })
      .eq("id", (current as CertRow).id);
    if (error) throw new Error(error.message);
  }

  const { data: activated, error: actErr } = await admin
    .from("efs_soap_client_certs")
    .update({ status: "active", activated_at: now.toISOString(), activated_by: actorId })
    .eq("id", (pending as CertRow).id)
    .select(META_COLS)
    .single();
  if (actErr) throw new Error(actErr.message);

  return {
    activated: toSummary(activated as CertRow, now),
    retired: current ? toSummary(current as CertRow, now) : null,
  };
}

/**
 * Undo the last activation: retire the current active certificate and restore the most recently
 * retired one. The escape hatch for "we activated it, EFS started refusing us, put it back".
 */
export async function rollbackToPreviousCert(
  admin: SupabaseClient,
  orgId: string,
  actorId: string | null,
  now = new Date(),
): Promise<{ restored: StoredCertSummary; rolledBack: StoredCertSummary | null }> {
  const { data: previousRows } = await admin
    .from("efs_soap_client_certs")
    .select(META_COLS)
    .eq("org_id", orgId)
    .eq("status", "retired")
    .not("activated_at", "is", null) // never restore something that was never live
    .order("retired_at", { ascending: false })
    .limit(1);
  const previous = ((previousRows ?? []) as CertRow[])[0];
  if (!previous) {
    throw new ClientCertServiceError(
      "No previously-active certificate to roll back to.",
      "nothing_to_roll_back",
    );
  }

  const { data: current } = await admin
    .from("efs_soap_client_certs")
    .select(META_COLS)
    .eq("org_id", orgId)
    .eq("status", "active")
    .maybeSingle();
  if (current) {
    const { error } = await admin
      .from("efs_soap_client_certs")
      .update({ status: "retired", retired_at: now.toISOString(), retired_by: actorId, retired_reason: "rolled_back" })
      .eq("id", (current as CertRow).id);
    if (error) throw new Error(error.message);
  }

  const { data: restored, error } = await admin
    .from("efs_soap_client_certs")
    .update({ status: "active", activated_at: now.toISOString(), activated_by: actorId, retired_at: null, retired_by: null, retired_reason: null })
    .eq("id", previous.id)
    .select(META_COLS)
    .single();
  if (error) throw new Error(error.message);

  return {
    restored: toSummary(restored as CertRow, now),
    rolledBack: current ? toSummary(current as CertRow, now) : null,
  };
}

/** Withdraw the client certificate entirely — the org falls back to env material, then plain TLS. */
export async function retireAllCerts(
  admin: SupabaseClient,
  orgId: string,
  actorId: string | null,
  reason = "withdrawn",
  now = new Date(),
): Promise<number> {
  const { data, error } = await admin
    .from("efs_soap_client_certs")
    .update({ status: "retired", retired_at: now.toISOString(), retired_by: actorId, retired_reason: reason })
    .eq("org_id", orgId)
    .in("status", ["active", "pending"])
    .select("id");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string }[]).length;
}

/** Certificate history for the settings UI — metadata only, newest first. Never any key material. */
export async function listCerts(
  admin: SupabaseClient,
  orgId: string,
  now = new Date(),
  limit = 20,
): Promise<StoredCertSummary[]> {
  const { data } = await admin
    .from("efs_soap_client_certs")
    .select(META_COLS)
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as CertRow[]).map((r) => toSummary(r, now));
}

/**
 * Load one certificate's full TLS material (private key unsealed). The ONLY function in the codebase
 * that unseals the key, and it is never reachable from a route — routes deal in summaries.
 */
async function loadMaterial(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  status: CertStatus,
): Promise<EfsTlsMaterial | null> {
  const { data } = await admin
    .from("efs_soap_client_certs")
    .select("id, cert_pem, ca_pem, key_sealed, key_passphrase_sealed, fingerprint_sha256, not_after, subject")
    .eq("org_id", orgId)
    .eq("status", status)
    .maybeSingle();
  if (!data) return null;
  const row = data as Pick<CertRow, "id" | "cert_pem" | "ca_pem" | "key_sealed" | "key_passphrase_sealed" | "fingerprint_sha256" | "not_after" | "subject">;
  try {
    return {
      source: "org",
      certId: row.id,
      cert: row.cert_pem,
      key: open(env, row.key_sealed, secretAad(orgId, KEY_PURPOSE)),
      ...(row.key_passphrase_sealed
        ? { passphrase: open(env, row.key_passphrase_sealed, secretAad(orgId, PASSPHRASE_PURPOSE)) }
        : {}),
      ...(row.ca_pem ? { ca: row.ca_pem } : {}),
      fingerprintSha256: row.fingerprint_sha256,
      subject: row.subject,
      notAfter: row.not_after,
      rejectUnauthorized: true,
    };
  } catch (e) {
    if (e instanceof SecretBoxError) {
      throw new ClientCertServiceError(
        `The stored private key for certificate ${row.fingerprint_sha256.slice(0, 16)}… could not be unsealed: ${e.message}`,
        "key_unreadable",
      );
    }
    throw e;
  }
}

/** The active certificate's TLS material, or null when this org has none. */
export function loadActiveMaterial(admin: SupabaseClient, env: Env, orgId: string): Promise<EfsTlsMaterial | null> {
  return loadMaterial(admin, env, orgId, "active");
}

/** The pending certificate's TLS material — used by the pre-activation connection test. */
export function loadPendingMaterial(admin: SupabaseClient, env: Env, orgId: string): Promise<EfsTlsMaterial | null> {
  return loadMaterial(admin, env, orgId, "pending");
}

/**
 * Record a handshake outcome against the certificate that was presented. This is what makes a TLS
 * failure diagnosable after the fact: the operator sees "rejected at 04:12 — CERT_HAS_EXPIRED" on the
 * exact certificate, rather than a generic integration error. Best-effort; never throws into a call.
 */
export async function recordHandshake(
  admin: SupabaseClient,
  certId: string,
  ok: boolean,
  errorMessage: string | null,
  now = new Date(),
): Promise<void> {
  const { error } = await admin
    .from("efs_soap_client_certs")
    .update({
      last_handshake_at: now.toISOString(),
      last_handshake_ok: ok,
      last_handshake_error: ok ? null : (errorMessage ?? "").slice(0, 500),
    })
    .eq("id", certId);
  if (error) console.error(`[efs-soap-tls] recordHandshake failed for ${certId}: ${error.message}`);
}

/** Active certificates at or past the warning band — input to the daily expiry sweep. */
export async function certsNeedingExpiryWarning(
  admin: SupabaseClient,
  warnDays = CERT_EXPIRY_WARN_DAYS,
  now = new Date(),
): Promise<{ orgId: string; cert: StoredCertSummary }[]> {
  const cutoff = new Date(now.getTime() + warnDays * 86_400_000).toISOString();
  const { data } = await admin
    .from("efs_soap_client_certs")
    .select(META_COLS)
    .eq("status", "active")
    .lte("not_after", cutoff);
  return ((data ?? []) as CertRow[]).map((r) => ({ orgId: r.org_id, cert: toSummary(r, now) }));
}

export type { CertInfo, CertExpiryState };
export { normalizePem };

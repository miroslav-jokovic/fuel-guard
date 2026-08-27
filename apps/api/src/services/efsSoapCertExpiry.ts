import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { sendEmail } from "../lib/mailer.js";
import { CERT_EXPIRY_WARN_DAYS, certsNeedingExpiryWarning, type StoredCertSummary } from "./efsSoapClientCerts.js";

/**
 * Client-certificate expiry sweep.
 *
 * A TLS client certificate is the one credential in this system that expires on somebody ELSE's
 * schedule and fails CLOSED with no warning: at midnight on the notAfter date, every EFS call starts
 * returning a handshake alert, the fuel feed stops, and nothing in the product said a word beforehand.
 * Issuers do send renewal notices — to whoever's address is on the certificate order, which is rarely
 * the person watching this dashboard.
 *
 * So the platform watches its own certificates. Once a day, every ACTIVE certificate inside the
 * warning band (or already past it) produces one email to the org's notification addresses, and one
 * loud log line. The `tls_expiry_warned_for` fingerprint on `efs_soap_credentials` makes it idempotent:
 * one warning per certificate per band, not one per sweep — an alert that arrives every day for a
 * month is an alert nobody reads by week two.
 *
 * Re-warns when the band escalates (expiring → expired), because "it is now down" is genuinely new
 * information, and resets automatically when a new certificate is activated (different fingerprint).
 */

/** Bands we warn on. Crossing into a new one re-arms the notification for the same certificate. */
type WarnBand = "expiring" | "expired";

function bandFor(cert: StoredCertSummary): WarnBand {
  return cert.daysUntilExpiry <= 0 ? "expired" : "expiring";
}

/** Marker stored on the credentials row: fingerprint + band, so an escalation re-notifies once. */
const marker = (cert: StoredCertSummary): string => `${cert.fingerprintSha256}:${bandFor(cert)}`;

function subjectFor(cert: StoredCertSummary, orgName: string): string {
  return bandFor(cert) === "expired"
    ? `[Silvicom 360] EFS client certificate EXPIRED — fuel feed is down for ${orgName}`
    : `[Silvicom 360] EFS client certificate expires in ${cert.daysUntilExpiry} days — ${orgName}`;
}

function bodyFor(cert: StoredCertSummary, orgName: string): { text: string; html: string } {
  const expired = bandFor(cert) === "expired";
  const lead = expired
    ? `The client certificate Silvicom 360 presents to EFS for ${orgName} expired on ${cert.notAfter.slice(0, 10)}. EFS is rejecting the TLS handshake, so posted transactions and rejected authorizations are NOT being collected right now.`
    : `The client certificate Silvicom 360 presents to EFS for ${orgName} expires in ${cert.daysUntilExpiry} days, on ${cert.notAfter.slice(0, 10)}. When it lapses, EFS will refuse the connection and the fuel feed will stop.`;

  const lines = [
    lead,
    "",
    `Subject:     ${cert.subject}`,
    `Issuer:      ${cert.issuer}`,
    `Serial:      ${cert.serialNumber}`,
    `Fingerprint: ${cert.fingerprintSha256}`,
    `Valid:       ${cert.notBefore.slice(0, 10)} → ${cert.notAfter.slice(0, 10)}`,
    "",
    "To renew, in Settings → Integrations → EFS:",
    "  1. Obtain a replacement certificate from the issuer.",
    "  2. Upload it — it is staged as PENDING and does not replace the working one.",
    "  3. Press Test — this performs a real EFS login using the new certificate.",
    "  4. Press Activate once the test passes. Rollback is one click if anything goes wrong.",
    "",
    "If EFS has to enrol the new certificate on their side, send them the fingerprint above for the",
    "replacement BEFORE activating it — enrolment is the usual reason a valid certificate is refused.",
  ];
  const text = lines.join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;line-height:1.5">
  <p><strong>${expired ? "EFS client certificate expired" : "EFS client certificate expiring"}</strong></p>
  <p>${lead}</p>
  <table style="border-collapse:collapse;font-family:ui-monospace,monospace;font-size:13px">
    <tr><td style="padding:2px 12px 2px 0;color:#666">Subject</td><td>${cert.subject}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666">Issuer</td><td>${cert.issuer}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666">Serial</td><td>${cert.serialNumber}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666">Fingerprint</td><td>${cert.fingerprintSha256}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666">Valid</td><td>${cert.notBefore.slice(0, 10)} → ${cert.notAfter.slice(0, 10)}</td></tr>
  </table>
  <p>To renew, in <em>Settings → Integrations → EFS</em>: upload the replacement (it stages as <strong>pending</strong>),
     press <strong>Test</strong> for a real EFS login with it, then <strong>Activate</strong>. Rollback is one click.</p>
  <p>If EFS enrols certificates on their side, send them the replacement's fingerprint <em>before</em> activating.</p>
</div>`;
  return { text, html };
}

export interface ExpirySweepResult {
  checked: number;
  warned: number;
  skippedAlreadyWarned: number;
  noRecipients: number;
}

/**
 * One pass over every org's active certificate. Never throws — a mail failure for one org must not
 * stop the others, and this runs unattended.
 */
export async function sweepCertExpiry(
  admin: SupabaseClient,
  env: Env,
  opts: { warnDays?: number; now?: Date; force?: boolean } = {},
): Promise<ExpirySweepResult> {
  const now = opts.now ?? new Date();
  const warnDays = opts.warnDays ?? CERT_EXPIRY_WARN_DAYS;
  const due = await certsNeedingExpiryWarning(admin, warnDays, now);
  const result: ExpirySweepResult = { checked: due.length, warned: 0, skippedAlreadyWarned: 0, noRecipients: 0 };

  for (const { orgId, cert } of due) {
    try {
      const { data: cred } = await admin
        .from("efs_soap_credentials")
        .select("tls_expiry_warned_for")
        .eq("org_id", orgId)
        .maybeSingle();
      const alreadyWarned = (cred as { tls_expiry_warned_for: string | null } | null)?.tls_expiry_warned_for;
      if (!opts.force && alreadyWarned === marker(cert)) {
        result.skippedAlreadyWarned += 1;
        continue;
      }

      // Log unconditionally, even when there is nobody to email. A certificate about to take the feed
      // down must leave a trace somewhere an engineer will find it.
      console.warn(
        `[efs-soap-tls] org ${orgId}: client certificate ${cert.fingerprintSha256.slice(0, 16)}… ` +
          `(${cert.subject}) ${cert.daysUntilExpiry <= 0 ? "EXPIRED" : `expires in ${cert.daysUntilExpiry} days`} ` +
          `on ${cert.notAfter.slice(0, 10)}`,
      );

      const { data: org } = await admin
        .from("organizations")
        .select("name, notification_emails, notifications_enabled")
        .eq("id", orgId)
        .maybeSingle();
      const o = org as { name: string; notification_emails: string[] | null; notifications_enabled: boolean | null } | null;
      const recipients = (o?.notification_emails ?? []).filter(Boolean);
      // An EXPIRED certificate is an outage; it is sent even when routine notifications are switched
      // off, because "we turned off the daily digest" is not consent to miss an integration going dark.
      const suppressed = o?.notifications_enabled === false && bandFor(cert) !== "expired";
      if (!recipients.length || suppressed) {
        result.noRecipients += 1;
        continue;
      }

      const body = bodyFor(cert, o?.name ?? "your fleet");
      const sent = await sendEmail(env, {
        to: recipients,
        subject: subjectFor(cert, o?.name ?? "your fleet"),
        ...body,
      });
      if (!sent.ok) {
        console.error(`[efs-soap-tls] org ${orgId}: expiry email failed (${sent.provider} ${sent.status ?? ""}) ${sent.detail ?? ""}`);
        continue; // leave the marker unset so the next sweep retries
      }
      await admin
        .from("efs_soap_credentials")
        .update({ tls_expiry_warned_at: now.toISOString(), tls_expiry_warned_for: marker(cert) })
        .eq("org_id", orgId);
      result.warned += 1;
    } catch (e) {
      console.error(`[efs-soap-tls] expiry sweep failed for org ${orgId}:`, e instanceof Error ? e.message : e);
    }
  }
  return result;
}

/**
 * Daily timer. Started from schedulers.ts alongside the EFS SOAP poller. First pass 3 minutes after
 * boot — late enough not to compete with startup, early enough that a deploy surfaces an already-
 * expired certificate straight away instead of up to 24 hours later.
 */
export function startEfsSoapCertExpiryWatcher(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  let running = false;
  const pass = async () => {
    if (running) return;
    running = true;
    try {
      const r = await sweepCertExpiry(getSupabaseAdmin(env), env);
      if (r.checked) {
        console.log(
          `[efs-soap-tls] expiry sweep — ${r.checked} certificate(s) in the warning band, ${r.warned} notified, ` +
            `${r.skippedAlreadyWarned} already notified, ${r.noRecipients} with no recipient`,
        );
      }
    } catch (e) {
      console.error("[efs-soap-tls] expiry sweep failed:", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  setTimeout(pass, 180_000);
  setInterval(pass, 24 * 3_600_000);
}

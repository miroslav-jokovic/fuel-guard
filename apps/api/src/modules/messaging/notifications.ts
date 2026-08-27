import type { SupabaseClient } from "@supabase/supabase-js";
import { renderAnomalyAlertEmail, type AnomalyEmailItem, type AnomalySeverity } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { makeSender, type Sender } from "../../lib/mailer.js";

/**
 * Email the org's recipients about high/critical anomalies on a transaction (audit Phase 8).
 * Best-effort: returns false (never throws) if disabled, no recipients, nothing to report, or send
 * fails. The mailer is injectable for tests.
 */
export async function notifyForTransaction(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  txnId: string,
  sender?: Sender,
): Promise<boolean> {
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("name, notification_emails, notifications_enabled")
    .eq("id", orgId)
    .maybeSingle();
  if (orgError) {
    console.error(`[email-alert] organization lookup failed for org ${orgId}: ${orgError.message}`);
    return false;
  }
  if (!org || !org.notifications_enabled || !(org.notification_emails?.length > 0)) return false;

  const { data: anomalies, error: anomalyError } = await admin
    .from("anomalies")
    .select("rule_id, severity, message, vehicles(unit_number)")
    .eq("transaction_id", txnId)
    .eq("status", "open")
    .in("severity", ["high", "critical"]);
  if (anomalyError) {
    console.error(`[email-alert] anomaly lookup failed for transaction ${txnId}: ${anomalyError.message}`);
    return false;
  }

  const items: AnomalyEmailItem[] = ((anomalies ?? []) as unknown as {
    rule_id: string;
    severity: AnomalySeverity;
    message: string;
    vehicles: { unit_number: string } | null;
  }[]).map((a) => ({ unit: a.vehicles?.unit_number ?? "—", rule_id: a.rule_id, severity: a.severity, message: a.message }));

  if (items.length === 0) return false;

  const email = renderAnomalyAlertEmail(org.name, items, env.WEB_APP_URL);
  const send = sender ?? makeSender(env);
  try {
    const sent = await send({ to: org.notification_emails as string[], subject: email.subject, html: email.html, text: email.text });
    if (!sent) console.error(`[email-alert] delivery reported failure for org ${orgId}, transaction ${txnId}`);
    return sent;
  } catch (error) {
    console.error(`[email-alert] delivery threw for org ${orgId}, transaction ${txnId}:`, error instanceof Error ? error.message : error);
    return false;
  }
}

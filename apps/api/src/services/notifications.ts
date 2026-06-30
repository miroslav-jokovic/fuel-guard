import type { SupabaseClient } from "@supabase/supabase-js";
import { renderAnomalyAlertEmail, type AnomalyEmailItem, type AnomalySeverity } from "@fleetguard/shared";
import type { Env } from "../env.js";
import { makeSender, type Sender } from "../lib/mailer.js";

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
  const { data: org } = await admin
    .from("organizations")
    .select("name, notification_emails, notifications_enabled")
    .eq("id", orgId)
    .maybeSingle();
  if (!org || !org.notifications_enabled || !(org.notification_emails?.length > 0)) return false;

  const { data: anomalies } = await admin
    .from("anomalies")
    .select("rule_id, severity, message, vehicles(unit_number)")
    .eq("transaction_id", txnId)
    .eq("status", "open")
    .in("severity", ["high", "critical"]);

  const items: AnomalyEmailItem[] = ((anomalies ?? []) as unknown as {
    rule_id: string;
    severity: AnomalySeverity;
    message: string;
    vehicles: { unit_number: string } | null;
  }[]).map((a) => ({ unit: a.vehicles?.unit_number ?? "—", rule_id: a.rule_id, severity: a.severity, message: a.message }));

  if (items.length === 0) return false;

  const email = renderAnomalyAlertEmail(org.name, items, env.WEB_APP_URL);
  const send = sender ?? makeSender(env);
  return send({ to: org.notification_emails as string[], subject: email.subject, html: email.html, text: email.text });
}

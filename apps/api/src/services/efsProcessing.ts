import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CASE_RULE_ID } from "@silvicom/shared";
import type { Env } from "../env.js";
import { scoreDeclinedImport } from "./declinedScoring.js";
import { scoreImportWithCascade } from "./scoring/index.js";
import { notify } from "./notify.js";

export type EfsProcessingFeed = "posted" | "rejected";

interface ProcessingRow {
  id: string;
  org_id: string;
  import_id: string;
  feed: EfsProcessingFeed;
  status: "pending" | "running" | "succeeded" | "failed";
  attempts: number;
}

const ALERT_ROLES = ["admin", "fleet_manager", "safety_manager"];
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

export async function registerEfsProcessingRun(
  admin: SupabaseClient,
  input: { orgId: string; importId: string; feed: EfsProcessingFeed },
): Promise<string> {
  const id = randomUUID();
  const { data, error } = await admin
    .from("efs_processing_runs")
    .upsert(
      {
        id,
        org_id: input.orgId,
        import_id: input.importId,
        feed: input.feed,
        status: "pending",
        next_attempt_at: new Date().toISOString(),
      },
      { onConflict: "org_id,import_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.id) return data.id as string;

  const existing = await admin
    .from("efs_processing_runs")
    .select("id")
    .eq("org_id", input.orgId)
    .eq("import_id", input.importId)
    .single();
  if (existing.error || !existing.data) throw new Error(existing.error?.message ?? "Could not register EFS processing run.");
  return existing.data.id as string;
}

async function recipients(admin: SupabaseClient, orgId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("memberships")
    .select("user_id")
    .eq("org_id", orgId)
    .in("role", ALERT_ROLES);
  if (error) throw new Error(error.message);
  return [...new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id))];
}

async function emitFuelAlerts(
  admin: SupabaseClient,
  orgId: string,
  importId: string,
): Promise<{ alerts: number; notifications: number }> {
  const { data: txns, error: txnsError } = await admin
    .from("fuel_transactions")
    .select("id")
    .eq("org_id", orgId)
    .eq("import_id", importId);
  if (txnsError) throw new Error(txnsError.message);
  const transactionIds = ((txns ?? []) as { id: string }[]).map((r) => r.id);
  if (!transactionIds.length) return { alerts: 0, notifications: 0 };

  const { data: anomalies, error } = await admin
    .from("anomalies")
    .select("id, transaction_id, severity, message")
    .eq("org_id", orgId)
    .in("transaction_id", transactionIds)
    .eq("rule_id", CASE_RULE_ID)
    .in("status", ["open", "investigating"])
    .in("severity", ["high", "critical"]);
  if (error) throw new Error(error.message);
  const rows = (anomalies ?? []) as { id: string; transaction_id: string; severity: "high" | "critical"; message: string }[];
  if (!rows.length) return { alerts: 0, notifications: 0 };

  const users = await recipients(admin, orgId);
  let notifications = 0;
  for (const alert of rows) {
    for (const userId of users) {
      const id = await notify(admin, {
        orgId,
        userId,
        category: "fuel_alert",
        title: alert.severity === "critical" ? "Critical fuel alert" : "Fuel alert needs review",
        body: alert.message,
        severity: alert.severity === "critical" ? "critical" : "warning",
        entityType: "anomaly",
        entityId: alert.id,
        dedupeKey: `fuel_alert:${alert.id}`,
      });
      if (id) notifications++;
    }
  }
  return { alerts: rows.length, notifications };
}

async function emitDeclinedAlerts(
  admin: SupabaseClient,
  orgId: string,
  importId: string,
): Promise<{ alerts: number; notifications: number }> {
  const { data, error } = await admin
    .from("declined_transactions")
    .select("id, suspicion_level, error_code, error_description, unit")
    .eq("org_id", orgId)
    .eq("import_id", importId)
    .in("suspicion_level", ["alert", "review"]);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as {
    id: string;
    suspicion_level: "alert" | "review";
    error_code: string | null;
    error_description: string | null;
    unit: string | null;
  }[];
  if (!rows.length) return { alerts: 0, notifications: 0 };

  const users = await recipients(admin, orgId);
  let notifications = 0;
  for (const alert of rows) {
    for (const userId of users) {
      const id = await notify(admin, {
        orgId,
        userId,
        category: "declined_alert",
        title: alert.suspicion_level === "alert" ? "Declined card alert" : "Declined card needs review",
        body: `${alert.unit ? `Unit ${alert.unit}: ` : ""}${alert.error_code ?? "EFS decline"} — ${alert.error_description ?? "Review the rejected authorization."}`,
        severity: alert.suspicion_level === "alert" ? "critical" : "warning",
        entityType: "declined_transaction",
        entityId: alert.id,
        dedupeKey: `declined_alert:${alert.id}`,
      });
      if (id) notifications++;
    }
  }
  return { alerts: rows.length, notifications };
}

async function claim(admin: SupabaseClient, id: string): Promise<ProcessingRow | null> {
  const { data, error } = await admin.rpc("claim_efs_processing_run", { p_id: id });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return row ? (row as ProcessingRow) : null;
}

export async function processEfsProcessingRun(
  admin: SupabaseClient,
  env: Env,
  processingId: string,
): Promise<Record<string, unknown>> {
  const row = await claim(admin, processingId);
  if (!row) return { skipped: true };
  try {
    if (row.feed === "posted") await scoreImportWithCascade(admin, env, row.org_id, row.import_id);
    else await scoreDeclinedImport(admin, env, row.org_id, row.import_id);

    const result = row.feed === "posted"
      ? await emitFuelAlerts(admin, row.org_id, row.import_id)
      : await emitDeclinedAlerts(admin, row.org_id, row.import_id);
    await admin
      .from("efs_processing_runs")
      .update({
        status: "succeeded",
        scoring_completed_at: new Date().toISOString(),
        alerts_created: result.alerts,
        notifications_created: result.notifications,
        last_error: null,
      })
      .eq("id", processingId);
    return { feed: row.feed, importId: row.import_id, ...result };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const delay = RETRY_DELAYS_MS[Math.min(row.attempts - 1, RETRY_DELAYS_MS.length - 1)] ?? RETRY_DELAYS_MS.at(-1)!;
    await admin
      .from("efs_processing_runs")
      .update({
        status: "failed",
        next_attempt_at: new Date(Date.now() + delay).toISOString(),
        last_error: error,
      })
      .eq("id", processingId);
    throw e;
  }
}

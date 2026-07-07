import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_MODELS, CASE_RULE_ID, renderDigestEmail } from "@fuelguard/shared";
import type { Env } from "../env.js";
import { callClaudeText } from "../lib/anthropic.js";
import { makeSender } from "../lib/mailer.js";

const WINDOW_DAYS = 7;

export interface DigestHealth {
  lastCheckLabel: string | null;
  driftFixed: number;
  syncFailures: number;
  /** EFS reports auto-imported this week by the ingestion scheduler (0 = none delivered). */
  efsIngested: number;
  /** Auto-imports that landed with a row shortfall this week (>0 needs a look — possible data loss). */
  efsShortfalls: number;
  /** EFS deliveries this week that could not be imported (unreadable/unrecognized/errored — >0 to review). */
  efsQuarantined: number;
}

export interface DigestData {
  since: string;
  alertCount: number;
  alerts: { unit: string; severity: string; message: string; fueledAt: string | null }[];
  siphonCount: number;
  siphons: { unit: string; dropPct: number | null; at: string }[];
  declineAlertCount: number;
  topVehicles: { unit: string; count: number }[];
  health: DigestHealth;
}

/** Coarse "x ago" label for a timestamp (server-side; for the digest data-health line). */
function agoLabel(iso: string | null): string | null {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

/** Data-health from the jobs ledger over the window: nightly-reconcile drift + any failed jobs. */
async function buildDigestHealth(admin: SupabaseClient, orgId: string, since: string): Promise<DigestHealth> {
  const { data } = await admin
    .from("jobs")
    .select("kind, status, stats, finished_at")
    .eq("org_id", orgId)
    .gte("created_at", since);
  const rows = (data ?? []) as { kind: string; status: string; stats: Record<string, unknown> | null; finished_at: string | null }[];
  let syncFailures = 0;
  let driftFixed = 0;
  let efsIngested = 0;
  let efsShortfalls = 0;
  let efsQuarantined = 0;
  let lastCheck: string | null = null;
  for (const r of rows) {
    if (r.status === "failed") syncFailures++;
    if (r.kind === "nightly_reconcile" && r.status === "done") {
      const d = Number((r.stats ?? {}).driftFixed ?? 0);
      if (Number.isFinite(d)) driftFixed += d;
      if (r.finished_at && (!lastCheck || r.finished_at > lastCheck)) lastCheck = r.finished_at;
    }
    if (r.kind === "efs_ingest" && r.status === "done") {
      const stats = r.stats ?? {};
      const ing = Number(stats.ingested ?? 0);
      const sf = Number(stats.shortfalls ?? 0);
      // Deliveries needing a human: files moved to error/ (quarantined) plus any that hit an infra error.
      const bad = Number(stats.quarantined ?? 0) + Number(stats.errored ?? 0);
      if (Number.isFinite(ing)) efsIngested += ing;
      if (Number.isFinite(sf)) efsShortfalls += sf;
      if (Number.isFinite(bad)) efsQuarantined += bad;
    }
  }
  return { lastCheckLabel: agoLabel(lastCheck), driftFixed, syncFailures, efsIngested, efsShortfalls, efsQuarantined };
}

export interface DigestResult {
  sent: boolean;
  reason: string | null;
  summary: string | null;
}

/** Aggregate the last week's theft signals for one org. */
export async function buildDigestData(admin: SupabaseClient, orgId: string): Promise<DigestData> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();

  const { data: vehRows } = await admin.from("vehicles").select("id, unit_number").eq("org_id", orgId);
  const unitOf = new Map((vehRows ?? []).map((v) => [v.id as string, v.unit_number as string]));
  const unit = (id: string | null) => (id ? (unitOf.get(id) ?? "—") : "Unattributed");

  const { data: alertRows } = await admin
    .from("anomalies")
    .select("vehicle_id, severity, message, fueled_at")
    .eq("org_id", orgId)
    .eq("rule_id", CASE_RULE_ID)
    .in("severity", ["high", "critical"])
    .in("status", ["open", "investigating"])
    .gte("fueled_at", since)
    .order("fueled_at", { ascending: false })
    .limit(50);
  const alerts = (alertRows ?? []).map((a) => ({ unit: unit(a.vehicle_id as string | null), severity: a.severity as string, message: a.message as string, fueledAt: a.fueled_at as string | null }));

  const byVeh = new Map<string, number>();
  for (const a of alerts) byVeh.set(a.unit, (byVeh.get(a.unit) ?? 0) + 1);
  const topVehicles = [...byVeh.entries()].map(([u, c]) => ({ unit: u, count: c })).sort((a, b) => b.count - a.count).slice(0, 5);

  const { data: sipRows } = await admin
    .from("fuel_events")
    .select("vehicle_id, drop_pct, happened_at")
    .eq("org_id", orgId)
    .gte("happened_at", since)
    .order("happened_at", { ascending: false })
    .limit(20);
  const siphons = (sipRows ?? []).map((s) => ({ unit: unit(s.vehicle_id as string | null), dropPct: s.drop_pct as number | null, at: s.happened_at as string }));

  const { count: declineAlertCount } = await admin
    .from("declined_transactions")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("suspicion_level", "alert")
    .gte("declined_at", since);

  const health = await buildDigestHealth(admin, orgId, since);

  return {
    since,
    alertCount: alerts.length,
    alerts: alerts.slice(0, 8),
    siphonCount: siphons.length,
    siphons: siphons.slice(0, 5),
    declineAlertCount: declineAlertCount ?? 0,
    topVehicles,
    health,
  };
}

const DIGEST_SYSTEM = `You are a fleet fuel-theft analyst writing a concise WEEKLY briefing for the
owner. From the JSON data, write a short, plain-language summary (2–4 short paragraphs) covering: the
most serious theft cases, any repeat-offender vehicles, siphoning (fuel-drop) events, suspicious declined
attempts, and one clear recommended focus for the week. Be direct and factual. Use ONLY the numbers
provided — never invent figures. If there is little or no activity, say so plainly and reassuringly.`;

/** Build + summarize + email the weekly digest for one org. Best-effort; returns why it didn't send. */
export async function generateAndSendDigest(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  opts: { force?: boolean } = {},
): Promise<DigestResult> {
  const { data: org } = await admin
    .from("organizations")
    .select("name, notification_emails, notifications_enabled")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) return { sent: false, reason: "org_not_found", summary: null };
  const recipients = (org.notification_emails ?? []) as string[];
  if (recipients.length === 0) return { sent: false, reason: "no_recipients", summary: null };
  if (!opts.force && org.notifications_enabled === false) return { sent: false, reason: "notifications_disabled", summary: null };
  if (!env.ANTHROPIC_API_KEY) return { sent: false, reason: "ai_unavailable", summary: null };

  const data = await buildDigestData(admin, orgId);
  let summary: string;
  try {
    summary = await callClaudeText(env, AI_MODELS.fast, DIGEST_SYSTEM, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("[digest] AI summary failed:", e instanceof Error ? e.message : e);
    return { sent: false, reason: "ai_failed", summary: null };
  }

  const mail = renderDigestEmail((org.name as string) ?? "FuelGuard", summary, {
    alertCount: data.alertCount,
    siphonCount: data.siphonCount,
    declineAlertCount: data.declineAlertCount,
    topVehicles: data.topVehicles,
    appUrl: env.WEB_APP_URL,
    health: data.health,
  });
  const sent = await makeSender(env)({ to: recipients, subject: mail.subject, html: mail.html, text: mail.text });
  return { sent, reason: sent ? null : "send_failed", summary };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { reconcile, type MetaObjectSeen, type ReconcileMismatch, type ReconcileOurCampaign } from "@silvicom/shared";
import { completeAction, startAction } from "../actions/actionLedger.js";
import { sendAdsAlert } from "../alerts/adsAlerts.js";
import type { MetaGraph } from "../platforms/meta/graphClient.js";
import { graphForConnection, type RegistryDeps } from "../platforms/registry.js";
import { INSIGHTS_MAX_DAYS, pullConnectionInsights, type InsightsResult } from "./insightsPull.js";
import { externalChangeKey, isNoSuchObject } from "./recordedGone.js";

/**
 * The daily reconcile (ADS-AGENT-BUILD-WORKFLOW.md B5c; D-AD4). For one connection: what Meta holds for every
 * campaign of ours (campaign, ad set — status, amounts) and every campaign the account lists, against our
 * rows; `reconcile` (packages/shared, pure) names the mismatches; each is recorded ONCE as an `ads_actions`
 * row of kind `external_change` (actor `platform`: Meta reported it, nobody here did it) and rung on the bell
 * as `ads_external_change` — or `ads_overspend` for an overrun.
 *
 * ── NEVER ADOPTED ────────────────────────────────────────────────────────────────────────────────
 * Nothing here writes a campaign row, a status or a budget, here or at Meta. The campaign machine has
 * `platform_paused` / `platform_activated` rows for mirroring Meta's status into ours; B5c does not use them
 * (the handoff's §3: "every mismatch is one external_change event + alert, never adopted"). A person reads the
 * alert and decides — in Ads Manager or on our screens.
 *
 * ── ONCE PER FACT, WITHOUT A NEW TABLE ───────────────────────────────────────────────────────────
 * The row's idempotency key is `external_change:<connection>:<mismatch key>` — the object, the field, Meta's
 * value. The ledger's `unique (org_id, idempotency_key)` (0537) answers a second insert of the same fact with
 * 23505, which is read as "already recorded": no row, no bell. So the same edit standing for a week is one row
 * and one alert; the next value on that field is a new one. This is the ledger's own guarantee, not a table of
 * "seen" mismatches we would have to keep in step.
 *
 * ── AND THE 28-DAY RE-READ ───────────────────────────────────────────────────────────────────────
 * Meta keeps revising insights for 28 days (B5a header); the hourly pull re-reads three. Once a day the same
 * job re-reads all 28 into `ads_spend_hourly` first, so the overrun check — and the guard's month — read
 * Meta's settled numbers.
 *
 * ── WHAT IS NEVER SILENT ─────────────────────────────────────────────────────────────────────────
 * A read Meta refuses for any reason other than "does not exist" is reported, and that object is left out of
 * the comparison rather than called missing: a throttle is not a deleted campaign. The job fails on any of
 * them, so it is listed. The run that first records a deleted campaign still fails, because its insights re-read
 * comes before the comparison; from the next run the record settles that refusal (Q-AD35, `recordedGone.ts`).
 */

const AGENT_NAME = "Meta (reconcile)";
const PAGE = 100;
const PAGES_MAX = 50;

export interface ReconcileDeps extends RegistryDeps {
  admin: SupabaseClient;
  now: () => Date;
}

export interface ReconcileResult {
  connection_id: string;
  insights: InsightsResult | null;
  compared: number;
  recorded: Array<{ field: ReconcileMismatch["field"]; meta_id: string }>;
  already_recorded: number;
  failures: Array<{ campaign_id?: string; reason: string }>;
}

type Read = { kind: "seen"; object: MetaObjectSeen } | { kind: "gone" } | { kind: "failed"; reason: string };

async function readObject(graph: MetaGraph, id: string, amountField: "spend_cap" | "daily_budget"): Promise<Read> {
  const r = await graph.get<{ id?: string; name?: unknown; status?: unknown; spend_cap?: unknown; daily_budget?: unknown }>(id, { fields: `id,name,status,${amountField}` });
  if (!r.ok) return isNoSuchObject(r.error) ? { kind: "gone" } : { kind: "failed", reason: `graph:${r.error.error_code}` };
  const amount = Number(r.data[amountField]);
  return {
    kind: "seen",
    object: {
      id, name: typeof r.data.name === "string" ? r.data.name : null, status: typeof r.data.status === "string" ? r.data.status : null,
      amount_cents: r.data[amountField] != null && Number.isFinite(amount) && amount > 0 ? amount : null,
    },
  };
}

async function accountCampaigns(graph: MetaGraph, accountRef: string): Promise<MetaObjectSeen[] | null> {
  const out: MetaObjectSeen[] = [];
  let after: string | undefined;
  for (let page = 0; page < PAGES_MAX; page += 1) {
    const r = await graph.get<{ data?: Array<{ id?: unknown; name?: unknown; status?: unknown }>; paging?: { cursors?: { after?: string }; next?: string } }>(
      `act_${accountRef}/campaigns`, { fields: "id,name,status", limit: PAGE, after },
    );
    if (!r.ok || !Array.isArray(r.data.data)) return null;
    for (const k of r.data.data) {
      if (typeof k.id === "string") out.push({ id: k.id, name: typeof k.name === "string" ? k.name : null, status: typeof k.status === "string" ? k.status : null, amount_cents: null });
    }
    after = r.data.paging?.cursors?.after;
    if (!r.data.paging?.next || !after) return out;
  }
  return null;
}

/** Our campaigns on this connection that reached Meta, with their lifetime spend from our copy of Meta's numbers. */
async function ourCampaigns(admin: SupabaseClient, orgId: string, connectionId: string): Promise<ReconcileOurCampaign[]> {
  const { data, error } = await admin
    .from("ads_campaigns").select("id, state, daily_budget_cents, lifetime_cap_cents, platform_refs")
    .eq("org_id", orgId).eq("connection_id", connectionId).order("id").limit(1000);
  if (error) throw new Error(`ads_campaigns: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; state: ReconcileOurCampaign["state"]; daily_budget_cents: number | null; lifetime_cap_cents: number | null; platform_refs: Record<string, unknown> | null }>;
  if (rows.length >= 1000) throw new Error(`ads_campaigns: connection ${connectionId} returned a full page`);
  const out: ReconcileOurCampaign[] = [];
  for (const r of rows) {
    const mc = r.platform_refs?.meta_campaign_id;
    if (typeof mc !== "string" || !mc) continue;
    let spend = 0;
    for (let from = 0; ; from += 1000) {
      const { data: hrs, error: hErr } = await admin.from("ads_spend_hourly").select("spend_cents").eq("org_id", orgId).eq("campaign_id", r.id).order("hour").range(from, from + 999);
      if (hErr) throw new Error(`ads_spend_hourly: ${hErr.message}`);
      const got = (hrs ?? []) as Array<{ spend_cents: number }>;
      for (const h of got) spend += Number(h.spend_cents);
      if (got.length < 1000) break;
    }
    const adset = r.platform_refs?.meta_adset_id;
    out.push({
      campaign_id: r.id, state: r.state, meta_campaign_id: mc, meta_adset_id: typeof adset === "string" && adset ? adset : null,
      daily_budget_cents: r.daily_budget_cents === null ? null : Number(r.daily_budget_cents),
      lifetime_cap_cents: r.lifetime_cap_cents === null ? null : Number(r.lifetime_cap_cents), lifetime_spend_cents: spend,
    });
  }
  return out;
}

const LABEL: Record<ReconcileMismatch["field"], string> = {
  missing: "is no longer on the platform", status: "had its status changed", daily_budget: "had its daily budget changed",
  spend_cap: "had its lifetime spending cap changed", overrun: "spent past its approved lifetime amount", not_ours: "was made outside Silvicom",
};

function alertFor(m: ReconcileMismatch, connectionId: string): Parameters<typeof sendAdsAlert>[2] {
  const what = m.level === "adset" ? "An ad set" : "A campaign";
  const money = (v: string | number | null) => (typeof v === "number" ? `$${(v / 100).toFixed(2)}` : v === null ? "none" : String(v));
  const amounts = m.field === "daily_budget" || m.field === "spend_cap" || m.field === "overrun";
  const detail = amounts ? `Approved here: ${money(m.ours)}. On the platform now: ${money(m.theirs)}.`
    : m.field === "not_ours" ? `Its status is ${m.theirs ?? "unknown"}. It spends from the same ad account, so it counts against your monthly cap.`
    : `Expected: ${m.ours ?? "—"}. On the platform now: ${m.theirs ?? "gone"}.`;
  return {
    category: m.field === "overrun" ? "ads_overspend" : "ads_external_change",
    title: `${what} ${LABEL[m.field]}`,
    body: `${detail} Nothing was changed back automatically; check it in Meta Ads Manager.`,
    severity: m.severity, entityType: m.campaign_id ? "ads_campaign" : "ads_platform_connection", entityId: m.campaign_id ?? connectionId,
    dedupeKey: `ads_reconcile:${connectionId}:${m.key}`,
  };
}

export async function reconcileConnection(deps: ReconcileDeps, orgId: string, connectionId: string): Promise<ReconcileResult> {
  const result: ReconcileResult = { connection_id: connectionId, insights: null, compared: 0, recorded: [], already_recorded: 0, failures: [] };
  const { data: conn, error } = await deps.admin
    .from("ads_platform_connections").select("id, org_id, provider, is_sandbox, token_sealed, account_ref, status")
    .eq("org_id", orgId).eq("id", connectionId).maybeSingle();
  if (error) throw new Error(`ads_platform_connections: ${error.message}`);
  const c = conn as { id: string; org_id: string; provider: string; is_sandbox: boolean; token_sealed: string | null; account_ref: string | null; status: string } | null;
  if (!c || (c.provider !== "meta" && c.provider !== "simulator")) return result;
  if (c.status === "disconnected" || !c.account_ref) {
    result.failures.push({ reason: `connection:${c.account_ref ? c.status : "no_account"}` });
    return result;
  }

  result.insights = await pullConnectionInsights(deps, orgId, connectionId, { days: INSIGHTS_MAX_DAYS });
  for (const f of result.insights.failures) result.failures.push({ ...f, reason: `insights:${f.reason}` });

  const opened = await graphForConnection(deps, c);
  if (!opened.ok) {
    result.failures.push({ reason: `graph:${opened.error_code}` });
    return result;
  }
  const ours = await ourCampaigns(deps.admin, orgId, connectionId);
  const objects = new Map<string, MetaObjectSeen>();
  const compared: ReconcileOurCampaign[] = [];
  for (const k of ours) {
    const camp = await readObject(opened.graph, k.meta_campaign_id, "spend_cap");
    const set = k.meta_adset_id ? await readObject(opened.graph, k.meta_adset_id, "daily_budget") : null;
    const failed = [camp, set].find((x): x is Extract<Read, { kind: "failed" }> => x?.kind === "failed");
    if (failed) {
      result.failures.push({ campaign_id: k.campaign_id, reason: failed.reason });
      continue;
    }
    if (camp.kind === "seen") objects.set(k.meta_campaign_id, camp.object);
    if (set?.kind === "seen") objects.set(k.meta_adset_id!, set.object);
    compared.push(k);
  }
  const listed = await accountCampaigns(opened.graph, c.account_ref);
  if (!listed) result.failures.push({ reason: "account_campaigns" });
  result.compared = compared.length;

  // Campaigns whose read failed are left out of both sides, so they are neither "missing" nor "not ours".
  const skipped = new Set(ours.filter((k) => !compared.includes(k)).map((k) => k.meta_campaign_id));
  const at = deps.now().toISOString();
  for (const m of reconcile({ ours: compared, objects, account_campaigns: (listed ?? []).filter((k) => !skipped.has(k.id)) })) {
    // `startAction` answers the ledger's 23505 as "duplicate" — the fact is already recorded (header).
    const row = await startAction(deps.admin, {
      org_id: orgId, campaign_id: m.campaign_id, connection_id: connectionId, kind: "external_change",
      actor_kind: "platform", actor_id: null, actor_name: AGENT_NAME, cause: `${m.level} ${m.field}: ours ${m.ours ?? "none"}, Meta ${m.theirs ?? "none"}`,
      idempotency_key: externalChangeKey(connectionId, m.key),
      request: { level: m.level, meta_id: m.meta_id, field: m.field, ours: m.ours, theirs: m.theirs, severity: m.severity },
    }, at);
    if (row === "duplicate") {
      result.already_recorded += 1;
      continue;
    }
    if (!("id" in row)) throw new Error(`ads_actions: external_change refused by ${row.refusedBy}`);
    await completeAction(deps.admin, orgId, row.id, { status: "succeeded", at });
    result.recorded.push({ field: m.field, meta_id: m.meta_id });
    await sendAdsAlert(deps.admin, orgId, alertFor(m, connectionId));
  }
  return result;
}

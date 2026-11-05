import type { SupabaseClient } from "@supabase/supabase-js";
import { ADS_CONNECTION_VIEW_COLUMNS, type AdsConnectionView, type AdsMetaConnect } from "@silvicom/shared";
import { writeAudit } from "../../../lib/audit.js";
import { seal, secretAad } from "../../../lib/secretBox.js";
import { recordFinished } from "../actions/actionLedger.js";
import { testMetaConnection, type ConnectionReport, type ConnectionTarget } from "../platforms/meta/connectionTest.js";
import { MetaGraph } from "../platforms/meta/graphClient.js";
import {
  graphForConnection,
  metaPageTokenPurpose,
  metaTokenPurpose,
  SIMULATOR_ACCOUNT_ID,
  SIMULATOR_PAGE_ID,
  type ConnectionForGraph,
  type RegistryDeps,
} from "../platforms/registry.js";

/**
 * `ads_platform_connections` (0537) — the doors behind Settings › Ads control's connections (B1b).
 *
 *   connect (Meta)  test the pasted token FIRST; a token Meta refuses is stored nowhere. Otherwise seal
 *                   it and the Page token the test derived, and save the row `connected` or `failing`
 *                   with the report, so a connection missing a scope or a spending limit is visible
 *                   and fixable without pasting the token again.
 *   test            run the connection test again on the stored token (or on the simulator).
 *   connect simulator   only where `simulatorGate` allows (`platforms/registry.ts`).
 *   disconnect      clear both tokens. REFUSED while any campaign on the connection may be delivering:
 *                   pausing it needs the token, so disconnecting first would leave an ad running that
 *                   nothing here can stop — the kill switch included.
 *   reconnect       connect again on the same slot. A new token for the SAME account and Page is always
 *                   allowed (it is how a dead token is fixed). Moving the slot to ANOTHER account or Page
 *                   is refused while a campaign on it may be delivering, the disconnect rule's reason:
 *                   a campaign's connection never changes (AX031), so its Meta ids would be paused with a
 *                   token for a different account, and fail (2026-11-03 audit H3).
 *
 * Every test writes one `ads_actions` row (`connection_test`), whoever ran it. Connect and disconnect also
 * write `audit_logs`: who handed the carrier's ad account to us, or took it back.
 *
 * A row is written with a read, then an UPDATE or an INSERT — never `.upsert()` with a partial payload
 * (`lint:upserts`). Two admins connecting at once: the second INSERT meets `unique (org_id, provider,
 * is_sandbox)` and becomes an UPDATE.
 */

export interface ConnectionActor {
  id: string;
  name: string;
}

export interface ConnectionDeps extends RegistryDeps {
  admin: SupabaseClient;
  now: () => Date;
  /** Meta's base URL for a pasted token (tests point it at FakeMeta); the real Graph otherwise. */
  metaBaseUrl?: string;
}

export type ConnectOutcome =
  | { kind: "saved"; connection: AdsConnectionView; report: ConnectionReport }
  | { kind: "token_refused"; report: ConnectionReport }
  | { kind: "refused"; error_code: string; reason: string };

/** Live for delivery: what a disconnect would leave unpausable. */
const DELIVERING = ["launching", "live", "pausing"];

export async function listConnections(admin: SupabaseClient, orgId: string): Promise<AdsConnectionView[]> {
  const { data, error } = await admin.from("ads_platform_connections").select(ADS_CONNECTION_VIEW_COLUMNS).eq("org_id", orgId).order("created_at");
  if (error) throw new Error(`ads_platform_connections: ${error.message}`);
  return (data ?? []) as unknown as AdsConnectionView[];
}

export async function connectMeta(deps: ConnectionDeps, orgId: string, actor: ConnectionActor, ask: AdsMetaConnect): Promise<ConnectOutcome> {
  const accountId = ask.account_id.replace(/^act_/, "");
  const moved = await movesDeliveringSlot(deps.admin, orgId, ask.sandbox, accountId, ask.page_id);
  if (moved) return moved;
  // G-sec, 2026-11-05: the base URL is passed only when a test names one. `MetaGraph` spreads its options over
  // its defaults, so an explicit `baseUrl: undefined` — what the route's deps carry — replaced the real Graph
  // with nothing, and every Connect through the app answered 500 (the route sweep in
  // `security/adsRouteSweep.test.ts` found it; every earlier connect test handed FakeMeta's URL in).
  const graph = new MetaGraph({ token: ask.token, throttleKey: `connect:${orgId}`, ...(deps.metaBaseUrl ? { baseUrl: deps.metaBaseUrl } : {}), now: deps.now });
  const target: ConnectionTarget = { accountId, pageId: ask.page_id };
  const { report, pageToken, tokenRefused } = await testMetaConnection(graph, target);
  if (tokenRefused) return { kind: "token_refused", report };

  // Seal before any write: no SECRETS_ENCRYPTION_KEY → seal throws, and nothing is stored in plaintext.
  const token_sealed = seal(deps.env, ask.token, secretAad(orgId, metaTokenPurpose(ask.sandbox)));
  const page_token_sealed = pageToken ? seal(deps.env, pageToken, secretAad(orgId, metaPageTokenPurpose(ask.sandbox))) : null;
  const connection = await saveRow(deps, orgId, "meta", ask.sandbox, {
    account_ref: accountId, page_ref: ask.page_id, token_sealed, page_token_sealed, connected_by: actor.id,
    ...testColumns(report, deps.now()),
  });
  await recordTest(deps, orgId, connection.id, actor, target, report);
  await writeAudit(deps.admin, {
    orgId, actorId: actor.id, action: "ads.connection.connect", entity: "ads_platform_connections", entityId: connection.id,
    meta: { provider: "meta", sandbox: ask.sandbox, account: accountId, page: ask.page_id, ok: report.ok },
  });
  return { kind: "saved", connection, report };
}

export async function connectSimulator(deps: ConnectionDeps, orgId: string, actor: ConnectionActor): Promise<ConnectOutcome> {
  const probe: ConnectionForGraph = { id: "simulator", org_id: orgId, provider: "simulator", is_sandbox: true, token_sealed: null };
  const opened = await graphForConnection(deps, probe);
  if (!opened.ok) return { kind: "refused", error_code: opened.error_code, reason: opened.reason };
  const target: ConnectionTarget = { accountId: SIMULATOR_ACCOUNT_ID, pageId: SIMULATOR_PAGE_ID };
  const { report } = await testMetaConnection(opened.graph, target);
  const connection = await saveRow(deps, orgId, "simulator", true, {
    account_ref: SIMULATOR_ACCOUNT_ID, page_ref: SIMULATOR_PAGE_ID, token_sealed: null, page_token_sealed: null, connected_by: actor.id,
    ...testColumns(report, deps.now()),
  });
  await recordTest(deps, orgId, connection.id, actor, target, report);
  await writeAudit(deps.admin, {
    orgId, actorId: actor.id, action: "ads.connection.connect", entity: "ads_platform_connections", entityId: connection.id,
    meta: { provider: "simulator", ok: report.ok },
  });
  return { kind: "saved", connection, report };
}

interface StoredConnection extends ConnectionForGraph {
  account_ref: string | null;
  page_ref: string | null;
  status: string;
}

export async function testConnection(deps: ConnectionDeps, orgId: string, actor: ConnectionActor, connectionId: string): Promise<ConnectOutcome | { kind: "not_found" }> {
  const { data, error } = await deps.admin
    .from("ads_platform_connections")
    .select("id, org_id, provider, is_sandbox, token_sealed, account_ref, page_ref, status")
    .eq("org_id", orgId).eq("id", connectionId).maybeSingle();
  if (error) throw new Error(`ads_platform_connections: ${error.message}`);
  const row = data as StoredConnection | null;
  if (!row) return { kind: "not_found" };
  if (row.status === "disconnected") return { kind: "refused", error_code: "disconnected", reason: "This connection is disconnected. Connect it again." };
  const opened = await graphForConnection(deps, row);
  if (!opened.ok) return { kind: "refused", error_code: opened.error_code, reason: opened.reason };
  const target: ConnectionTarget = { accountId: row.account_ref ?? "", pageId: row.page_ref ?? "" };
  const { report, pageToken } = await testMetaConnection(opened.graph, target);
  const patch: Record<string, unknown> = testColumns(report, deps.now());
  // A Page token Meta hands out again replaces the stored one (it changes when the Page's roles do).
  if (pageToken && row.provider === "meta") patch.page_token_sealed = seal(deps.env, pageToken, secretAad(orgId, metaPageTokenPurpose(row.is_sandbox)));
  const connection = await updateRow(deps.admin, orgId, row.id, patch);
  await recordTest(deps, orgId, row.id, actor, target, report);
  return { kind: "saved", connection, report };
}

export type DisconnectOutcome = { kind: "disconnected"; connection: AdsConnectionView } | { kind: "not_found" } | { kind: "refused"; error_code: "campaigns_delivering"; reason: string };

export async function disconnect(deps: ConnectionDeps, orgId: string, actor: ConnectionActor, connectionId: string): Promise<DisconnectOutcome> {
  if (await delivering(deps.admin, orgId, connectionId)) {
    return { kind: "refused", error_code: "campaigns_delivering", reason: "A campaign on this connection may still be delivering. Pause it first — pausing needs this connection." };
  }
  const { data, error } = await deps.admin
    .from("ads_platform_connections")
    .update({ status: "disconnected", token_sealed: null, page_token_sealed: null, scopes: [], last_error: null, updated_at: deps.now().toISOString() })
    .eq("org_id", orgId).eq("id", connectionId)
    .select(ADS_CONNECTION_VIEW_COLUMNS);
  if (error) throw new Error(`ads_platform_connections: ${error.message}`);
  const row = ((data ?? []) as unknown as AdsConnectionView[])[0];
  if (!row) return { kind: "not_found" };
  await writeAudit(deps.admin, { orgId, actorId: actor.id, action: "ads.connection.disconnect", entity: "ads_platform_connections", entityId: connectionId, meta: { provider: row.provider, sandbox: row.is_sandbox } });
  return { kind: "disconnected", connection: row };
}

async function delivering(admin: SupabaseClient, orgId: string, connectionId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("ads_campaigns").select("id").eq("org_id", orgId).eq("connection_id", connectionId).in("state", DELIVERING).limit(1);
  if (error) throw new Error(`ads_campaigns: ${error.message}`);
  return (data ?? []).length > 0;
}

/** The reconnect rule (header): a refusal when this connect would move a slot with delivering campaigns. */
async function movesDeliveringSlot(admin: SupabaseClient, orgId: string, sandbox: boolean, accountId: string, pageId: string): Promise<ConnectOutcome | null> {
  const { data, error } = await admin
    .from("ads_platform_connections").select("id, account_ref, page_ref")
    .eq("org_id", orgId).eq("provider", "meta").eq("is_sandbox", sandbox).maybeSingle();
  if (error) throw new Error(`ads_platform_connections: ${error.message}`);
  const slot = data as { id: string; account_ref: string | null; page_ref: string | null } | null;
  if (!slot || (slot.account_ref === accountId && slot.page_ref === pageId)) return null;
  if (!slot.account_ref && !slot.page_ref) return null;
  if (!(await delivering(admin, orgId, slot.id))) return null;
  return {
    kind: "refused",
    error_code: "campaigns_delivering",
    reason: "A campaign on this connection may still be delivering on its current ad account. Pause it first — pausing needs this account — then connect the other one.",
  };
}

/**
 * The pause path met a token the platform refuses, or one this deploy cannot open (2026-11-03 audit H2).
 * Before this, the row stayed `connected` after a 190, so Settings showed a healthy connection while
 * every pause on it failed. Only a `connected` row moves: a person's disconnect, or a test already
 * recorded as failing, is not overwritten. `failing` does not stop pause attempts (`adapterForConnection`
 * refuses only `disconnected`), so a token that comes back is used again at once.
 */
export async function markConnectionFailing(admin: SupabaseClient, orgId: string, connectionId: string, lastError: string, at: Date): Promise<boolean> {
  const { data, error } = await admin
    .from("ads_platform_connections")
    .update({ status: "failing", last_error: lastError.slice(0, 1000), updated_at: at.toISOString() })
    .eq("org_id", orgId).eq("id", connectionId).eq("status", "connected")
    .select("id");
  if (error) throw new Error(`ads_platform_connections: ${error.message}`);
  return (data ?? []).length > 0;
}

// ── the writes ──────────────────────────────────────────────────────────────────────────────────

function testColumns(report: ConnectionReport, at: Date): Record<string, unknown> {
  const failed = report.checks.find((c) => c.ok === false);
  return {
    status: report.ok ? "connected" : "failing",
    scopes: report.scopes_granted,
    last_test_at: at.toISOString(),
    last_test: report,
    last_error: failed ? `${failed.key}: ${failed.detail}`.slice(0, 1000) : null,
    updated_at: at.toISOString(),
  };
}

async function saveRow(deps: ConnectionDeps, orgId: string, provider: "meta" | "simulator", sandbox: boolean, values: Record<string, unknown>): Promise<AdsConnectionView> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: found, error: fErr } = await deps.admin
      .from("ads_platform_connections").select("id").eq("org_id", orgId).eq("provider", provider).eq("is_sandbox", sandbox).maybeSingle();
    if (fErr) throw new Error(`ads_platform_connections: ${fErr.message}`);
    const existing = found as { id: string } | null;
    if (existing) return updateRow(deps.admin, orgId, existing.id, values);
    const { data, error } = await deps.admin
      .from("ads_platform_connections")
      .insert({ org_id: orgId, provider, is_sandbox: sandbox, ...values })
      .select(ADS_CONNECTION_VIEW_COLUMNS)
      .single();
    if (!error) return data as unknown as AdsConnectionView;
    if ((error as { code?: string }).code !== "23505") throw new Error(`ads_platform_connections: ${error.message}`);
    // Another admin's insert won the slot; the next pass updates it.
  }
  throw new Error("ads_platform_connections: the connection slot is contended; try again");
}

async function updateRow(admin: SupabaseClient, orgId: string, id: string, values: Record<string, unknown>): Promise<AdsConnectionView> {
  const { data, error } = await admin.from("ads_platform_connections").update(values).eq("org_id", orgId).eq("id", id).select(ADS_CONNECTION_VIEW_COLUMNS).single();
  if (error) throw new Error(`ads_platform_connections: ${error.message}`);
  return data as unknown as AdsConnectionView;
}

async function recordTest(deps: ConnectionDeps, orgId: string, connectionId: string, actor: ConnectionActor, target: ConnectionTarget, report: ConnectionReport): Promise<void> {
  await recordFinished(deps.admin, {
    org_id: orgId, campaign_id: null, connection_id: connectionId, kind: "connection_test",
    actor_kind: "person", actor_id: actor.id, actor_name: actor.name,
    request: { account: target.accountId, page: target.pageId },
  }, { status: report.ok ? "succeeded" : "failed", error_code: report.error_code, response: report, at: deps.now().toISOString() });
}

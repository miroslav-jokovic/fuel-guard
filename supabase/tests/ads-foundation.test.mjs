// ADS-AGENT-BUILD-WORKFLOW A2, migration 0537: the ads module's store. Proves, against the real
// migration chain, that the five ledgers refuse edits and deletes for every role (AX010/AX011/AX012),
// that a launch needs a standing approval and a clear kill switch in the database itself
// (AX020/AX021), that a creative's content freezes when it leaves the workers (AX030), that a
// campaign's brief is fixed (AX031), that no row can cite another carrier's (composite FKs), that a
// plaintext token cannot be stored, and that every table is deny-all from a browser.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
const sqlstate = async (q, p = []) => {
  try { await db.query(q, p); return null; } catch (e) { return e.code ?? String(e.message); }
};

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], owner uuid,
    created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text,
    name text, owner uuid, owner_id text, created_at timestamptz default now());
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable
  as $fn$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]; $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin; create role authenticated nologin;
  create role anon nologin; create role service_role nologin bypassrls;
`);
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

const TABLES = [
  "ads_settings_versions", "ad_brand_kits", "ad_brand_kit_versions", "ad_concept_presets",
  "ad_concept_preset_versions", "ads_platform_connections", "ads_campaigns", "ads_creatives",
  "ads_approvals", "ads_actions", "ad_generations", "ads_outcome_events", "ads_spend_hourly",
];
const PERSON = "00000000-0000-4000-8000-000000000001";
const ENVELOPE = "v1.0a1b2c3d.aXZpdmFsdWU.dGFndmFsdWU.Y2lwaGVydGV4dA";

const org = async (name) => (await one(`insert into organizations (id, name) values (gen_random_uuid(), $1) returning id`, [name])).id;
const ORG = await org("Carrier");
const OTHER = await org("Other carrier");

const settings = async (o, version, kill = false) => (await one(
  `insert into ads_settings_versions (org_id, version, settings, kill_switch, kill_reason, created_by, created_by_name)
   values ($1, $2, '{"monthly_cap_cents": 100000}', $3, case when $3 then 'test stop' end, $4, 'Owner') returning id`,
  [o, version, kill, PERSON])).id;
const connection = async (o, provider = "simulator") => (await one(
  `insert into ads_platform_connections (org_id, provider, status) values ($1, $2, 'connected') returning id`, [o, provider])).id;
const preset = async (o, key) => {
  const p = (await one(`insert into ad_concept_presets (org_id, key) values ($1, $2) returning id`, [o, key])).id;
  return (await one(
    `insert into ad_concept_preset_versions (org_id, preset_id, version, enabled, recipe, created_by, created_by_name)
     values ($1, $2, 1, true, '{"hook": "the number"}', $3, 'Owner') returning id`, [o, p, PERSON])).id;
};
const campaign = async (o, conn, sv) => (await one(
  `insert into ads_campaigns (org_id, connection_id, brief_source, brief_ref, brief_snapshot, name, settings_version_id)
   values ($1, $2, 'recruiting_opening', 'op-1@v1', '{"pay": "0.68/mi"}', 'S360_test', $3) returning id`, [o, conn, sv])).id;

const SV1 = await settings(ORG, 1);
const SV_OTHER = await settings(OTHER, 1);
const CONN = await connection(ORG);
const CONN_OTHER = await connection(OTHER);
const PV = await preset(ORG, "P2");
const PV_OTHER = await preset(OTHER, "P2");
const CAMP = await campaign(ORG, CONN, SV1);
const CAMP_OTHER = await campaign(OTHER, CONN_OTHER, SV_OTHER);

// ── deny-all from a browser ───────────────────────────────────────────────────────────────────
for (const t of TABLES) {
  const rls = (await one(`select relrowsecurity r from pg_class where relname = $1 and relnamespace = 'public'::regnamespace`, [t]))?.r;
  const policies = Number((await one(`select count(*)::int n from pg_policies where tablename = $1`, [t])).n);
  ok(`${t}: RLS on with no client policy`, rls === true && policies === 0, JSON.stringify({ rls, policies }));
}

// ── connections: no plaintext token, ever ─────────────────────────────────────────────────────
ok("a plaintext Meta token is refused by the envelope CHECK (23514)",
  (await sqlstate(`insert into ads_platform_connections (org_id, provider, token_sealed, status) values ($1, 'meta', 'EAABsbCS1iHgBAKZC0ZD', 'connected')`, [ORG])) === "23514");
ok("a secretBox envelope is stored",
  (await sqlstate(`insert into ads_platform_connections (org_id, provider, is_sandbox, token_sealed, page_token_sealed, status) values ($1, 'meta', true, $2, $2, 'connected')`, [ORG, ENVELOPE])) === null);
ok("a connected non-simulator row without a token is refused (23514)",
  (await sqlstate(`insert into ads_platform_connections (org_id, provider, status) values ($1, 'tiktok', 'connected')`, [ORG])) === "23514");
ok("a Page token on a non-Meta connection is refused (23514)",
  (await sqlstate(`insert into ads_platform_connections (org_id, provider, token_sealed, page_token_sealed, status) values ($1, 'x', $2, $2, 'connected')`, [ORG, ENVELOPE])) === "23514");
ok("a second simulator connection for the org is refused (23505)",
  (await sqlstate(`insert into ads_platform_connections (org_id, provider) values ($1, 'simulator')`, [ORG])) === "23505");
ok("a connection's org never changes",
  (await sqlstate(`update ads_platform_connections set org_id = $1 where id = $2`, [OTHER, CONN])) !== null);

// ── settings and versions are immutable ───────────────────────────────────────────────────────
ok("a settings version is never edited (AX012)",
  (await sqlstate(`update ads_settings_versions set settings = '{}' where id = $1`, [SV1])) === "AX012");
ok("a settings version is never deleted (AX012)",
  (await sqlstate(`delete from ads_settings_versions where id = $1`, [SV1])) === "AX012");
ok("the kill switch without a reason is refused (23514)",
  (await sqlstate(`insert into ads_settings_versions (org_id, version, settings, kill_switch, created_by, created_by_name) values ($1, 9, '{}', true, $2, 'Owner')`, [ORG, PERSON])) === "23514");
ok("a preset version is never edited (AX012)",
  (await sqlstate(`update ad_concept_preset_versions set enabled = false where id = $1`, [PV])) === "AX012");
const KIT = (await one(`insert into ad_brand_kits (org_id, name) values ($1, 'Main') returning id`, [ORG])).id;
const KV = (await one(`insert into ad_brand_kit_versions (org_id, kit_id, version, kit, created_by, created_by_name) values ($1, $2, 1, '{"colors": ["#0B3D2E"]}', $3, 'Owner') returning id`, [ORG, KIT, PERSON])).id;
ok("a brand-kit version is never deleted (AX012)",
  (await sqlstate(`delete from ad_brand_kit_versions where id = $1`, [KV])) === "AX012");
ok("a brand-kit version of another carrier's kit is refused (23503)",
  (await sqlstate(`insert into ad_brand_kit_versions (org_id, kit_id, version, kit, created_by, created_by_name) values ($1, $2, 2, '{}', $3, 'Owner')`, [OTHER, KIT, PERSON])) === "23503");

// ── campaigns: the brief is fixed; no cross-carrier reference ─────────────────────────────────
ok("a campaign on another carrier's connection is refused (23503)",
  (await sqlstate(`insert into ads_campaigns (org_id, connection_id, brief_source, brief_ref, brief_snapshot, name, settings_version_id) values ($1, $2, 'recruiting_opening', 'x', '{}', 'n', $3)`, [ORG, CONN_OTHER, SV1])) === "23503");
ok("a campaign under another carrier's settings is refused (23503)",
  (await sqlstate(`insert into ads_campaigns (org_id, connection_id, brief_source, brief_ref, brief_snapshot, name, settings_version_id) values ($1, $2, 'recruiting_opening', 'x', '{}', 'n', $3)`, [ORG, CONN, SV_OTHER])) === "23503");
ok("a campaign's brief snapshot never changes (AX031)",
  (await sqlstate(`update ads_campaigns set brief_snapshot = '{"pay": "0.99/mi"}' where id = $1`, [CAMP])) === "AX031");
ok("a campaign's state moves (transitions are the machine's, not the database's)",
  (await sqlstate(`update ads_campaigns set state = 'composing' where id = $1`, [CAMP])) === null);
ok("an unknown campaign state is refused (23514)",
  (await sqlstate(`update ads_campaigns set state = 'running' where id = $1`, [CAMP])) === "23514");

// ── creatives: content freezes when it leaves the workers ─────────────────────────────────────
const CR = (await one(`insert into ads_creatives (org_id, campaign_id, preset_version_id, brand_kit_version_id) values ($1, $2, $3, $4) returning id`, [ORG, CAMP, PV, KV])).id;
ok("a creative under another carrier's preset is refused (23503)",
  (await sqlstate(`insert into ads_creatives (org_id, campaign_id, preset_version_id) values ($1, $2, $3)`, [ORG, CAMP, PV_OTHER])) === "23503");
ok("the workers fill a creative while it is generating",
  (await sqlstate(`update ads_creatives set copy = '{"en": {"headline": "Home every weekend"}}', state = 'checking' where id = $1`, [CR])) === null);
ok("a creative cannot be ready without its checks and assets (23514)",
  (await sqlstate(`update ads_creatives set state = 'ready' where id = $1`, [CR])) === "23514");
ok("a checked creative with its assets becomes ready",
  (await sqlstate(`update ads_creatives set assets = '[{"format": "1:1", "sha256": "ab"}]', checks = '{"copy": "pass", "visual": "pass", "render": "pass"}', state = 'ready' where id = $1`, [CR])) === null);
ok("a ready creative's copy is frozen (AX030)",
  (await sqlstate(`update ads_creatives set copy = '{"en": {"headline": "changed"}}' where id = $1`, [CR])) === "AX030");
ok("a ready creative is never reopened to checking (AX030)",
  (await sqlstate(`update ads_creatives set state = 'checking' where id = $1`, [CR])) === "AX030");
ok("a ready creative's state still moves to approved",
  (await sqlstate(`update ads_creatives set state = 'approved' where id = $1`, [CR])) === null);

// ── approvals are append-only ─────────────────────────────────────────────────────────────────
const approve = async (kind, extra = {}) => (await one(
  `insert into ads_approvals (org_id, campaign_id, creative_id, kind, daily_budget_cents, withdraws_id, settings_version_id, approved_by, approved_by_name)
   values ($1, $2, $3, $4, $5, $6, $7, $8, 'Owner') returning id`,
  [ORG, CAMP, extra.creative ?? null, kind, extra.daily ?? null, extra.withdraws ?? null, SV1, PERSON])).id;
const AP_CREATIVE = await approve("approve_creative", { creative: CR });
ok("a launch approval without a daily budget is refused (23514)",
  (await sqlstate(`insert into ads_approvals (org_id, campaign_id, kind, settings_version_id, approved_by, approved_by_name) values ($1, $2, 'launch', $3, $4, 'Owner')`, [ORG, CAMP, SV1, PERSON])) === "23514");
ok("an approval is never edited (AX010)",
  (await sqlstate(`update ads_approvals set reason = 'later' where id = $1`, [AP_CREATIVE])) === "AX010");
ok("an approval is never deleted (AX010)",
  (await sqlstate(`delete from ads_approvals where id = $1`, [AP_CREATIVE])) === "AX010");

// ── actions: the database's own spend fence ───────────────────────────────────────────────────
const act = (kind, approval, extra = {}) => sqlstate(
  `insert into ads_actions (org_id, campaign_id, kind, actor_kind, actor_id, actor_name, approval_id, status, finished_at, idempotency_key)
   values ($1, $2, $3, 'person', $4, 'Owner', $5, $6, case when $6 = 'started' then null else now() end, $7)`,
  [ORG, extra.campaign ?? CAMP, kind, PERSON, approval, extra.status ?? "started", extra.key ?? null]);
ok("a launch with no approval is refused (AX020)", (await act("launch", null)) === "AX020");
ok("a launch citing a creative approval is refused (AX020)", (await act("launch", AP_CREATIVE)) === "AX020");
ok("the guard can record its own refusal of an unapproved launch", (await act("launch", null, { status: "refused" })) === null);
const AP_LAUNCH = await approve("launch", { daily: 5000 });
ok("a launch citing this campaign's launch approval is written", (await act("launch", AP_LAUNCH, { key: "launch-1" })) === null);
ok("the same idempotency key twice is refused (23505)", (await act("launch", AP_LAUNCH, { key: "launch-1" })) === "23505");
ok("a launch of another carrier's campaign is refused — its approval is not that campaign's (AX020)",
  (await act("launch", AP_LAUNCH, { campaign: CAMP_OTHER })) === "AX020");
ok("a pause recorded against another carrier's campaign is refused (23503)",
  (await act("pause", null, { campaign: CAMP_OTHER })) === "23503");
await approve("withdraw", { withdraws: AP_LAUNCH });
ok("a launch citing a withdrawn approval is refused (AX020)", (await act("launch", AP_LAUNCH)) === "AX020");
const AP_LAUNCH2 = await approve("launch", { daily: 5000 });
await settings(ORG, 2, true);
ok("a launch while the kill switch is on is refused (AX021)", (await act("launch", AP_LAUNCH2)) === "AX021");
ok("a pause while the kill switch is on is written — the safe direction is never blocked",
  (await act("pause", null)) === null);
await settings(ORG, 3, false);
ok("with the kill switch off again the approved launch is written", (await act("launch", AP_LAUNCH2, { key: "launch-2" })) === null);

const ACT = (await one(`select id from ads_actions where idempotency_key = 'launch-2'`)).id;
ok("a started action completes with its outcome",
  (await sqlstate(`update ads_actions set status = 'succeeded', response = '{"id": "1"}', finished_at = now() where id = $1`, [ACT])) === null);
ok("a completed action never completes again (AX011)",
  (await sqlstate(`update ads_actions set status = 'failed' where id = $1`, [ACT])) === "AX011");
const PAUSE = (await one(`select id from ads_actions where kind = 'pause' limit 1`)).id;
ok("completing an action may not rewrite what was sent (AX011)",
  (await sqlstate(`update ads_actions set status = 'succeeded', finished_at = now(), request = '{"forged": true}' where id = $1`, [PAUSE])) === "AX011");
ok("an action is never deleted (AX010)", (await sqlstate(`delete from ads_actions where id = $1`, [ACT])) === "AX010");

// ── generations: one completion, idempotent, never deleted ────────────────────────────────────
const gen = (key, status = "started") => sqlstate(
  `insert into ad_generations (org_id, campaign_id, creative_id, agent, provider, model, idempotency_key, status, finished_at)
   values ($1, $2, $3, 'copywriter', 'anthropic', 'claude-sonnet-4-6', $4, $5, case when $5 = 'started' then null else now() end)`,
  [ORG, CAMP, CR, key, status]);
ok("a generation is recorded before the call", (await gen("gen-1")) === null);
ok("a replayed generation key is refused, so it spends nothing (23505)", (await gen("gen-1")) === "23505");
ok("an exhausted budget is recorded instead of a call", (await gen("gen-2", "budget_exhausted")) === null);
const GEN = (await one(`select id from ad_generations where idempotency_key = 'gen-1'`)).id;
ok("a generation completes with its output and cost",
  (await sqlstate(`update ad_generations set status = 'succeeded', output = '{"ok": 1}', cost_units = 1200, cost_unit = 'tokens', finished_at = now() where id = $1`, [GEN])) === null);
ok("a completed generation never changes (AX011)",
  (await sqlstate(`update ad_generations set cost_units = 1 where id = $1`, [GEN])) === "AX011");
ok("a generation is never deleted (AX010)", (await sqlstate(`delete from ad_generations where id = $1`, [GEN])) === "AX010");

// ── outcome events: a send result, never a double send ────────────────────────────────────────
const outcome = (ref) => sqlstate(
  `insert into ads_outcome_events (org_id, campaign_id, provider, platform_lead_ref, stage, source_event_ref)
   values ($1, $2, 'meta', 'leadgen-1', 'contacted', $3)`, [ORG, CAMP, ref]);
ok("a stage event is queued", (await outcome("stage-1")) === null);
ok("the same stage event twice is refused (23505)", (await outcome("stage-1")) === "23505");
const OE = (await one(`select id from ads_outcome_events where source_event_ref = 'stage-1'`)).id;
ok("a failed send is recorded",
  (await sqlstate(`update ads_outcome_events set status = 'failed', attempts = 1 where id = $1`, [OE])) === null);
ok("a failed send may be retried and sent",
  (await sqlstate(`update ads_outcome_events set status = 'sent', attempts = 2, sent_at = now() where id = $1`, [OE])) === null);
ok("a sent event is final (AX011)",
  (await sqlstate(`update ads_outcome_events set status = 'failed' where id = $1`, [OE])) === "AX011");
ok("an outcome event is never deleted (AX010)",
  (await sqlstate(`delete from ads_outcome_events where id = $1`, [OE])) === "AX010");

// ── spend by hour ─────────────────────────────────────────────────────────────────────────────
ok("an hour's spend is recorded",
  (await sqlstate(`insert into ads_spend_hourly (org_id, campaign_id, hour, spend_cents, currency) values ($1, $2, '2026-11-02T14:00:00Z', 1250, 'USD')`, [ORG, CAMP])) === null);
ok("a row not on the hour is refused (23514)",
  (await sqlstate(`insert into ads_spend_hourly (org_id, campaign_id, hour, spend_cents, currency) values ($1, $2, '2026-11-02T14:30:00Z', 1, 'USD')`, [ORG, CAMP])) === "23514");
ok("spend against another carrier's campaign is refused (23503)",
  (await sqlstate(`insert into ads_spend_hourly (org_id, campaign_id, hour, spend_cents, currency) values ($1, $2, '2026-11-02T15:00:00Z', 1, 'USD')`, [ORG, CAMP_OTHER])) === "23503");

// ── the bell's categories ─────────────────────────────────────────────────────────────────────
const check = (await one(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'notification_events_category_check'`)).d;
ok("the category CHECK carries the eight new categories and keeps 0521's",
  ["ads_overspend", "ads_rejected", "ads_no_leads", "ads_external_change", "ads_token_expiring", "ads_brief", "lead_new", "lead_uncontacted", "chat_reply", "load_offered"]
    .every((c) => check.includes(`'${c}'`)), check);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;

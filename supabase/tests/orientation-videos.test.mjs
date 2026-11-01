// HW8a (HIRING-WORKFLOW-AUDIT-2026-10-31 §4.8, §8.2), migration 0539: the carrier's orientation videos
// (links, retired never deleted, the link never edited) and the applicant's "I watched these" and opened
// links — append-only, checked against the carrier's live list, moved by a roster merge, removed by the
// purge (that half is `purge-applicant.test.mjs`).
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

const ORG = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Carrier') returning id`)).id;
const OTHER = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Other') returning id`)).id;
const driver = async (org, name) => (await one(`insert into drivers (org_id, full_name) values ($1, $2) returning id`, [org, name])).id;
const invite = async (org, d) => (await one(
  `insert into application_invitations (org_id, driver_id, token_hash, expires_at)
   values ($1, $2, md5(random()::text), now() + interval '10 days') returning id`, [org, d])).id;
const A = await driver(ORG, "Applicant A");
const A2 = await driver(ORG, "Applicant A (duplicate)");
const B = await driver(ORG, "Applicant B");
const X = await driver(OTHER, "Someone else's applicant");
const INV = await invite(ORG, A);
const INV_B = await invite(ORG, B);
const INV_X = await invite(OTHER, X);

const video = async (org, title, extra = {}) => (await one(
  `insert into orientation_videos (org_id, title, url, minutes, required, position)
   values ($1, $2, $3, $4, $5, $6) returning id`,
  [org, title, extra.url ?? `https://videos.example.com/${encodeURIComponent(title)}`, extra.minutes ?? 10,
   extra.required ?? true, extra.position ?? 0])).id;

// ── the carrier's list ────────────────────────────────────────────────────────────────────────
const PRETRIP = await video(ORG, "Pre-trip inspection", { position: 1 });
const ELD = await video(ORG, "Using the ELD", { required: false, position: 2 });
const RETIRED = await video(ORG, "Old safety video", { position: 3 });
const THEIRS = await video(OTHER, "Another carrier's video");
ok("a video defaults to required", (await one(`select required from orientation_videos where id = $1`, [PRETRIP])).required === true);
ok("an http link is refused — https only (23514)",
  (await sqlstate(`insert into orientation_videos (org_id, title, url) values ($1, 'x', 'http://example.com/v')`, [ORG])) === "23514");
ok("a blank title is refused (23514)",
  (await sqlstate(`insert into orientation_videos (org_id, title, url) values ($1, '  ', 'https://example.com/v')`, [ORG])) === "23514");
ok("the title, minutes, required and position are the office's to edit",
  (await sqlstate(`update orientation_videos set title = 'Pre-trip, step by step', minutes = 12, required = true, position = 0 where id = $1`, [PRETRIP])) === null);
ok("the link never changes — a different link is a different video (OV011)",
  (await sqlstate(`update orientation_videos set url = 'https://example.com/other' where id = $1`, [PRETRIP])) === "OV011");
ok("a video is never deleted (OV010)", (await sqlstate(`delete from orientation_videos where id = $1`, [ELD])) === "OV010");
ok("a video is retired", (await sqlstate(`update orientation_videos set retired_at = now() where id = $1`, [RETIRED])) === null);
ok("retiring is one-way (OV012)",
  (await sqlstate(`update orientation_videos set retired_at = null where id = $1`, [RETIRED])) === "OV012");

// ── the applicant's "I watched these" ─────────────────────────────────────────────────────────
const attest = (org, d, inv, ids, name = "Pat Driver") => sqlstate(
  `insert into orientation_video_attestations (org_id, driver_id, invitation_id, video_ids, signer_name, ip, user_agent)
   values ($1, $2, $3, $4, $5, '203.0.113.9', 'phone')`, [org, d, inv, ids, name]);
ok("the applicant attests this carrier's live videos", (await attest(ORG, A, INV, [PRETRIP, ELD])) === null);
const ROW = await one(`select * from orientation_video_attestations where driver_id = $1`, [A]);
ok("the trigger snapshots each video from the list, not from the caller",
  Array.isArray(ROW.videos) && ROW.videos.length === 2
  && ROW.videos[0].title === "Pre-trip, step by step" && ROW.videos[0].url.startsWith("https://")
  && ROW.videos.every((v) => typeof v.required === "boolean"), JSON.stringify(ROW.videos));
ok("a retired video cannot be attested (OV024)", (await attest(ORG, A, INV, [RETIRED])) === "OV024");
ok("another carrier's video cannot be attested (OV024)", (await attest(ORG, A, INV, [THEIRS])) === "OV024");
ok("a video named twice is refused (OV024)", (await attest(ORG, A, INV, [PRETRIP, PRETRIP])) === "OV024");
ok("an empty list is refused (OV024)", (await attest(ORG, A, INV, [])) === "OV024");
ok("a blank name is refused (23514)", (await attest(ORG, A, INV, [PRETRIP], "  ")) === "23514");
ok("another applicant's invitation is refused (OV023)", (await attest(ORG, A, INV_B, [PRETRIP])) === "OV023");
ok("another carrier's driver is refused (OV022)", (await attest(ORG, X, INV_X, [PRETRIP])) === "OV022");

ok("the names are never edited (OV021)",
  (await sqlstate(`update orientation_video_attestations set signer_name = 'Someone' where id = $1`, [ROW.id])) === "OV021");
ok("the videos are never edited (OV021)",
  (await sqlstate(`update orientation_video_attestations set video_ids = $2 where id = $1`, [ROW.id, [PRETRIP]])) === "OV021");
ok("the time is never edited (OV021)",
  (await sqlstate(`update orientation_video_attestations set attested_at = now() - interval '1 day' where id = $1`, [ROW.id])) === "OV021");
ok("an attestation is never deleted (OV020)",
  (await sqlstate(`delete from orientation_video_attestations where id = $1`, [ROW.id])) === "OV020");

// ── a link opened from the list ───────────────────────────────────────────────────────────────
const open = (org, d, inv, v) => sqlstate(
  `insert into orientation_video_opens (org_id, driver_id, invitation_id, video_id) values ($1, $2, $3, $4)`, [org, d, inv, v]);
ok("an open of a live video is recorded", (await open(ORG, A, INV, PRETRIP)) === null);
ok("an open of a retired video is refused (OV024)", (await open(ORG, A, INV, RETIRED)) === "OV024");
ok("an open of another carrier's video is refused (OV024)", (await open(ORG, A, INV, THEIRS)) === "OV024");
ok("an open on another applicant's invitation is refused (OV023)", (await open(ORG, A, INV_B, PRETRIP)) === "OV023");
const OPEN = await one(`select id from orientation_video_opens where driver_id = $1`, [A]);
ok("an open is never edited (OV031)",
  (await sqlstate(`update orientation_video_opens set opened_at = now() - interval '1 day' where id = $1`, [OPEN.id])) === "OV031");
ok("an open is never deleted (OV030)", (await sqlstate(`delete from orientation_video_opens where id = $1`, [OPEN.id])) === "OV030");
ok("a video with an open on it still cannot be deleted (OV010)",
  (await sqlstate(`delete from orientation_videos where id = $1`, [PRETRIP])) === "OV010");

// ── the roster merge moves both, inside the carrier ───────────────────────────────────────────
for (const t of ["orientation_video_attestations", "orientation_video_opens"]) {
  ok(`the merge's move of ${t} to the canonical driver in this carrier is allowed`,
    (await sqlstate(`update ${t} set driver_id = $1 where driver_id = $2`, [A2, A])) === null);
  ok(`a move of ${t} to another carrier's driver is refused (OV022)`,
    (await sqlstate(`update ${t} set driver_id = $1 where driver_id = $2`, [X, A2])) === "OV022");
}
ok("a driver with an attestation cannot be deleted out from under it (restrict)",
  (await sqlstate(`delete from drivers where id = $1`, [A2])) !== null);

// ── the send, the switch, the text ────────────────────────────────────────────────────────────
ok("an invitation starts with no videos sent",
  (await one(`select orientation_videos_sent_at s from application_invitations where id = $1`, [INV_B])).s === null);
ok("the send is stamped on the invitation",
  (await sqlstate(`update application_invitations set orientation_videos_sent_at = now() where id = $1`, [INV_B])) === null);
await db.query(
  `insert into recruiting_settings (org_id, invite_ttl_days, reminders_enabled, reminder_after_hours) values ($1, 7, true, 48)`, [ORG]);
ok("videos_block_hire defaults to off (Q-WF6)",
  (await one(`select videos_block_hire v from recruiting_settings where org_id = $1`, [ORG])).v === false);
ok("the videos text's reason is admitted by sms_outbox",
  (await sqlstate(
    `insert into sms_outbox (org_id, driver_id, invitation_id, phone, template, params, reason, not_before, expires_at)
     values ($1, $2, $3, '+13125550100', 'orientation_videos', '{}', 'orientation_videos', now(), now() + interval '1 day')`,
    [ORG, B, INV_B])) === null);
ok("an unknown reason is still refused (23514)",
  (await sqlstate(
    `insert into sms_outbox (org_id, driver_id, invitation_id, phone, template, params, reason, not_before, expires_at)
     values ($1, $2, $3, '+13125550100', 'x', '{}', 'nonsense', now(), now() + interval '1 day')`,
    [ORG, B, INV_B])) === "23514");

// ── the API's only door ───────────────────────────────────────────────────────────────────────
for (const t of ["orientation_videos", "orientation_video_attestations", "orientation_video_opens"]) {
  const policies = Number((await one(`select count(*)::int n from pg_policies where tablename = $1`, [t])).n);
  const rls = (await one(`select relrowsecurity r from pg_class where relname = $1`, [t])).r;
  ok(`${t}: RLS is on with no client policy — deny-all from a browser`, policies === 0 && rls === true);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;

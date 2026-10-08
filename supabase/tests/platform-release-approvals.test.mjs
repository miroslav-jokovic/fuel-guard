// Silvicom 360 — the owner's console approval of a release (migration 0440, platform_release_approvals;
// RELEASE-TRAIN-PLAN D-REL14).
//
// release.yml decides at 01:07 whether production moves, and part of that decision is the query below —
// imported from scripts/release-train.mjs, so the text run here is the text the release runs. It must
// return the newest LIVE approval for the PR, and only while its approver is still an active
// platform_owner: a withdrawn yes, a suspended owner's yes, or a read-only admin's yes ships nothing.
//
// Run: node supabase/tests/platform-release-approvals.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { consoleApprovalSql } from "../../scripts/release-train.mjs";

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
for (const f of MIGRATIONS) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const admin = async (email, role) => (await one(`insert into platform_admins (email, role) values ($1, $2) returning id`, [email, role])).id;
const OWNER = await admin("owner@example.com", "platform_owner");
const OTHER = await admin("second@example.com", "platform_owner");
const READER = await admin("reader@example.com", "platform_readonly");
const SHA = (c) => c.repeat(40);
const approve = (pr, sha, by, at) =>
  sqlstate(`insert into platform_release_approvals (pr_number, commit_sha, approved_by, approved_at) values ($1,$2,$3,$4)`, [pr, sha, by, at]);
const signal = async (pr) => (await db.query(consoleApprovalSql(pr))).rows[0] ?? null;

ok("no approval, no signal", (await signal(1351)) === null);

ok("a full lower-case commit is admitted", (await approve(1351, SHA("a"), OWNER, "2026-10-08T20:00:00Z")) === null);
for (const [bad, why] of [
  ["a".repeat(7), "a short SHA could name two commits later"],
  ["A".repeat(40), "upper case would compare unequal to git's output"],
  ["g".repeat(40), "not hex"],
]) ok(`refused: commit '${bad.slice(0, 9)}…' (${why})`, (await approve(1351, bad, OWNER, "2026-10-08T20:00:00Z")) === "23514");
ok("refused: PR number 0", (await approve(0, SHA("a"), OWNER, "2026-10-08T20:00:00Z")) === "23514");

let s = await signal(1351);
ok("the owner's approval is the signal, with its commit and approver", s?.commit_sha === SHA("a") && s?.email === "owner@example.com");

await approve(1351, SHA("b"), OTHER, "2026-10-08T22:00:00Z");
ok("the newest live approval wins", (await signal(1351))?.commit_sha === SHA("b"));
ok("another PR's approval is not this PR's", (await signal(1400)) === null);

await db.query(`update platform_release_approvals set revoked_at = now(), revoked_by = $1 where commit_sha = $2`, [OTHER, SHA("b")]);
ok("a withdrawn approval stops counting; the older live one stands", (await signal(1351))?.commit_sha === SHA("a"));
ok("the withdrawn row is kept, not deleted",
  (await one(`select count(*)::int n from platform_release_approvals where pr_number = 1351`)).n === 2);

await db.query(`update platform_admins set status = 'suspended' where id = $1`, [OWNER]);
ok("a suspended owner's approval ships nothing", (await signal(1351)) === null);
await db.query(`update platform_admins set status = 'active', role = 'platform_admin' where id = $1`, [OWNER]);
ok("…nor a demoted owner's", (await signal(1351)) === null);

await approve(1352, SHA("c"), READER, "2026-10-08T23:00:00Z");
ok("a read-only platform role's approval ships nothing (admin-api refuses it too)", (await signal(1352)) === null);

ok("a live row cannot name a withdrawer",
  (await sqlstate(`update platform_release_approvals set revoked_by = $1 where pr_number = 1352`, [OTHER])) === "23514");
ok("row level security is on (no client policy reaches it)",
  (await one(`select relrowsecurity r from pg_class where relname = 'platform_release_approvals'`)).r === true);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

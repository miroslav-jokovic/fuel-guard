// Silvicom 360 — production gets `revoke_push_tokens` back (migration 0414, database audit 2026-10-03,
// finding 5 / Q-REL6).
//
// What can be wrong is that the fix is tested on a database production is not:
//
//   · THE REPLAY ALREADY HAS THE FUNCTION. 0089 creates it, so on a clean replay `create or replace` in 0414
//     is a no-op and every assertion would pass with the migration deleted. Production lacks it. This matrix
//     therefore BUILDS PRODUCTION'S STARTING STATE — every migration before 0414, then the function dropped
//     and the platform's old open default grants put back — and applies 0414 on top.
//   · THE EXPLICIT REVOKE IS TESTED, NOT ASSUMED. 0412 already closes new functions by default, which would
//     make 0414's own `revoke … from public, anon, authenticated` look redundant. The defaults are reopened
//     first, so the statement has to do its work, which is what "survives a changed default" in
//     supabase/CLAUDE.md claims.
//   · RESTORED MEANS THE SAME BODY. The body is compared with 0089's text, so a "restoration" that quietly
//     redesigns the function fails here.
//   · IT REVOKES, AND ONLY WHAT IT SHOULD. Another user's tokens and an already-revoked token's timestamp
//     are asserted unchanged; a second call returns 0.
//
// Run:  node supabase/tests/push-token-revocation.test.mjs
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
const all = async (q, p = []) => (await db.query(q, p)).rows;
const throws = async (q, p = []) => {
  try { await db.query(q, p); return null; } catch (e) { return e.message; }
};

// The platform's default privileges, as `select * from pg_default_acl` shows them on production —
// functions included, which is the half the other matrices leave out.
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
  create schema if not exists extensions; create schema if not exists partman;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);


const M0414 = MIGRATIONS.find((f) => f.startsWith("0414_"));
ok("migration 0414 exists", M0414 != null, String(M0414));

// Production's starting state: everything before 0414 …
for (const f of MIGRATIONS.filter((x) => x < "0414")) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}
// … minus the function it lacks, with the platform's old default grants back (pre-0412).
await db.exec(`
  drop function public.revoke_push_tokens(uuid);
  alter default privileges for role postgres grant execute on functions to public;
  alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated;`);
const absent = await one(`select count(*)::int n from pg_proc where proname = 'revoke_push_tokens'`);
const dedupeBefore = await one(`select count(*)::int n from pg_proc where proname = 'notify_dedupe_key'`);
ok("the starting state models production: revoke_push_tokens absent", absent.n === 0, JSON.stringify(absent));
ok("the starting state models staging: notify_dedupe_key present", dedupeBefore.n === 1, JSON.stringify(dedupeBefore));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Carrier A') returning id`)).id;
const U1 = (await one(`insert into auth.users (email) values ('one@carrier.test') returning id`)).id;
const U2 = (await one(`insert into auth.users (email) values ('two@carrier.test') returning id`)).id;
await db.exec("begin; set local role service_role");
const missing = await throws(`select public.revoke_push_tokens($1)`, [U1]);
await db.exec("rollback");
ok("before 0414 the RPC fails as 'does not exist' (what production returns today)",
  /does not exist|function .* not/i.test(missing ?? ""), String(missing));

await db.exec(read(join("migrations", M0414)));

// ── The function, as 0089 wrote it ──────────────────────────────────────────────────────────────
const fn = await all(
  `select pg_get_function_result(p.oid) ret, p.prosecdef definer, p.proconfig cfg, p.prosrc src
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'revoke_push_tokens'`);
ok("exactly one revoke_push_tokens exists after 0414", fn.length === 1, String(fn.length));
ok("it returns integer, is SECURITY DEFINER and pins an empty search_path",
  fn[0]?.ret === "integer" && fn[0]?.definer === true && /search_path=""/.test(String(fn[0]?.cfg)), JSON.stringify(fn[0]));
const original = read(join("migrations", "0089_notifications.sql"))
  .match(/create or replace function revoke_push_tokens\(p_user uuid\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/)?.[1];
const norm = (t) => String(t).replace(/\s+/g, " ").trim();
ok("its body is 0089's, unchanged", original != null && norm(original) === norm(fn[0]?.src),
  `${norm(original).slice(0, 80)} ≠ ${norm(fn[0]?.src).slice(0, 80)}`);

if (fn.length === 1) {
  // ── Who may call it ─────────────────────────────────────────────────────────────────────────────
  const acl = await one(
    `select has_function_privilege('anon', 'public.revoke_push_tokens(uuid)', 'execute') anon,
            has_function_privilege('authenticated', 'public.revoke_push_tokens(uuid)', 'execute') auth,
            has_function_privilege('service_role', 'public.revoke_push_tokens(uuid)', 'execute') svc,
            exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     where p.proname = 'revoke_push_tokens' and a.grantee = 0) pub`);
  ok("anon, authenticated and PUBLIC cannot execute it even with the old open defaults",
    acl.anon === false && acl.auth === false && acl.pub === false, JSON.stringify(acl));
  ok("service_role can execute it", acl.svc === true, JSON.stringify(acl));
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`begin; set local role ${role}`);
    const e = await throws(`select public.revoke_push_tokens($1)`, [U1]);
    await db.exec("rollback");
    ok(`${role} calling it is refused with a permission error`, /permission denied for function/i.test(e ?? ""), String(e));
  }

  // ── What it does ────────────────────────────────────────────────────────────────────────────────
  const OLD = "2026-01-01T00:00:00Z";
  await db.exec(`insert into device_push_tokens (token, org_id, user_id) values ('t1a', '${ORG}', '${U1}'), ('t1b', '${ORG}', '${U1}'), ('t2a', '${ORG}', '${U2}');
                 insert into device_push_tokens (token, org_id, user_id, revoked_at) values ('t1old', '${ORG}', '${U1}', '${OLD}')`);
  await db.exec("begin; set local role service_role");
  const first = await one(`select public.revoke_push_tokens($1) n`, [U1]);
  const second = await one(`select public.revoke_push_tokens($1) n`, [U1]);
  const nobody = await one(`select public.revoke_push_tokens(gen_random_uuid()) n`);
  await db.exec("commit");
  const tok = Object.fromEntries((await all(`select token, revoked_at is not null revoked, revoked_at = $1::timestamptz kept from device_push_tokens`, [OLD])).map((r) => [r.token, r]));
  ok("it revokes the user's active tokens and returns how many", first.n === 2, JSON.stringify(first));
  ok("both of that user's active tokens are revoked", tok.t1a.revoked && tok.t1b.revoked, JSON.stringify(tok));
  ok("an already-revoked token keeps its original timestamp", tok.t1old.kept === true, JSON.stringify(tok.t1old));
  ok("another user's token is untouched", tok.t2a.revoked === false, JSON.stringify(tok.t2a));
  ok("a second call revokes nothing and returns 0", second.n === 0, JSON.stringify(second));
  ok("a user with no tokens returns 0, not an error", nobody.n === 0, JSON.stringify(nobody));

} else {
  ok("the behaviour cases ran: revoke_push_tokens exists exactly once", false, `found ${fn.length}`);
}

// ── The helper nothing calls ────────────────────────────────────────────────────────────────────
const dedupeAfter = await one(`select count(*)::int n from pg_proc where proname = 'notify_dedupe_key'`);
ok("notify_dedupe_key is retired", dedupeAfter.n === 0, JSON.stringify(dedupeAfter));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;

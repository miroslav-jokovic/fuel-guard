#!/usr/bin/env node
/**
 * Does production still match its own migrations? (RELEASE-TRAIN-PLAN Q-REL6)
 *
 * Staging is built from `supabase/migrations/` and nothing else, so its schema IS the migrations'
 * schema. This script fingerprints both projects with one catalog query each and fails on any line
 * that one side has and the other does not.
 *
 * ── WHY IT EXISTS ─────────────────────────────────────────────────────────────────────────────────
 * Building staging on 2026-10-02 found production 38 items away from its migrations — six RESTRICTIVE
 * driver denials only production had, a NOT NULL column that would have failed the first driver
 * shift, broader storage policies, nineteen stray indexes. Every one was weeks old, made by editing
 * an applied migration or by hand in the dashboard, and nothing could see it: the PGlite matrices and
 * `schema.generated.sql` both render the migrations, never production. 0422 reconciled it; this keeps
 * it reconciled, by running every night and on any PR that touches it.
 *
 * ── WHAT IT COMPARES ──────────────────────────────────────────────────────────────────────────────
 * Public tables' columns, RLS flags and grants; every public index; every public function's signature,
 * body hash, security mode, settings and grants; every policy in public and storage; every public
 * trigger. NOT data, and NOT the auth/storage internals Supabase owns. The applied-migration list is
 * compared separately: staging runs ahead of production by up to a release, so a difference in the
 * LAST few versions is reported as "staging is ahead", and the fingerprint diff is skipped — a
 * migration in flight would otherwise read as drift.
 *
 * Run:  SUPABASE_ACCESS_TOKEN=… node scripts/schema-drift.mjs <production-ref> <staging-ref>
 *       node scripts/schema-drift.mjs --self-test
 */

export const FINGERPRINT_SQL = `
with fp(k, v) as (
  select 'column', c.table_name || '.' || c.column_name || ' ' || c.data_type || ' null=' || c.is_nullable
         || ' default=' || coalesce(c.column_default, '')
    from information_schema.columns c
    join pg_tables t on t.schemaname = c.table_schema and t.tablename = c.table_name
   where c.table_schema = 'public'
  union all
  select 'table', relname || ' rls=' || relrowsecurity || ' force=' || relforcerowsecurity
         || ' acl=' || coalesce(array_to_string(array(select unnest(relacl)::text order by 1), ','), '')
    from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
  union all
  select 'index', indexname || ' ' || indexdef from pg_indexes where schemaname = 'public'
  union all
  -- Constraints apart from their indexes: 0422's first push to production failed because
  -- uq_load_stops_seq was a UNIQUE CONSTRAINT there and a bare unique index on staging. pg_indexes
  -- renders both identically, so a fingerprint without this line called them equal.
  select 'constraint', conrelid::regclass::text || '.' || conname || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'public'::regnamespace and conrelid <> 0
  union all
  select 'function', p.oid::regprocedure::text || ' definer=' || p.prosecdef || ' volatility=' || p.provolatile::text
         || ' config=' || coalesce(array_to_string(p.proconfig, ','), '') || ' body=' || md5(p.prosrc)
         || ' acl=' || coalesce(array_to_string(array(select unnest(p.proacl)::text order by 1), ','), '')
    from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all
  select 'policy', schemaname || '.' || tablename || '.' || policyname || ' ' || permissive || ' ' || cmd
         || ' roles=' || array_to_string(roles, ',') || ' using=' || coalesce(qual, '') || ' check=' || coalesce(with_check, '')
    from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'trigger', event_object_table || '.' || trigger_name || ' ' || action_timing || ' ' || event_manipulation
         || ' ' || action_statement
    from information_schema.triggers where trigger_schema = 'public'
)
select k, v from fp order by 1, 2`;

export const VERSIONS_SQL = `select version from supabase_migrations.schema_migrations order by 1`;

/** Lines only `a` has, and lines only `b` has. Pure. */
export function diffLines(a, b) {
  const sa = new Set(a), sb = new Set(b);
  return { onlyA: a.filter((x) => !sb.has(x)), onlyB: b.filter((x) => !sa.has(x)) };
}

/**
 * Compare the two applied-migration lists. Production may be BEHIND staging (the release train
 * holds it back) but never ahead, and never missing a version in the middle — a gap means a
 * migration was skipped or hand-applied out of order. Pure.
 */
export function compareVersions(prod, staging) {
  const { onlyA: onlyProd, onlyB: onlyStaging } = diffLines(prod, staging);
  if (onlyProd.length) return { state: "broken", detail: `production has versions staging lacks: ${onlyProd.join(", ")}` };
  const newestProd = prod.at(-1) ?? "";
  const gaps = onlyStaging.filter((v) => v < newestProd);
  if (gaps.length) return { state: "broken", detail: `production skipped versions staging has: ${gaps.join(", ")}` };
  if (onlyStaging.length) return { state: "ahead", detail: `staging is ahead by ${onlyStaging.join(", ")}` };
  return { state: "same", detail: `both at ${newestProd}` };
}

async function query(ref, sql, token) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  if (!res.ok) throw new Error(`${ref}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

function selfTest() {
  let fail = 0;
  const eq = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — got ${JSON.stringify(got)}`}`);
  };
  eq("a line on one side only is reported on that side",
    diffLines(["x", "y"], ["y", "z"]), { onlyA: ["x"], onlyB: ["z"] });
  eq("identical sides report nothing", diffLines(["x"], ["x"]), { onlyA: [], onlyB: [] });
  eq("same versions are 'same'", compareVersions(["0001", "0002"], ["0001", "0002"]).state, "same");
  eq("staging newer at the end is 'ahead', not drift",
    compareVersions(["0001", "0002"], ["0001", "0002", "0003"]).state, "ahead");
  eq("production ahead of staging is broken", compareVersions(["0001", "0002"], ["0001"]).state, "broken");
  eq("a version production skipped in the middle is broken",
    compareVersions(["0001", "0003"], ["0001", "0002", "0003"]).state, "broken");
  console.log(`\nRESULT: ${6 - fail} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}

async function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const [prodRef, stagingRef] = process.argv.slice(2);
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!prodRef || !stagingRef || !token) {
    console.error("usage: SUPABASE_ACCESS_TOKEN=… node scripts/schema-drift.mjs <production-ref> <staging-ref>");
    process.exit(2);
  }
  if (prodRef === stagingRef) {
    console.error("✗ the two refs are the same project — refusing to compare production with itself.");
    process.exit(2);
  }

  const versions = (rows) => rows.map((r) => r.version);
  const v = compareVersions(versions(await query(prodRef, VERSIONS_SQL, token)), versions(await query(stagingRef, VERSIONS_SQL, token)));
  if (v.state === "broken") { console.error(`✗ migration history: ${v.detail}`); process.exit(1); }
  if (v.state === "ahead") { console.log(`… ${v.detail} — a release is in flight; schema comparison skipped.`); return; }

  const lines = (rows) => rows.map((r) => `${r.k}  ${r.v}`);
  const prod = lines(await query(prodRef, FINGERPRINT_SQL, token));
  const staging = lines(await query(stagingRef, FINGERPRINT_SQL, token));
  const { onlyA: onlyProd, onlyB: onlyStaging } = diffLines(prod, staging);
  if (!onlyProd.length && !onlyStaging.length) {
    console.log(`✓ no schema drift — ${v.detail}, ${prod.length} fingerprint lines identical.`);
    return;
  }
  console.error(`✗ schema drift at ${v.detail}: production differs from what its migrations build.\n`);
  for (const l of onlyProd) console.error(`  only production:  ${l}`);
  for (const l of onlyStaging) console.error(`  only migrations:  ${l}`);
  console.error(
    "\n  Fix with the next-numbered migration that makes both sides agree (0422 is the pattern),\n" +
      "  never by hand on either database.",
  );
  process.exit(1);
}

await main();

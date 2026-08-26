#!/usr/bin/env node
/**
 * Fitness function — an org-scoped RPC must be callable BY A BROWSER.
 *
 * ── THE DEFECT THIS EXISTS FOR (2026-08-26) ──────────────────────────────────────────────────────
 * D-FC1 is stated in prose across half a dozen migration headers: `security invoker` plus
 * `coalesce(p_org, auth_org_id())`, so "a browser passes nothing and is scoped by its JWT; the API
 * passes p_org explicitly because the service role bypasses RLS". Three functions implemented the
 * coalesce faithfully and missed the other half — `p_org` was declared FIRST and with NO DEFAULT.
 *
 * PostgREST resolves an RPC on the exact set of NAMED arguments supplied. With no default there is no
 * form of the function that omits `p_org`, so the browser gets:
 *
 *     Could not find the function public.ifta_period_jurisdictions(p_quarter, p_year)
 *        in the schema cache
 *
 * Two shipped surfaces were dead on arrival — `/ifta` and Fuel Spend's Buy discipline tab — and every
 * test passed throughout, because a test calls the function WITH an org and a positional `(…, null)`
 * resolves perfectly well without a default. Only omitting the argument fails, and only the browser
 * omits it. A contract stated only in prose is a contract that gets half-implemented.
 *
 * ── WHAT IT CHECKS ───────────────────────────────────────────────────────────────────────────────
 * For every function whose body coalesces `p_org` with `auth_org_id()` — the D-FC1 signature — the
 * LAST definition of that function across the migrations in order must declare `p_org` with a
 * DEFAULT. Last-definition, because migrations are append-only: 0254 will always contain the broken
 * declaration and 0258 is what the database ends up with.
 *
 * Postgres additionally requires defaulted parameters to follow non-defaulted ones, so "has a default"
 * and "comes last" are one property rather than two — checking the default is sufficient.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DIR = join(ROOT, "supabase/migrations");

/** `create or replace function name(params) … as $$ body $$` — non-greedy to the first `$$;`. */
const FUNCTION = /create\s+or\s+replace\s+function\s+([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*\n\s*returns([\s\S]*?)\$\$;/gi;
/** The D-FC1 signature: the body falls back to the caller's own org. */
const ORG_FALLBACK = /coalesce\s*\(\s*p_org\s*,\s*auth_org_id\s*\(\s*\)\s*\)/i;
/** `p_org uuid default null`, with any spacing. */
const HAS_DEFAULT = /\bp_org\b[^,)]*\bdefault\b/i;

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
/** name → { file, params } for the LAST definition seen, which is what the database ends up with. */
const latest = new Map();

for (const file of files) {
  const sql = readFileSync(join(DIR, file), "utf8");
  for (const m of sql.matchAll(FUNCTION)) {
    const [, name, params, rest] = m;
    // Only functions that opt into the contract by coalescing to the caller's org.
    if (!ORG_FALLBACK.test(rest)) continue;
    latest.set(name, { file, params });
  }
}

const bad = [];
for (const [name, { file, params }] of latest) {
  if (!/\bp_org\b/.test(params)) continue; // coalesces p_org but never declares it — a different bug, and it will not compile
  if (!HAS_DEFAULT.test(params)) bad.push({ name, file });
}

if (bad.length > 0) {
  console.error("✗ org-scoped RPC contract failed — these cannot be called from a browser:\n");
  for (const { name, file } of bad) {
    console.error(`  ${name}  (${file})`);
  }
  console.error(
    "\n  Each coalesces `p_org` with `auth_org_id()` but declares `p_org` without a DEFAULT.\n" +
      "  PostgREST resolves on the named arguments supplied, so with no default there is no form that\n" +
      "  omits `p_org` — and the browser omits it. Declare it LAST as `p_org uuid default null`\n" +
      "  (Postgres requires defaulted parameters to come after non-defaulted ones), in a NEW migration:\n" +
      "  `create or replace` cannot reorder parameters, so drop the old signature and recreate it.\n" +
      "  0258 is the worked example.",
  );
  process.exit(1);
}

console.log(
  `✓ org-scoped RPC contract ok — ${latest.size} function(s) coalesce to auth_org_id(), all callable without p_org.`,
);

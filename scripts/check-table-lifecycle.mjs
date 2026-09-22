#!/usr/bin/env node
/**
 * Fitness function — every table declares how it GROWS, and the declaration cannot drift from the
 * retention code that implements it (D-LIFE1/D-LIFE2, docs/plans/architecture/DATA-LIFECYCLE-PLAN.md).
 *
 * The 2026-09-21 growth audit measured what an undeclared lifecycle costs. This repo machine-enforces
 * a 500-line budget on a source FILE (check-file-size.mjs) and had nothing at all for a TABLE writing
 * three million rows a month. Measured that day against production: `audit_logs` 3.10M rows/30d,
 * `scoring_attempts` 2.21M, `hos_duty_segments` 894k — 94% of a ~31 GB/year trajectory — while every
 * fuel and engine table together came to 1.2%. Retention existed, was well built, and had **never
 * deleted a row**: 381 runs in seven days, all no-ops, because every table was younger than its own
 * 400-day window. A policy nothing measures is not a policy.
 *
 * Ownership lives in the same manifest and is checked by check-table-modules.mjs. That gate owns
 * "every live table is in the manifest"; this one owns "every manifest entry says how it grows", so
 * the pair covers live → owned → bounded without either re-deriving the other's invariant.
 *
 * Five checks:
 *
 *   1. Completeness — every manifest entry carries a `lifecycle` block.
 *   2. Shape — `growth` is one of the four words, `retention_days`/`budget_rows_per_day` are null or
 *      positive integers, `partition` is null or "month", and `why` is a real sentence. A `why` that
 *      says nothing is how the 400-day default survived three years of review.
 *   3. Retention agreement — `retention_days` MIRRORS RETENTION_RULES in dataRetention.ts, in both
 *      directions, and a table in RETENTION_FORBIDDEN must declare null. This is the check that makes
 *      the registry worth reading: a window and its declaration move in ONE commit, or CI fails.
 *   4. The `unmeasured` ratchet — a table with no rows in production when this gate landed may say
 *      `growth: "unmeasured"` only while it is named in UNMEASURED below. The list may only shrink.
 *      Inventing a budget for 97 empty tables would have been ninety-seven assumptions; owing one at
 *      first write is a decision the person adding the first writer is actually equipped to make.
 *   5. Partition claims — a table declaring `partition` must really be partitioned in
 *      supabase/schema.generated.sql. Nothing declares one yet (L7 is the first); the detector exists
 *      so that the claim can never be aspirational.
 *
 * What this gate deliberately does NOT do: check a budget against reality. A gate cannot see
 * production. That is the L8 growth judge's job, and the split is the point — declared here, enforced
 * here, observed there.
 *
 * `--self-test` proves each detector fires (house rule: a gate that cannot fail is not a gate).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const MANIFEST = join(ROOT, "scripts", "table-modules.json");
const RETENTION_TS = join(ROOT, "apps", "api", "src", "modules", "org", "dataRetention.ts");
const SCHEMA_SNAPSHOT = join(ROOT, "supabase", "schema.generated.sql");

const GROWTH = ["time", "fleet", "static", "unmeasured"];
const PARTITIONS = [null, "month"];

/**
 * A `growth: "time"` table must carry a budget. `audit_logs` is the one exception and it is a RULING,
 * not an oversight: the measured 2026-09-21 rate is 97% sync noise that L2 removes, and a budget set
 * against today's number would enshrine the defect as the allowance. It gains one in the same merge
 * that diff-gates the writer. This list may only shrink.
 */
const BUDGET_WAIVED = new Set(["audit_logs"]);

/**
 * Tables with zero rows in production on 2026-09-21, measured — not guessed — via pg_class over the
 * public schema. Each may declare `growth: "unmeasured"` until it has a writer worth measuring.
 * Ratchet: entries leave when the table gains a real declaration; nothing may be added without a
 * production measurement showing the table is empty.
 */
const UNMEASURED = new Set(JSON.parse(readFileSync(join(ROOT, "scripts", "table-lifecycle-unmeasured.json"), "utf8")));

/** Parse RETENTION_RULES / RETENTION_FORBIDDEN out of the TS rather than importing it — this gate runs
 *  under plain node with no build step, the same way check-table-modules.mjs reads migrations. */
export function parseRetention(ts) {
  const rules = {};
  const body = ts.slice(ts.indexOf("export const RETENTION_RULES"));
  for (const m of body.matchAll(/table:\s*"([a-z_]+)"[\s\S]{0,400}?keepDays:\s*(\d+)/g)) {
    rules[m[1]] ??= Number(m[2]);
  }
  const f = ts.match(/RETENTION_FORBIDDEN[^=]*=\s*\[([\s\S]*?)\]/);
  const forbidden = new Set(f ? [...f[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]) : []);
  return { rules, forbidden };
}

export function checkLifecycle(manifest, { rules, forbidden }, partitionedTables, unmeasured, budgetWaived) {
  const errors = [];
  for (const [t, v] of Object.entries(manifest.tables ?? {})) {
    const l = v?.lifecycle;
    if (!l) { errors.push(`${t}: no lifecycle block — declare growth, retention_days, partition, budget_rows_per_day and why (D-LIFE1)`); continue; }

    // 2. shape
    if (!GROWTH.includes(l.growth)) errors.push(`${t}: growth "${l.growth}" is not one of ${GROWTH.join(" | ")}`);
    for (const k of ["retention_days", "budget_rows_per_day"]) {
      const n = l[k];
      if (n !== null && !(Number.isInteger(n) && n > 0)) errors.push(`${t}: ${k} must be null or a positive integer, got ${JSON.stringify(n)}`);
    }
    if (!PARTITIONS.includes(l.partition ?? null)) errors.push(`${t}: partition must be null or "month", got ${JSON.stringify(l.partition)}`);
    if (typeof l.why !== "string" || l.why.trim().length < 20) errors.push(`${t}: why must be a sentence explaining the lifecycle, not a placeholder`);

    // 3. retention agreement, both directions
    const rule = rules[t] ?? null;
    if ((l.retention_days ?? null) !== rule) {
      errors.push(
        rule === null
          ? `${t}: declares retention_days ${l.retention_days} but dataRetention.ts has no rule for it — add the rule in this commit, or declare null`
          : `${t}: declares retention_days ${l.retention_days ?? "null"} but dataRetention.ts prunes at ${rule}d — they move together (D-LIFE2)`,
      );
    }
    if (forbidden.has(t) && l.retention_days !== null) errors.push(`${t}: is in RETENTION_FORBIDDEN and must declare retention_days null`);

    // 4. unmeasured ratchet
    if (l.growth === "unmeasured" && !unmeasured.has(t)) errors.push(`${t}: growth "unmeasured" is only legal for a table measured empty in production — declare how it grows`);
    if (l.growth !== "unmeasured" && unmeasured.has(t)) errors.push(`${t}: has a real growth declaration but is still in the unmeasured ratchet — remove it from scripts/table-lifecycle-unmeasured.json`);

    // budget required for time-growth, except the named waiver
    if (l.growth === "time" && l.budget_rows_per_day === null && !budgetWaived.has(t)) {
      errors.push(`${t}: growth "time" needs a budget_rows_per_day so the L8 judge has something to compare against`);
    }

    // 5. partition claim
    if (l.partition && !partitionedTables.has(t)) errors.push(`${t}: declares partition "${l.partition}" but is not partitioned in supabase/schema.generated.sql`);
  }
  return errors;
}

/** Tables declared `partition by` in the applied-state snapshot. */
export function partitionedIn(sql) {
  const out = new Set();
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)[\s\S]*?partition\s+by\s+range/gi)) out.add(m[1].toLowerCase());
  return out;
}

function selfTest(manifest, retention) {
  const fails = [];
  const anyTable = Object.keys(manifest.tables)[0];
  const one = (over) => ({ tables: { [anyTable]: { ...manifest.tables[anyTable], lifecycle: { ...manifest.tables[anyTable].lifecycle, ...over } } } });
  const run = (m, parts = new Set(), un = UNMEASURED, bw = BUDGET_WAIVED) => checkLifecycle(m, retention, parts, un, bw);

  if (!run({ tables: { [anyTable]: { module: "x", layer: "core" } } }).length) fails.push("completeness detector did not fire on a missing lifecycle block");
  if (!run(one({ growth: "sometimes" })).length) fails.push("shape detector did not fire on an invalid growth");
  if (!run(one({ why: "n/a" })).length) fails.push("shape detector did not fire on a placeholder why");
  if (!run(one({ retention_days: 7 })).length) fails.push("retention-agreement detector did not fire on a window with no rule");
  if (!run(one({ growth: "unmeasured" }), new Set(), new Set()).length) fails.push("unmeasured-ratchet detector did not fire on an unlisted table");
  if (!run(one({ partition: "month" })).length) fails.push("partition-claim detector did not fire on an unpartitioned table");
  if (!run(one({ growth: "time", budget_rows_per_day: null }), new Set(), UNMEASURED, new Set()).length) fails.push("budget detector did not fire on a time table with no budget");

  // the agreement check must also fire in the OTHER direction: a real rule the registry omits
  const [ruledTable] = Object.keys(retention.rules);
  if (ruledTable) {
    const m = { tables: { [ruledTable]: { module: "x", layer: "raw", lifecycle: { growth: "time", retention_days: null, partition: null, budget_rows_per_day: 10, why: "a sentence long enough to pass the shape check" } } } };
    if (!run(m).length) fails.push("retention-agreement detector did not fire on a rule the registry omits");
  }

  // partitionedIn must actually recognise a partitioned table
  if (!partitionedIn("create table public.foo (id uuid, created_at timestamptz) partition by range (created_at);").has("foo")) fails.push("partitionedIn did not recognise a partitioned table");
  return fails;
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const retention = parseRetention(readFileSync(RETENTION_TS, "utf8"));

if (process.argv.includes("--self-test")) {
  const fails = selfTest(manifest, retention);
  if (fails.length) { for (const f of fails) console.error(`✗ self-test: ${f}`); process.exit(1); }
  console.log("✓ table-lifecycle self-test — all eight detectors fire on synthetic violations.");
  process.exit(0);
}

let partitioned = new Set();
try { partitioned = partitionedIn(readFileSync(SCHEMA_SNAPSHOT, "utf8")); } catch { /* snapshot absent: no table may claim a partition */ }

const errors = checkLifecycle(manifest, retention, partitioned, UNMEASURED, BUDGET_WAIVED);
if (errors.length) {
  console.error(`✗ ${errors.length} table-lifecycle violation(s):`);
  for (const e of errors) console.error(`   ${e}`);
  process.exit(1);
}
const tables = Object.values(manifest.tables);
const byGrowth = tables.reduce((a, v) => ((a[v.lifecycle.growth] = (a[v.lifecycle.growth] ?? 0) + 1), a), {});
console.log(
  `✓ table lifecycle ok — ${tables.length} tables declared (` +
    Object.entries(byGrowth).sort().map(([k, n]) => `${n} ${k}`).join(", ") +
    `), ${Object.keys(retention.rules).length} retention windows mirrored, ${UNMEASURED.size} awaiting a first write.`,
);

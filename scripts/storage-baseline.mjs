#!/usr/bin/env node
/**
 * What does the compliance evidence bucket actually cost, and how much of it is garbage?
 *
 * WHY THIS EXISTS (DQF execution plan, step A2). Step B7 just pointed the nightly orphan sweep at
 * `compliance-docs` for the first time since the bucket shipped in 0146. That sweep will delete
 * objects — and "it deleted some orphans" is not a result anybody can check. This script is the
 * BEFORE measurement, so the sweep's effect is a number rather than an assertion, and so the
 * derivative pipeline (B1–B6) can be argued for in bytes instead of adjectives.
 *
 * It answers four questions the code cannot:
 *   1. How many documents exist, and how many bytes, split by content type and variant.
 *   2. How many OBJECTS are in the bucket — which is a different number, and the gap is the leak.
 *   3. Orphan objects (bytes with no row) and missing objects (rows whose evidence is gone).
 *   4. What the derivative pipeline would save on the images already filed.
 *
 * STRICTLY READ-ONLY. It lists and selects. It never deletes, never writes a row, never uploads.
 * The sweep is the thing that deletes, and it runs on its own schedule with its own 24-hour grace.
 *
 * PRINTS NO PII. Document rows carry a driver's medical card and drug-test history behind them;
 * this reports counts, byte totals and — for the missing-object case, which needs investigating —
 * storage paths, which are UUIDs. No names, no kinds tied to a person.
 *
 * Reads Supabase credentials from apps/api/.env (service role — local use only, never a browser).
 *
 *   node scripts/storage-baseline.mjs
 *   node scripts/storage-baseline.mjs --bucket hazmat --table hazmat_documents
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BUCKET = flag("bucket", "compliance-docs");
const TABLE = flag("table", "documents");

const envPath = join(ROOT, "apps/api/.env");
if (!existsSync(envPath)) {
  console.error("No apps/api/.env — this script needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("apps/api/.env is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
const out = [];
const say = (line = "") => {
  out.push(line);
  console.log(line);
};

/**
 * Recursive listing, mirroring `listAllObjects` in storageReconcile.ts — folders come back with a
 * null id, files with a real one. Kept as its own copy on purpose: this script must be runnable
 * against a checkout that has not been built, and importing the API's TypeScript would need one.
 */
async function listAllObjects(bucket, prefix = "", acc = []) {
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: pageSize, offset });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    const items = data ?? [];
    for (const it of items) {
      const full = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id === null || it.id === undefined) await listAllObjects(bucket, full, acc);
      else acc.push({ path: full, size: it.metadata?.size ?? null, createdAt: it.created_at ?? null });
    }
    if (items.length < pageSize) break;
  }
  return acc;
}

/** Every row, paged — a `select` without a range caps at PostgREST's default and would undercount. */
async function allRows(table) {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select("storage_path, content_type, variant, bytes, created_at")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`select ${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return rows;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** What B1's specs would do to the images already filed — the argument for the derivative pipeline. */
function projectDerivatives(rows) {
  const images = rows.filter((r) => (r.content_type ?? "").startsWith("image/") && r.variant === "original");
  const originalBytes = images.reduce((n, r) => n + (r.bytes ?? 0), 0);
  // Conservative: a 320px q65 thumb lands ~40 KB, a 2000px q82 render ~350 KB, for a scanned page.
  const derivedBytes = images.length * (40 + 350) * 1024;
  return { count: images.length, originalBytes, derivedBytes };
}

const [rows, objects] = await Promise.all([allRows(TABLE), listAllObjects(BUCKET)]);
const now = Date.now();

const rowPaths = new Set(rows.map((r) => r.storage_path));
const objPaths = new Set(objects.map((o) => o.path));
const orphans = objects.filter((o) => !rowPaths.has(o.path));
const orphansPastGrace = orphans.filter((o) => o.createdAt && now - Date.parse(o.createdAt) > DAY_MS);
const missing = rows.filter((r) => !objPaths.has(r.storage_path));

const rowBytes = rows.reduce((n, r) => n + (r.bytes ?? 0), 0);
const objBytes = objects.reduce((n, o) => n + (o.size ?? 0), 0);
const orphanBytes = orphans.reduce((n, o) => n + (o.size ?? 0), 0);

say(`# Storage baseline — \`${BUCKET}\` / \`${TABLE}\``);
say();
say(`Taken ${new Date().toISOString()}. Read-only.`);
say();
say("> Machine-generated by `node scripts/storage-baseline.mjs` — re-running OVERWRITES this file.");
say("> Interpretation belongs in `DQF-EXECUTION-PLAN.md` step A2, not here.");
say();
say(`| Measure | Value |`);
say(`|---|---|`);
say(`| Rows in \`${TABLE}\` | ${rows.length} |`);
say(`| Bytes recorded on those rows | ${mb(rowBytes)} MB |`);
say(`| Objects in \`${BUCKET}\` | ${objects.length} |`);
say(`| Bytes actually stored | ${mb(objBytes)} MB |`);
say(`| **Orphan objects** (bytes with no row) | **${orphans.length}** (${mb(orphanBytes)} MB) |`);
say(`| …of those, past the 24h grace — what B7's first sweep deletes | ${orphansPastGrace.length} |`);
say(`| **Missing objects** (rows whose evidence is gone) | **${missing.length}** |`);
say();

const byVariant = new Map();
for (const r of rows) {
  const key = `${r.variant ?? "?"} · ${r.content_type ?? "?"}`;
  const cur = byVariant.get(key) ?? { n: 0, bytes: 0 };
  byVariant.set(key, { n: cur.n + 1, bytes: cur.bytes + (r.bytes ?? 0) });
}
say(`## By variant and content type`);
say();
say(`| Variant · Content type | Rows | Bytes |`);
say(`|---|---|---|`);
for (const [key, v] of [...byVariant.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
  say(`| ${key} | ${v.n} | ${mb(v.bytes)} MB |`);
}
say();

const proj = projectDerivatives(rows);
say(`## What the derivative pipeline (B1–B6) would add and save`);
say();
say(`- Image originals already filed: **${proj.count}** (${mb(proj.originalBytes)} MB)`);
say(`- Derivatives they would produce: ~${mb(proj.derivedBytes)} MB of ADDED storage (originals are never purged — D-DQ10)`);
say(
  `- Egress avoided per full fleet-table render: ${mb(proj.originalBytes)} MB → ~${mb(proj.count * 40 * 1024)} MB on thumbs`,
);
say();

if (missing.length > 0) {
  say(`## ⚠ Rows pointing at a missing object`);
  say();
  say(`These are the D13 restore signal — a row is the claim that evidence exists. **The sweep never`);
  say(`deletes these**; they need investigating. Paths are UUIDs, no PII.`);
  say();
  for (const r of missing.slice(0, 25)) say(`- \`${r.storage_path}\` (${r.variant}, ${r.content_type})`);
  if (missing.length > 25) say(`- …and ${missing.length - 25} more`);
  say();
}

const dest = join(ROOT, "docs/plans/safety-dqf/STORAGE-BASELINE.md");
mkdirSync(join(ROOT, "docs/plans/safety-dqf"), { recursive: true });
writeFileSync(dest, out.join("\n") + "\n");
console.log(`\nWritten to ${dest}`);

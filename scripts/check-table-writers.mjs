#!/usr/bin/env node
/**
 * Fitness function — no table quietly gains a new writer.
 *
 * D-ARC3 (docs/ARCHITECTURE.md §3): every table has exactly one owning module, and only the owner
 * writes it. The 2026-08-26 audit measured what the absence of that rule cost: `fuel_transactions`
 * written from 35 API files, `drivers` touched from 54, and one compliance fact (CDL expiry) kept
 * in two places by two writers that never heard of each other. The API reads with the service
 * role, so RLS cannot police this — a static write-site inventory is the wall.
 *
 * apps/api has no module layout yet (the carve-outs are the migration), so this gate cannot say
 * "outside the owner's directory" today. What it CAN do, from day one, is freeze the writer set:
 * `scripts/table-writers.json` pins every (table → writing file) pair that exists now. A file not
 * in the list that starts writing a table fails the build — the author either routes the write
 * through the current owner, or adds the pair to the manifest IN THE SAME PR with the reason in
 * the commit, where the reviewer sees it. Entries whose write site disappears must be removed
 * (the ratchet only tightens). As carve-outs land, each module's tables collapse to writer paths
 * inside the module, and this manifest becomes the ownership map §3 promises.
 *
 * Detection: `.from("<table>")` whose same expression chain calls .insert/.update/.delete/.upsert
 * (heuristic window: the next 250 chars, stopping at the next `.from(`). RPC-bodied writes are
 * covered by check-table-producers.mjs's DML scan and are out of scope here, v1.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const MANIFEST = join(ROOT, "scripts", "table-writers.json");

const WRITE_RE = /\.(insert|update|delete|upsert)\s*\(/;
const FROM_RE = /\.from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)/g;

const found = new Map(); // table → Set<file>
function scan(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".expo" || name === "ios" || name === "android") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { scan(p); continue; }
    if (!/\.(ts|tsx|vue|mjs)$/.test(name) || /\.test\.|\.spec\.|\/testing\//.test(p)) continue;
    const src = readFileSync(p, "utf8");
    for (const m of src.matchAll(FROM_RE)) {
      const windowEnd = src.indexOf(".from(", m.index + m[0].length);
      const window = src.slice(m.index + m[0].length, windowEnd === -1 ? m.index + m[0].length + 250 : Math.min(windowEnd, m.index + m[0].length + 250));
      if (WRITE_RE.test(window)) {
        if (!found.has(m[1])) found.set(m[1], new Set());
        found.get(m[1]).add(relative(ROOT, p));
      }
    }
  }
}
for (const d of ["apps", "packages"]) scan(join(ROOT, d));

if (process.argv.includes("--init")) {
  const out = {};
  for (const t of [...found.keys()].sort()) out[t] = [...found.get(t)].sort();
  const { writeFileSync } = await import("node:fs");
  writeFileSync(MANIFEST, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${MANIFEST} — ${found.size} tables, ${[...found.values()].reduce((n, s) => n + s.size, 0)} write sites`);
  process.exit(0);
}

const pinned = JSON.parse(readFileSync(MANIFEST, "utf8"));
const newWriters = [];
const staleWriters = [];
for (const [t, files] of found) {
  for (const f of files) if (!(pinned[t] ?? []).includes(f)) newWriters.push(`${t} ← ${f}`);
}
for (const [t, files] of Object.entries(pinned)) {
  for (const f of files) if (!found.get(t)?.has(f)) staleWriters.push(`${t} ← ${f}`);
}

if (newWriters.length) {
  console.error(`✗ ${newWriters.length} new table write site(s) not in scripts/table-writers.json:`);
  for (const w of newWriters) console.error(`   ${w}`);
  console.error(
    "  Route the write through the table's current owner (docs/ARCHITECTURE.md §3), or add the pair" +
      " to the manifest in this PR with the reason in the commit message.",
  );
  process.exit(1);
}
if (staleWriters.length) {
  console.error(`✗ ${staleWriters.length} manifest entr(ies) point at write sites that no longer exist — ratchet down:`);
  for (const w of staleWriters) console.error(`   ${w}`);
  process.exit(1);
}
const sites = [...found.values()].reduce((n, s) => n + s.size, 0);
console.log(`✓ table writers ok — ${found.size} written tables, ${sites} pinned write sites, none new, none stale.`);

// APR0.1 inventory generator for the fuel pilot (PRODUCTION-READINESS-AND-DATA-SEPARATION-PLAN.md).
// Run from the repo root: node docs/audits/architecture-readiness/2026-10-05/inventory.mjs > \
//   docs/audits/architecture-readiness/2026-10-05/fuel-pilot-inventory.json
// Structural only: writers come from table-writers.json, readers from a `.from("<table>")` scan of
// non-test source, functions from the LAST migration that defines them (a later drop removes one),
// triggers and policies from schema.generated.sql, exceptions from the two gates' grandfather lists.
// Not seen: dynamic `.from(var)` (10 pinned sites, see lint:table-access), raw SQL strings outside
// migrations, and reads through a view or RPC — a function's `reads` means its body names the table.
import fs from "node:fs";
import path from "node:path";
import { execSync, execFileSync } from "node:child_process";

const mods = JSON.parse(fs.readFileSync("scripts/table-modules.json", "utf8"));
const tablesMeta = mods.tables ?? mods;
const writers = JSON.parse(fs.readFileSync("scripts/table-writers.json", "utf8"));
const snap = fs.readFileSync("supabase/schema.generated.sql", "utf8");

const PILOT = /fuel|efs|card|anomal|scor|declin|recon|spend|discount|station|price/;
const tables = Object.keys(tablesMeta)
  .filter((t) => PILOT.test(t))
  .sort();

// Latest definition of every function, by migration order (last create wins; a later drop removes it).
const migDir = "supabase/migrations";
const migs = fs
  .readdirSync(migDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const fnDefs = new Map(); // name -> { migration, body }
const fnRe =
  /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?("?[a-z0-9_]+"?)\s*\(([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\3\$/gi;
const dropRe = /drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi;
for (const f of migs) {
  const sql = fs.readFileSync(path.join(migDir, f), "utf8");
  for (const m of sql.matchAll(dropRe)) fnDefs.delete(m[1].toLowerCase());
  for (const m of sql.matchAll(fnRe)) {
    fnDefs.set(m[1].replaceAll('"', "").toLowerCase(), {
      migration: f.slice(0, 4),
      header: m[2],
      body: m[4],
    });
  }
}

// Triggers per table, from the snapshot (authoritative for the applied state).
const triggers = {};
for (const m of snap.matchAll(
  /trigger: create trigger (\S+) (?:before|after|instead of) [^\n]*? on public\.([a-z0-9_]+) [^\n]*?execute function ([a-z0-9_]+)/g,
)) {
  (triggers[m[2]] ??= []).push({ name: m[1], fn: m[3] });
}
// Policies per table, from the snapshot.
const policies = {};
let cur = null;
for (const line of snap.split("\n")) {
  const t = line.match(/^-- table ([a-z0-9_]+)/);
  if (t) cur = t[1];
  const p = line.match(/^ {2}policy (\S+ \[[A-Z]+\/[A-Z]+\])/);
  if (p && cur) (policies[cur] ??= []).push(p[1].slice(0, 160));
}

// Code readers: `.from("t")` anywhere outside tests, split by app.
const grep = (pat) => {
  try {
    return execFileSync(
      "git",
      [
        "grep",
        "-lE",
        pat,
        "--",
        "apps/**/*.ts",
        "apps/**/*.vue",
        "packages/**/*.ts",
        "tools/**/*.ts",
      ],
      { encoding: "utf8" },
    )
      .split("\n")
      .filter((f) => f && !/\.test\.|\/testing\/|__tests__/.test(f));
  } catch {
    return [];
  }
};

const grandfathered = (file, name) => {
  const src = fs.readFileSync(file, "utf8");
  const block = src.slice(src.indexOf(`const ${name} = new Set([`));
  const body = block.slice(0, block.indexOf("]);"));
  return [...body.matchAll(/"([a-z0-9_]+) <- ([^"]+)"/g)].map((m) => ({ table: m[1], file: m[2] }));
};
const rawAccess = grandfathered("scripts/check-table-access.mjs", "GRANDFATHERED_ACCESS");
const writerDebt = grandfathered("scripts/check-table-modules.mjs", "GRANDFATHERED_WRITERS");

const out = {};
for (const t of tables) {
  const meta = tablesMeta[t];
  const fromFiles = grep(`\\.from\\(["'\`]${t}["'\`]\\)`);
  const w = new Set(writers[t] ?? []);
  const fns = [...fnDefs.entries()]
    .filter(([, d]) => new RegExp(`\\b(public\\.)?${t}\\b`).test(d.body))
    .map(([n, d]) => {
      const writes = new RegExp(
        `(insert\\s+into|update|delete\\s+from)\\s+(public\\.)?${t}\\b`,
        "i",
      ).test(d.body);
      const definer =
        /security\s+definer/i.test(d.header + d.body.slice(-400)) ||
        /security\s+definer/i.test(d.header);
      return { fn: n, migration: d.migration, writes, definer };
    });
  out[t] = {
    module: meta.module,
    layer: meta.layer,
    lifecycle: meta.lifecycle ?? null,
    writers: [...w],
    readers_api: fromFiles.filter((f) => f.startsWith("apps/api/") && !w.has(f)),
    readers_web: fromFiles.filter((f) => f.startsWith("apps/web/") && !w.has(f)),
    readers_other: fromFiles.filter(
      (f) => !f.startsWith("apps/api/") && !f.startsWith("apps/web/") && !w.has(f),
    ),
    sql_functions: fns,
    triggers: triggers[t] ?? [],
    policies: policies[t] ?? [],
    grandfathered_raw_access: rawAccess.filter((g) => g.table === t).map((g) => g.file),
    grandfathered_writers: writerDebt.filter((g) => g.table === t).map((g) => g.file),
  };
}
console.log(
  JSON.stringify(
    {
      commit: execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(),
      totals: { rawAccessGrandfathered: rawAccess.length, writersGrandfathered: writerDebt.length },
      tables: out,
    },
    null,
    2,
  ),
);

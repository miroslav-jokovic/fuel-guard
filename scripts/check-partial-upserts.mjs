#!/usr/bin/env node
/**
 * Fitness function — no `.upsert()` used as "update just my columns".
 *
 * WHY THIS EXISTS. The same defect shipped three times in three days and took the Idling and HOS syncs
 * down for a day (incident 2026-08-10):
 *
 *   idleEquipmentEvidenceSync  →  idle_park_sessions   (1136ca7)
 *   idleDutyEvidenceSync       →  idle_park_sessions   (a4b85f4)
 *   idleLearnedEnvelopeSync    →  vehicles             (1136ca7, surfaced only once the first two were fixed)
 *
 * Each service owned a disjoint group of columns on a shared table and expressed "write only mine" as a
 * PostgREST upsert carrying only those columns, keyed on the primary key. PostgREST compiles that to
 * `INSERT … ON CONFLICT (id) DO UPDATE`, and **Postgres evaluates NOT NULL on the proposed tuple BEFORE
 * conflict arbitration** — so the write fails with a not-null violation even though every row it targets
 * already exists. Nothing caught it: the service tests use an in-memory Supabase fake with no
 * constraints, so all three shipped green.
 *
 * TWO RULES, both checked against the required columns derived from the migration ledger:
 *
 *   A. INLINE OBJECT LITERAL payload — the keys are right there, so compare them directly. Any required
 *      column the literal does not set is a runtime failure waiting for the first row that already
 *      exists. Applies to every upsert regardless of its conflict target.
 *
 *   B. NON-LITERAL payload (a variable, a mapped array) keyed on `onConflict: "id"` — the primary key
 *      alone. That is the signature of "I mean UPDATE": nothing about the call can supply the rest of
 *      the row's required columns. Banned outright; write an UPDATE, or a set-based UPDATE RPC for bulk
 *      (migrations 0174 / 0175 are the pattern).
 *
 * A non-literal payload on a COMPOSITE conflict target is not flagged: the conflict columns are
 * themselves the table's identity, so the payload demonstrably carries them, and the rest cannot be
 * determined without type resolution. That is the known blind spot — keep bulk writes that own a column
 * subset going through an RPC and it stays empty.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS = join(ROOT, "supabase/migrations");
const SCAN_DIRS = ["apps", "packages"];
const SKIP = new Set(["node_modules", "dist", ".git", "coverage", ".pnpm-store", "android", "ios", ".expo"]);

/**
 * Upserts allowed to conflict on the primary key. Each entry is a claim that the payload carries EVERY
 * required column — i.e. it is a genuine insert-or-replace of a whole row, not a column-group update.
 */
const ALLOWED = {
  // All three are insert-or-skip (`ignoreDuplicates: true`) of a COMPLETE row whose primary key is a
  // client-generated UUID — the idempotent-replay pattern for an offline outbox, not a column-group
  // update. Each payload was checked against the table's required columns when this list was written:
  //   hazmat_documents — full document row
  //   hazmat_loads     — carries org_id (its only required column)
  //   documents        — carries org_id, subject_type, subject_id, kind, storage_path, content_type, sha256
  // Note `ignoreDuplicates` is NOT a general exemption: DO NOTHING still evaluates NOT NULL on the
  // proposed tuple, so an incomplete insert-or-skip fails exactly like an incomplete DO UPDATE.
  "apps/api/src/services/hazmatLoads.ts": ["hazmat_documents", "hazmat_loads"],
  "apps/api/src/services/compliance.ts": ["documents"],
};

// ── required columns per table, from the migration ledger ────────────────────────────────────────
const required = new Map(); // table -> Set(column)
const addRequired = (t, c) => {
  if (!required.has(t)) required.set(t, new Set());
  required.get(t).add(c);
};
const dropRequired = (t, c) => required.get(t)?.delete(c);

const CREATE_RE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\s*\);/gi;
const ALTER_ADD_RE =
  /alter\s+table\s+(?:only\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)([^;,]*)/gi;
const ALTER_DROP_NOTNULL_RE =
  /alter\s+table\s+(?:only\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s+alter\s+column\s+([a-z_][a-z0-9_]*)\s+drop\s+not\s+null/gi;

/** A column definition is "required" when it is NOT NULL, has no DEFAULT, and is not the pk itself. */
const isRequired = (def) =>
  /\bnot\s+null\b/i.test(def) && !/\bdefault\b/i.test(def) && !/\bprimary\s+key\b/i.test(def);

for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  for (const m of sql.matchAll(CREATE_RE)) {
    const table = m[1].toLowerCase();
    for (const rawLine of m[2].split("\n")) {
      const line = rawLine.trim().replace(/,$/, "");
      const col = /^([a-z_][a-z0-9_]*)\s+/i.exec(line);
      if (!col) continue;
      if (/^(constraint|unique|primary|check|foreign|exclude)\b/i.test(line)) continue;
      if (isRequired(line)) addRequired(table, col[1].toLowerCase());
    }
  }
  for (const m of sql.matchAll(ALTER_ADD_RE)) {
    if (isRequired(m[3])) addRequired(m[1].toLowerCase(), m[2].toLowerCase());
  }
  for (const m of sql.matchAll(ALTER_DROP_NOTNULL_RE)) dropRequired(m[1].toLowerCase(), m[2].toLowerCase());
}

// ── find `.from("t")….upsert(x, { onConflict: "id" })` ───────────────────────────────────────────
const isSource = (f) => [".ts", ".tsx"].includes(extname(f)) && !/\.(test|spec)\.tsx?$/.test(f);
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (isSource(name)) out.push(full);
  }
  return out;
}


/**
 * Top-level keys of an inline object-literal payload, or null when the first argument is not a literal
 * (an identifier, a `.map(...)`, a spread-only object). Brace/bracket/string aware so nested objects and
 * arrays do not leak their keys into the result.
 */
function topLevelKeys(call) {
  const src = call.trimStart();
  if (!src.startsWith("{")) return null;
  const keys = new Set();
  let depth = 0;
  let quote = null;
  let atKeyPosition = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{" || ch === "[" || ch === "(") { depth += 1; atKeyPosition = depth === 1; continue; }
    if (ch === "}" || ch === "]" || ch === ")") { depth -= 1; if (depth === 0) break; continue; }
    if (depth === 1 && ch === ",") { atKeyPosition = true; continue; }
    if (depth === 1 && atKeyPosition && /\S/.test(ch)) {
      const rest = src.slice(i);
      if (rest.startsWith("...")) return null; // a spread can supply anything — do not guess
      // `key: value`, `"key": value`, and ES6 shorthand (`email,` / `token }`) all name a column.
      const key =
        /^["'`]?([A-Za-z_][A-Za-z0-9_]*)["'`]?\s*:/.exec(rest) ??
        /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:,|\}|$)/.exec(rest);
      if (key) keys.add(key[1].toLowerCase());
      atKeyPosition = false;
    }
  }
  return keys;
}

const violations = [];
for (const dir of SCAN_DIRS) {
  let files;
  try {
    files = walk(join(ROOT, dir));
  } catch {
    continue; // a workspace dir that does not exist in this checkout
  }
  for (const full of files) {
    const rel = relative(ROOT, full);
    const src = readFileSync(full, "utf8");
    // `.from("table")` … `.upsert(`, then an onConflict naming the primary key alone.
    for (const m of src.matchAll(
      // The `.from(t)` and the `.upsert(` must be links in the SAME chain: allow anything between them
      // EXCEPT another `.from(`, which would mean we had walked into a different query.
      /\.from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)((?:(?!\.from\()[\s\S]){0,400}?)\.upsert\(([\s\S]{0,600}?)\)\s*[;\n]/g,
    )) {
      const table = m[1].toLowerCase();
      const call = m[3];
      if ((ALLOWED[rel] ?? []).includes(table)) continue;
      const need = [...(required.get(table) ?? [])].filter((c) => c !== "id");
      if (need.length === 0) continue;
      const line = src.slice(0, m.index).split("\n").length;

      const literalKeys = topLevelKeys(call);
      if (literalKeys) {
        // Rule A — the payload is right here; compare it.
        const missing = need.filter((c) => !literalKeys.has(c));
        if (missing.length) violations.push({ rel, line, table, missing, why: "literal payload omits" });
        continue;
      }
      // Rule B — opaque payload keyed on the primary key alone.
      const conflict = /onConflict:\s*["'`]([^"'`]+)["'`]/.exec(call);
      if (conflict && conflict[1].trim() === "id") {
        violations.push({ rel, line, table, missing: need, why: "primary-key upsert cannot guarantee" });
      }
    }
  }
}

if (violations.length) {
  console.error("✗ upsert-as-update check failed — these upsert on the primary key alone, into a table");
  console.error("  with NOT NULL columns they do not carry. Postgres checks NOT NULL before ON CONFLICT");
  console.error("  arbitration, so this fails at runtime on rows that already exist.\n");
  for (const v of violations) {
    console.error(`  ${v.rel}:${v.line}  →  ${v.table}`);
    console.error(`      ${v.why}: ${v.missing.join(", ")}`);
  }
  console.error("\n  Use .update(), or a set-based UPDATE RPC for bulk (see migrations 0174 / 0175).");
  console.error("  If the payload really does carry every required column, add it to ALLOWED with why.");
  process.exit(1);
}

const tables = [...required.keys()].length;
console.log(`✓ upsert-as-update ok — no primary-key upsert into any of the ${tables} tables with required columns.`);

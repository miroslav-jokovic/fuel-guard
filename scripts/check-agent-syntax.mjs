#!/usr/bin/env node
/**
 * Every `tools/**` module must PARSE.
 *
 * `eslint.config.js` excludes `tools/**` on purpose — the on-prem agent runs on the carrier's own
 * Node, not the app's, and linting it as app code would be wrong. But the exclusion left it with no
 * gate at all, and on 2026-08-28 that shipped: a comment inside the billing SELECT was written with
 * backticks around a column name, which TERMINATED the template literal it lived in. The agent then
 * died at import with `SyntaxError: Unexpected identifier 'distance'` — not on a code path, at load,
 * so every sweep it performs was broken at once. CI was green, because nothing read the file.
 *
 * That is a bad failure for this particular directory to be capable of. The agent is the only thing
 * that puts McLeod data into the store; when it cannot start, settlements, fuel, billing, vouchers,
 * movements and the general ledger all stop arriving together, and the pages that read them degrade
 * to "not swept yet" rather than to an error anyone would chase.
 *
 * So this checks the one property that needs no knowledge of the agent's runtime: it parses. Node's
 * own parser, the same one the carrier's Node will use, via `--check`. Nothing about style, imports
 * or environment — a syntax gate and only that.
 *
 * Chained onto `lint:cli-streams` so CI runs it without a workflow edit (the house convention;
 * `lint:schema-snapshot` and `lint:table-access` are chained the same way).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import process from "node:process";

const ROOT = new URL("..", import.meta.url).pathname;
const SCAN = join(ROOT, "tools");

/** `node --check` treats .mjs as ESM, which is what these files are. */
const PARSEABLE = /\.mjs$/;
const SKIP = new Set(["node_modules"]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (PARSEABLE.test(entry)) out.push(full);
  }
  return out;
}

let files;
try {
  files = walk(SCAN);
} catch {
  console.log("✓ agent syntax ok — no tools/ directory to scan.");
  process.exit(0);
}

const broken = [];
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    const detail = String(e.stderr ?? "").split("\n").find((l) => l.includes("Error")) ?? "parse failed";
    broken.push({ file: file.replace(ROOT, ""), detail: detail.trim() });
  }
}

// ── The McLeod connector's read discipline (CA2, docs/plans/mcleod/COLLECTOR-AUDIT-2026-09-24.md) ──
//
// The letter to the carrier promises how every statement reaches their server. connection.mjs keeps
// those promises in one place; these rules stop a future file from walking around it. Each rule was
// proven by adding the violation to a scratch file and watching this script fail.
const AGENT = join(SCAN, "mcleod-agent");
const AGENT_RULES = [
  {
    // A dirty read reaching a financial figure is worse than waiting (D-MCC6).
    re: /\(\s*NOLOCK\s*\)|\bREADUNCOMMITTED\b|ISOLATION\s+LEVEL\s+READ\s+UNCOMMITTED/i,
    why: "NOLOCK / READ UNCOMMITTED — the letter promises we never read a half-written row",
  },
  {
    // lme is compatibility level 110 (measured 2026-09-24): these do not exist there and fail at run
    // time, and the usual fallback for STRING_SPLIT is a LIKE scan.
    re: /\b(STRING_SPLIT|STRING_AGG|OPENJSON|CONCAT_WS|TRANSLATE|GREATEST|LEAST)\s*\(|(?<![LR])\bTRIM\s*\(/,
    why: "a function lme's compatibility level 110 does not have — use FOR XML PATH, LTRIM(RTRIM()), typed parameter lists",
  },
  {
    re: /\bOPTION\s*\(\s*(MAXDOP|RECOMPILE|FAST|HASH|LOOP|MERGE|FORCE|USE)\b/i,
    why: "a query hint in a statement — connection.mjs owns hints (MAXDOP 1 on every statement)",
    except: "connection.mjs",
  },
  {
    re: /\bConnectionPool\b|\bmssql\.connect\s*\(|import\(\s*["']mssql["']\s*\)|from\s+["']mssql["']/,
    why: "a connection opened outside connection.mjs — one connection, one set of session settings",
    except: "connection.mjs",
  },
];

/** `.input(name, value)` with no SQL type binds NVARCHAR and scans char() keys, 115× (D-MCC11). */
function untypedInputs(src) {
  const out = [];
  for (let i = src.indexOf(".input("); i !== -1; i = src.indexOf(".input(", i + 1)) {
    let depth = 0;
    let commas = 0;
    for (let j = i + ".input(".length - 1; j < src.length; j++) {
      const ch = src[j];
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") {
        depth--;
        if (depth === 0) break;
      } else if (ch === "," && depth === 1) commas++;
    }
    if (commas < 2) out.push(src.slice(0, i).split("\n").length);
  }
  return out;
}

const disciplineErrors = [];
let agentFiles = [];
try {
  agentFiles = readdirSync(AGENT).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"));
} catch {
  /* no agent directory — nothing to check */
}
for (const f of agentFiles) {
  const src = readFileSync(join(AGENT, f), "utf8");
  for (const rule of AGENT_RULES) {
    if (rule.except === f) continue;
    const m = src.match(rule.re);
    if (m) disciplineErrors.push(`tools/mcleod-agent/${f}:${src.slice(0, m.index).split("\n").length}  ${rule.why}`);
  }
  for (const line of untypedInputs(src)) {
    disciplineErrors.push(`tools/mcleod-agent/${f}:${line}  untyped .input() — declare mssql.VarChar(n)/DateTime/Int (D-MCC11)`);
  }
}
if (disciplineErrors.length) {
  console.error(`\n✗ ${disciplineErrors.length} McLeod read-discipline violation(s):`);
  for (const e of disciplineErrors) console.error(`  ${e}`);
  console.error("\n  Every read goes through tools/mcleod-agent/connection.mjs, typed, with no hint of its own —");
  console.error("  that is what the letter to the carrier promises. See COLLECTOR-AUDIT-2026-09-24.md §4.2.");
  process.exit(1);
}

if (broken.length) {
  console.error(`\n✗ ${broken.length} tools/ file(s) do not parse:`);
  for (const b of broken) console.error(`  ${b.file}  ${b.detail}`);
  console.error("\n  These run on the carrier's Node, outside eslint's scope — a syntax error here");
  console.error("  stops every McLeod sweep at import, and the pages just read as 'not swept yet'.");
  process.exit(1);
}

console.log(`✓ agent syntax ok — ${files.length} tools/ module(s) parse; ${agentFiles.length} McLeod module(s) keep the read discipline.`);

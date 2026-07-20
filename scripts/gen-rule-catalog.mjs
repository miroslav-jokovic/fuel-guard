#!/usr/bin/env node
/**
 * Phase 7 SSOT generator — anomaly rule catalog.
 *
 * Reads packages/shared/src/anomalyRules/catalog.yaml (the single source of truth for a rule's static
 * spec) and writes packages/shared/src/anomalyRules/catalog.generated.ts. Business logic (the rule
 * functions, per-fill severity, gating) stays hand-authored — this only generates the derived constants
 * and types that used to be maintained by hand in ids.ts and cases.ts.
 *
 * Run: `pnpm gen:rules` (or `pnpm gen`). CI regenerates and fails on any drift (git diff --exit-code).
 *
 * Dependency-free by design: it parses the RESTRICTED YAML subset this catalog uses (a `rules:` list of
 * maps with single-line scalar values) with a small strict reader, so the codegen adds no package to the
 * lockfile and CI needs nothing extra installed. The reader fails loudly on anything it doesn't expect.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CATALOG = join(ROOT, "packages/shared/src/anomalyRules/catalog.yaml");
const OUT = join(ROOT, "packages/shared/src/anomalyRules/catalog.generated.ts");

// Human headers for the tier grouping comments in RULE_IDS (cosmetic; order = first appearance).
const TIER_LABELS = {
  odometer_integrity: "Tier 1 — odometer integrity",
  volume_capacity: "Tier 2 — volume vs capacity",
  efficiency: "Tier 3 — efficiency",
  behavioral: "Tier 4 — behavioral",
  reefer: "Tier A — reefer (trailer refrigeration) fuel integrity (reefer/ULSR events only)",
};

function fail(msg) {
  console.error(`✗ gen-rule-catalog: ${msg}`);
  process.exit(1);
}

// ── strict mini-YAML reader (restricted subset: `rules:` → list of maps of single-line scalars) ──────
function scalar(v) {
  const t = v.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+$/.test(t)) return Number(t);
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}
function parseCatalog(text) {
  const rules = [];
  let cur = null;
  let inRules = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue; // blank / comment
    if (/^rules:\s*$/.test(line)) { inRules = true; continue; }
    if (!inRules) continue;
    let m;
    if ((m = line.match(/^\s*-\s+([a-z_]+):\s*(.*)$/))) {
      cur = {};
      rules.push(cur);
      cur[m[1]] = scalar(m[2]);
    } else if ((m = line.match(/^\s{4,}([a-z_]+):\s*(.*)$/))) {
      if (!cur) fail(`key before first list item: ${line}`);
      cur[m[1]] = scalar(m[2]);
    } else {
      fail(`unparseable line (restricted YAML subset): ${JSON.stringify(line)}`);
    }
  }
  return rules;
}

const rules = parseCatalog(readFileSync(CATALOG, "utf8"));
if (rules.length === 0) fail("catalog.yaml has no rules");

// ── validate ──────────────────────────────────────────────────────────────────────────────────────
const seen = new Set();
for (const r of rules) {
  if (typeof r.id !== "string" || !/^[a-z][a-z0-9_]*$/.test(r.id)) fail(`bad id: ${JSON.stringify(r.id)}`);
  if (seen.has(r.id)) fail(`duplicate id: ${r.id}`);
  seen.add(r.id);
  if (typeof r.label !== "string" || !r.label.trim()) fail(`${r.id}: missing label`);
  if (typeof r.axis !== "string" || !r.axis.trim()) fail(`${r.id}: missing axis`);
  if (typeof r.weight !== "number" || r.weight < 0 || r.weight > 100) fail(`${r.id}: weight must be 0–100`);
  if (!TIER_LABELS[r.tier]) fail(`${r.id}: unknown tier '${r.tier}'`);
  if (r.suppressed !== undefined && typeof r.suppressed !== "boolean") fail(`${r.id}: suppressed must be boolean`);
}

// ── derive ────────────────────────────────────────────────────────────────────────────────────────
const axes = [...new Set(rules.map((r) => r.axis))]; // first-appearance order
const suppressed = rules.filter((r) => r.suppressed === true).map((r) => r.id);
const q = (s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// ── emit ──────────────────────────────────────────────────────────────────────────────────────────
const L = [];
L.push("// ────────────────────────────────────────────────────────────────────────────────────────────");
L.push("// GENERATED FILE — DO NOT EDIT BY HAND.");
L.push("// Source of truth: catalog.yaml · Regenerate: `pnpm gen:rules` · CI fails on drift.");
L.push("// ────────────────────────────────────────────────────────────────────────────────────────────");
L.push("");

L.push("export const RULE_IDS = [");
let curTier = null;
for (const r of rules) {
  if (r.tier !== curTier) {
    L.push(`  // ${TIER_LABELS[r.tier]}`);
    curTier = r.tier;
  }
  L.push(`  ${q(r.id)},`);
}
L.push("] as const;");
L.push("");
L.push("export type RuleId = (typeof RULE_IDS)[number];");
L.push("");

L.push(`export type SignalAxis = ${axes.map(q).join(" | ")};`);
L.push("");

L.push("/** Human-readable label for every rule ID. Used wherever the raw snake_case key would be shown. */");
L.push("export const RULE_LABELS: Record<RuleId, string> = {");
for (const r of rules) L.push(`  ${r.id}: ${q(r.label)},`);
L.push("};");
L.push("");

L.push("/** Rules the product never raises as anomalies (data-quality facts stay on the transaction). */");
L.push("export const SUPPRESSED_RULE_IDS: readonly RuleId[] = [");
for (const id of suppressed) L.push(`  ${q(id)},`);
L.push("] as const;");
L.push("");

L.push("/** Correlation axis + directness-of-theft weight (0–100) per rule for the multi-signal model. */");
L.push("export const SIGNAL_META: Record<RuleId, { axis: SignalAxis; weight: number }> = {");
for (const r of rules) L.push(`  ${r.id}: { axis: ${q(r.axis)}, weight: ${r.weight} },`);
L.push("};");
L.push("");

writeFileSync(OUT, L.join("\n"));
console.log(`✓ gen-rule-catalog: wrote ${rules.length} rules → catalog.generated.ts`);

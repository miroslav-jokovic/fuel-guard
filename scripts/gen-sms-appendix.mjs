#!/usr/bin/env node
/**
 * Generates `packages/sms-engine/datasets/appendix-a-3.21.generated.json` — every violation SMS scores,
 * with its BASIC, group, severity weight and DSMS flag — from FMCSA's own workbook,
 * `docs/regulatory/fmcsa/SMS_AppendixA_ViolationsList.xlsx` (INSPECTION-CHALLENGE-PLAN IC3, D-IC5).
 *
 * ── WHY GENERATED, AND WHY IT CAN RUN IN CI ───────────────────────────────────────────────────
 * The workbook is committed (a U.S. Government work, hashed in SOURCES.md), so unlike FleetPal's
 * spec this script runs in every checkout. `lint:codegen` chains it with `--check`, so a JSON that
 * drifts from the workbook — a hand edit, or a new edition dropped in without regenerating — fails
 * the build. The sha256 of the workbook is written into the output and must equal SOURCES.md's.
 *
 * ── WHAT IS KEPT ───────────────────────────────────────────────────────────────────────────────
 * The six BASIC sheets only, the code as printed (trimmed: three rows carry a leading space) and its
 * normalised form `norm` — uppercased, every non-alphanumeric removed — because FMCSA's own SMS input file writes
 * `393.75A3-TAOL` as `39375A3TAOL` and the inspection file writes it with punctuation. Measured
 * 2026-10-11: 2,412 rows, no two share a `norm`. (Not called `key`: gitleaks' generic-api-key rule reads
 * `"key":"39375A3TAOL"` as a credential, 120 times, and the fix is the name, not an allowlist.) Descriptions are left out: nothing computes on them,
 * and they are 70% of the bytes. A new edition is a new file beside this one, never an edit.
 *
 * Usage:  node scripts/gen-sms-appendix.mjs [--check]
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "docs/regulatory/fmcsa/SMS_AppendixA_ViolationsList.xlsx");
const OUT = join(ROOT, "packages/sms-engine/datasets/appendix-a-3.21.generated.json");
const EDITION = { version: "3.21", snapshot: "2026-05-15", source: "docs/regulatory/fmcsa/SMS_AppendixA_ViolationsList.xlsx" };
// Sheet name → the BASIC id the engine uses (`SMS_BASICS`, packages/sms-engine/src/basics.ts).
const SHEETS = {
  "Unsafe Driving": "unsafe_driving",
  "Hours-of-Service Compliance": "hos_compliance",
  "Vehicle Maintenance": "vehicle_maintenance",
  "Controlled Sub-Alcohol": "controlled_substances_alcohol",
  "Hazardous Materials Compliance": "hm_compliance",
  "Driver Fitness": "driver_fitness",
};

// exceljs is the API's dependency; resolved from there rather than added to the root.
const ExcelJS = createRequire(join(ROOT, "apps/api/package.json"))("exceljs");
const bytes = readFileSync(SRC);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const sources = readFileSync(join(ROOT, "docs/regulatory/fmcsa/SOURCES.md"), "utf8");
if (!sources.includes(sha256)) {
  console.error(`✗ ${EDITION.source} has sha256 ${sha256}, which SOURCES.md does not list`);
  process.exit(1);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.load(bytes);
const text = (v) => (v == null ? "" : typeof v === "object" && "richText" in v ? v.richText.map((t) => t.text).join("") : String(v)).trim();
const rows = [];
for (const [sheet, basic] of Object.entries(SHEETS)) {
  const ws = wb.getWorksheet(sheet);
  if (!ws) throw new Error(`sheet "${sheet}" is missing from the workbook`);
  const header = ws.getRow(3).values.slice(1).map(text);
  if (header[0] !== "Section" || !/Severity Weight/.test(header[3]) || !/DSMS/.test(header[4])) {
    throw new Error(`sheet "${sheet}": unexpected header ${JSON.stringify(header)}`);
  }
  ws.eachRow((row, n) => {
    if (n <= 3) return;
    const code = text(row.getCell(1).value);
    if (!code) return;
    const severity = Number(text(row.getCell(4).value));
    if (!Number.isInteger(severity) || severity < 0 || severity > 10) throw new Error(`${sheet} ${code}: severity ${row.getCell(4).value}`);
    const dsms = text(row.getCell(5).value).toUpperCase();
    if (dsms !== "Y" && dsms !== "N") throw new Error(`${sheet} ${code}: DSMS flag ${dsms}`);
    rows.push({ code, norm: code.toUpperCase().replace(/[^A-Z0-9]/g, ""), basic, group: text(row.getCell(3).value), severity, dsms: dsms === "Y" });
  });
}
const keys = new Set();
for (const r of rows) {
  if (keys.has(r.norm)) throw new Error(`two rows share the normalised code ${r.norm}`);
  keys.add(r.norm);
}
rows.sort((a, b) => (a.norm < b.norm ? -1 : a.norm > b.norm ? 1 : 0));
const out = JSON.stringify({ edition: { ...EDITION, sha256 }, violations: rows }, null, 0).replace(/\},\{/g, "},\n{") + "\n";

if (process.argv.includes("--check")) {
  if (!existsSync(OUT) || readFileSync(OUT, "utf8") !== out) {
    console.error(`✗ ${OUT} differs from what ${EDITION.source} generates — run: node scripts/gen-sms-appendix.mjs`);
    process.exit(1);
  }
  console.log(`✓ SMS Appendix A ${EDITION.version}: ${rows.length} violations match the workbook`);
} else {
  writeFileSync(OUT, out);
  console.log(`✓ wrote ${OUT} — ${rows.length} violations`);
}

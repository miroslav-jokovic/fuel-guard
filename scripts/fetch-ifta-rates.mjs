#!/usr/bin/env node
/**
 * Cut a versioned diesel-tax dataset from the IFTA, Inc. Tax Rate Matrix (F10, D-FX11).
 *
 * ── WHY A GENERATOR AND NOT A TYPED TABLE ────────────────────────────────────────────────────────
 * Sixty jurisdictions × four decimal places × one quarter is 240 digits, and a single transposed one
 * is a wrong dollar figure on a compliance report that a carrier forwards to their controller. There
 * is no gate that can catch it, because a plausible tax rate looks exactly like the right one. So the
 * table is MINTED from the source page and never hand-edited — the same reason F4's golden corpus is
 * generated rather than copied, and the same reason `packages/hazmat-data` mints its datasets from
 * `import/buildDataset.ts` instead of letting anyone type into `datasets/*.json`.
 *
 * ── THE RELEASE GATE, WHICH IS FREE ──────────────────────────────────────────────────────────────
 * Every quarter's matrix marks each CHANGED rate with a tooltip naming the previous quarter and the
 * previous rate. That is an independent statement of the earlier quarter's number, published beside
 * the new one — so fetching N consecutive quarters gives N-1 quarters of second-source verification
 * for nothing: the tooltip's "Previous Rate" must equal what the previous quarter's own page
 * published, and every rate NOT marked as changed must be identical across the two. The script
 * refuses to write on any disagreement (`--force` overrides, and prints why it should not be used).
 * This is `packages/hazmat-data`'s step-4 diff in miniature; it cannot catch an error IFTA itself
 * published, which is why the dataset records the capture date and the finality flag rather than
 * claiming to be the law.
 *
 * ── WHAT IS DELIBERATELY NOT AUTOMATED ───────────────────────────────────────────────────────────
 * Nothing runs this in CI. The sandbox and CI cannot reach iftach.org, and a tax table that silently
 * re-cuts itself on a schedule is a table whose numbers nobody has read. A quarter is cut by a person
 * who then reads the diff — quarterly, on the first business day after the matrix goes final.
 *
 * Usage:  node scripts/fetch-ifta-rates.mjs 1Q2026 2Q2026 3Q2026
 *         node scripts/fetch-ifta-rates.mjs --check 1Q2026 2Q2026 3Q2026   (verify, write nothing)
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "packages/shared/src/fuelTax/rates2026.ts");
const MATRIX = "https://www.iftach.org/taxmatrix4/Taxmatrix.php";

/**
 * Column 4 of the fuel select is "Special Diesel". The matrix renders one `<td>` per fuel in that
 * select's order after two fixed cells (the jurisdiction and the U.S./Can. label), so diesel is index
 * 1 of the value cells. Pinned as a constant because a column shift would move every rate silently.
 */
const DIESEL_COLUMN = 1;

/** `#26`-style footnote markers and the "Copy Row" button text the label cell also carries. */
const LABEL_NOISE = /\s*#\d+\s*|\s*Copy Row\s*/g;

/**
 * The ten Canadian member jurisdictions, EXCLUDED from the dataset — and the cross-check found the
 * reason rather than being told it.
 *
 * The first run flagged all ten as changing between every pair of quarters while IFTA marked none of
 * them as a rate change. They are not rate changes: a Canadian jurisdiction sets its rate in Canadian
 * cents per LITRE and the matrix's U.S. column is that rate converted at the quarter's Federal
 * Reserve exchange rate. Alberta's $0.13/litre has not moved since 2024-04-01, and 0.13 × 3.785411784
 * × 0.7151 = 0.3519 — the 3Q2026 U.S. figure, to four decimals.
 *
 * So a Canadian U.S.-column rate is a derived quantity that drifts with FX between captures, which is
 * a different kind of fact from a legislated per-gallon rate and must not share a column with one.
 * Excluding them costs nothing measurable: production carries 11,373 fills across 46 jurisdictions and
 * not one is Canadian (measured 2026-08-26). A Canadian fill therefore answers "unknown" — which is
 * the honest answer and never zero — until somebody needs it and stores the litre rate and the date's
 * exchange rate as the two separate facts they are.
 */
const CANADIAN = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "ON", "PE", "QC", "SK"]);

async function fetchQuarter(quarter) {
  const url = `${MATRIX}?QY=${quarter}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${quarter}: HTTP ${res.status} from ${url}`);
  return parseMatrix(await res.text(), quarter);
}

function parseMatrix(html, quarter) {
  const rows = [...html.matchAll(/<tr id="row-([A-Z]{2})"[^>]*>([\s\S]*?)<\/tr>/g)];
  if (rows.length < 50) throw new Error(`${quarter}: parsed ${rows.length} jurisdiction rows, expected ~60`);
  const rates = new Map();
  const changes = new Map();
  for (const [, code, body] of rows) {
    if (CANADIAN.has(code)) continue;
    const cells = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 3) continue;
    const label = decode(cells[0]).replace(LABEL_NOISE, " ").replace(/\s+/g, " ").trim();
    const cell = cells[2 + DIESEL_COLUMN];
    if (cell == null) continue;
    // A jurisdiction with no rate for a fuel renders a spacer image, which is NOT a zero: Oregon taxes
    // heavy trucks by the mile and levies no diesel tax at the pump at all, and the two facts must not
    // be stored the same way (D-FX7 — unmeasured is never zero).
    const value = /(\d+\.\d{4})/.exec(cell);
    const rate = value ? Number(value[1]) : null;
    // Surcharge rows and Indiana's mid-quarter split-rate row share the jurisdiction's `id`. Keyed
    // apart because a surcharge is levied on the RETURN over miles burned, never at the pump.
    const key = /\(Surcharge\)/i.test(label) ? `${code}.surcharge`
      : /\d{2}\/\d{2}\/\d{2}/.test(label) ? `${code}.${/(\d{2}\/\d{2}\/\d{2})/.exec(label)[1]}`
      : code;
    if (!rates.has(key)) rates.set(key, rate);
    const prev = /Previous Quarter:\s*([1-4]Q\d{4})[\s\S]*?Previous Rate:\s*(\d+\.\d{4})/.exec(decode(cell));
    if (prev && !changes.has(key)) changes.set(key, { quarter: prev[1], rate: Number(prev[2]) });
  }
  const plain = decode(html);
  const notFinal = /This matrix is not final until\s*([A-Za-z]+ \d{1,2}, \d{4})/.exec(plain);
  return { quarter, rates, changes, notFinalUntil: notFinal ? notFinal[1] : null };
}

function decode(fragment) {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

/**
 * The cross-quarter gate. For each consecutive pair, every jurisdiction must either be marked changed
 * with a "Previous Rate" equal to what the earlier quarter published, or be unmarked and identical.
 */
function crossCheck(earlier, later) {
  const problems = [];
  for (const [key, rate] of later.rates) {
    if (!earlier.rates.has(key)) continue;
    const before = earlier.rates.get(key);
    const claim = later.changes.get(key);
    if (claim && claim.quarter !== earlier.quarter) continue;
    if (claim) {
      if (claim.rate !== before) {
        problems.push(`${key}: ${later.quarter} says ${earlier.quarter} was ${claim.rate}, that page published ${before}`);
      }
    } else if (rate !== before) {
      problems.push(`${key}: ${before} → ${rate} between ${earlier.quarter} and ${later.quarter}, unmarked as a change`);
    }
  }
  return problems;
}

function emit(quarters, capturedOn) {
  const codes = [...new Set(quarters.flatMap((q) => [...q.rates.keys()]))]
    .filter((k) => !k.includes("."))
    .sort();
  const body = quarters
    .map((q) => {
      const entries = codes.map((c) => `${c}: ${fmt(q.rates.get(c))}`);
      const packed = [];
      for (let i = 0; i < entries.length; i += 6) packed.push(`  ${entries.slice(i, i + 6).join(", ")},`);
      const surcharges = [...q.rates.entries()]
        .filter(([k, v]) => k.endsWith(".surcharge") && v != null)
        .map(([k, v]) => `${k.slice(0, 2)}: ${v.toFixed(4)}`);
      return { q, packed: packed.join("\n"), surcharges };
    });
  const lines = [header(quarters, capturedOn)];
  for (const { q, packed, surcharges } of body) {
    const id = q.quarter;
    lines.push(`const PUMP_${id} = {\n${packed}\n} as const satisfies Record<string, number | null>;\n`);
    lines.push(`const SURCHARGE_${id} = { ${surcharges.join(", ")} } as const satisfies Record<string, number>;\n`);
  }
  lines.push(`export const DIESEL_TAX_QUARTERS: readonly DieselTaxQuarter[] = [`);
  for (const { q } of body) {
    const [n, year] = [q.quarter[0], q.quarter.slice(2)];
    const from = `${year}-${String((Number(n) - 1) * 3 + 1).padStart(2, "0")}-01`;
    const to = { 1: `${year}-03-31`, 2: `${year}-06-30`, 3: `${year}-09-30`, 4: `${year}-12-31` }[n];
    lines.push(`  {`);
    lines.push(`    version: ${JSON.stringify(q.quarter)},`);
    lines.push(`    effectiveFrom: ${JSON.stringify(from)},`);
    lines.push(`    effectiveTo: ${JSON.stringify(to)},`);
    lines.push(`    final: ${q.notFinalUntil == null},`);
    lines.push(`    notFinalUntil: ${JSON.stringify(q.notFinalUntil)},`);
    lines.push(`    capturedOn: ${JSON.stringify(capturedOn)},`);
    lines.push(`    pumpPerGal: PUMP_${q.quarter},`);
    lines.push(`    returnSurchargePerGal: SURCHARGE_${q.quarter},`);
    lines.push(`  },`);
  }
  lines.push(`];`);
  return `${lines.join("\n")}\n`;
}

const fmt = (v) => (v == null ? "null" : v.toFixed(4));

function header(quarters, capturedOn) {
  return `/**
 * Diesel tax rates per jurisdiction, by IFTA quarter — MINTED, NEVER HAND-EDITED.
 *
 * Cut by \`node scripts/fetch-ifta-rates.mjs ${quarters.map((q) => q.quarter).join(" ")}\` on ${capturedOn} from the
 * IFTA, Inc. Tax Rate Matrix (${MATRIX}), Special Diesel column,
 * U.S. cents-per-gallon. That script's header explains the cross-quarter gate it passed to be written.
 *
 * Read \`taxTable.ts\` before using any number here: \`pumpPerGal\` is what a gallon carries AT THE PUMP
 * in that jurisdiction and \`returnSurchargePerGal\` is emphatically not — a surcharge is billed on the
 * quarterly IFTA return over the miles BURNED there, so it belongs to a jurisdiction this product
 * cannot yet see (Q-FX4). A \`null\` rate is unknown or not levied per gallon and is never zero.
 */
import type { DieselTaxQuarter } from "./taxTable.js";
`;
}

const args = process.argv.slice(2);
const check = args.includes("--check");
const force = args.includes("--force");
const wanted = args.filter((a) => /^[1-4]Q\d{4}$/.test(a));
if (wanted.length === 0) {
  console.error("usage: node scripts/fetch-ifta-rates.mjs [--check] [--force] 1Q2026 2Q2026 …");
  process.exit(2);
}

const quarters = [];
for (const q of wanted) {
  process.stdout.write(`fetching ${q} … `);
  const parsed = await fetchQuarter(q);
  console.log(`${parsed.rates.size} U.S. rows${parsed.notFinalUntil ? ` (NOT FINAL until ${parsed.notFinalUntil})` : ""}`);
  quarters.push(parsed);
}

let failed = 0;
for (let i = 1; i < quarters.length; i += 1) {
  const problems = crossCheck(quarters[i - 1], quarters[i]);
  failed += problems.length;
  console.log(
    problems.length === 0
      ? `cross-check ${quarters[i - 1].quarter} → ${quarters[i].quarter}: CLEAN`
      : `cross-check ${quarters[i - 1].quarter} → ${quarters[i].quarter}: ${problems.length} disagreement(s)\n  ${problems.join("\n  ")}`,
  );
}
if (failed > 0 && !force) {
  console.error(
    "\nRefusing to write. A disagreement is a parse bug or a mid-quarter revision; find out which, " +
      "and only then re-run with --force and record the reason in FUEL-SPEND-RELIABILITY-PLAN.md.",
  );
  process.exit(1);
}

const capturedOn = new Date().toISOString().slice(0, 10);
const source = emit(quarters, capturedOn);
if (check) {
  console.log(`\n--check: parsed cleanly, ${source.split("\n").length} lines would be written to ${OUT}`);
} else {
  writeFileSync(OUT, source);
  console.log(`\nwrote ${OUT}`);
}

#!/usr/bin/env node
/**
 * Fitness function — a date is SHOWN one way, `MM/DD/YYYY`, from ONE definition.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────────
 * `docs/DESIGN-SYSTEM-CONTRACT.md` has pinned date display to `MM/dd/yyyy` since D-DS17 (2026-08-31).
 * Only the two pickers ever honoured it, because the contract stated the rule for a COMPONENT rather
 * than for the product, and nothing could see the difference. An audit on 2026-09-20 counted what had
 * grown in the gap:
 *
 *   - 13 near-duplicate `fmtDate` / `formatDate` definitions across `apps/web` and `apps/admin`
 *   - ~30 inline `toLocaleDateString` calls, most passing `undefined` as the locale — which hands the
 *     ordering to the VIEWER's browser, giving `2026/09/20` on `ja` or `zh` and `20/09/2026` on `en-GB`
 *   - raw ISO reaching the screen in a dozen places, including `packetDraw.ts`'s `date()`, which
 *     printed `2026-09-20` into every date box of the 22-page federal DOT application packet
 *
 * Four shapes for one fact, none reviewed as a duplicate, each a reasonable local decision. That is
 * the failure CLAUDE.md's no-workarounds rule names — "a value copied instead of derived" — and the
 * ruling that fixed it on 2026-09-20 will rot back exactly as D-DS17 did unless something watches.
 *
 * ⚠ It also guards a SEMANTIC trap, not only a cosmetic one. `formatDisplayDate` reads a calendar day
 * from its characters; a hand-rolled `new Date("2026-09-20").toLocaleDateString(...)` parses UTC
 * midnight and renders it locally, printing **Sep 19** in every US timezone. Four of the 13 copies
 * shipped with that bug.
 *
 * ── WHAT IT LOOKS FOR ─────────────────────────────────────────────────────────────────────────────
 * One signature: a `toLocale*String` call that formats a DATE — i.e. carries a date-bearing option
 * (`day`, `weekday`, `dateStyle`, `year`, `month`) or is a bare `toLocaleDateString()` /
 * `toLocaleTimeString()` — outside the files allowed to carry one.
 *
 * Number formatting (`n.toLocaleString()`, `{ style: "currency" }`) is NOT this gate's business and is
 * skipped explicitly, because ~100 legitimate call sites use it and a gate that cries about them is a
 * gate people learn to ignore.
 *
 * ── THE BLIND SPOT, NAMED RATHER THAN LEFT TO BE DISCOVERED ───────────────────────────────────────
 * Raw ISO reaching a template — `{{ row.expires_at }}` — is the fault that started this and is NOT
 * detectable here: the gate would have to know that `expires_at` holds a date, and a name is not a
 * type. Eleven such sites were fixed by hand on 2026-09-20. A twelfth would pass this gate silently.
 * Closing it needs the column types, which is a different and bigger tool than this one.
 *
 * `--self-test` proves the detector fires and that the skips do not swallow it — a gate that cannot
 * fail is not a gate.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SCAN = ["apps/web/src", "apps/admin/src", "packages/shared/src", "packages/ui/src", "apps/api/src"];

/**
 * The files allowed to format a date themselves, each with the question it answers that
 * `formatDisplayDate` does not. A new entry needs a reason, not just a path.
 */
const CARVE_OUTS = new Map([
  // `displayDate.ts` itself needs no entry: it assembles the string from Y/M/D parts and never calls
  // `toLocale*` at all, which is the property that makes this gate a simple ban rather than a
  // judgement about arguments.
  // A MONTH is not a date. "July 2026" is how a printed statement heads its page, and MM/YYYY would
  // be a worse answer to a different question.
  ["apps/web/src/features/accounting/fleetProvenance.ts", "monthName — a month heading, not a date"],
  ["apps/web/src/features/apply/employmentProgress.ts", "monthName — a month heading, not a date"],
  ["apps/web/src/lib/chartTheme.ts", "fmtMonth — a month axis label, not a date"],
  ["apps/web/src/features/reconcile/BuyDisciplineTab.vue", "a month heading, not a date"],
  ["apps/web/src/pages/DataSyncPage.vue", "a month heading, not a date"],

  // A clock that is deliberately NOT the reader's.
  ["apps/web/src/features/anomalies/AnomalyAudit.vue", "renders in an explicitly chosen display timezone"],

  // Weekday and time-of-day are not dates, and have no MM/DD/YYYY form.
  ["apps/web/src/components/ui/TimelineRail.vue", "weekday prefix beside a formatDisplayDate day"],
  ["apps/web/src/pages/MessagesPage.vue", "a time of day for today's messages"],
]);

const DATE_OPTION = /\b(dateStyle|weekday|day|month|year)\s*:/;
const CALL = /\.toLocale(Date|Time)?String\s*\(/;

/**
 * A bare `.toLocaleString()` on something date-shaped. This is the worst of the lot and the easiest to
 * miss: `new Date(x).toLocaleString()` renders `9/20/2026, 2:03:00 PM` on an `en-US` browser and
 * `2026/9/20 14:03:00` on a `zh` one, with nothing in the source hinting that the ordering is the
 * viewer's to choose. It cannot be banned outright, because `n.toLocaleString()` on a NUMBER is
 * correct and appears at ~100 call sites, so the receiver has to look like a date.
 */
const BARE_DATEY = /(new Date\([^)]*\)|\b\w*(?:At|Date|_at|_on|Stamp)\b)\s*\.toLocaleString\s*\(\s*\)/;

/** Number formatting, which this gate has no opinion about. */
const NUMERIC = /\b(style\s*:\s*"(currency|percent|decimal|unit)"|maximumFractionDigits|minimumFractionDigits)\b/;

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) { if (e !== "node_modules" && e !== "dist") walk(p, out); }
    else if (/\.(ts|tsx|vue)$/.test(e)) out.push(p);
  }
  return out;
}

/**
 * A call formats a DATE when it is a bare `toLocaleDateString()` / `toLocaleTimeString()` — whose
 * default output is entirely the viewer's locale — or carries a date-bearing option. The option may
 * sit on a later line, so the window is the call plus the four lines after it.
 */
function inspect(text, rel) {
  const lines = text.split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!CALL.test(line)) continue;
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue; // a comment describing the trap is not the trap
    const window = lines.slice(i, i + 5).join("\n");
    const bare = /\.toLocale(Date|Time)String\s*\(\s*\)/.test(line) || BARE_DATEY.test(line);
    if (!bare && !DATE_OPTION.test(window)) continue;
    if (!bare && NUMERIC.test(window) && !DATE_OPTION.test(window)) continue;
    hits.push({ rel, line: i + 1, text: line.trim().slice(0, 110) });
  }
  return hits;
}

function scan() {
  const hits = [];
  for (const dir of SCAN) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, file);
      if (/\.test\.(ts|tsx)$/.test(rel)) continue; // a test may assert on any shape it likes
      hits.push(...inspect(readFileSync(file, "utf8"), rel));
    }
  }
  return hits;
}

if (process.argv.includes("--self-test")) {
  const cases = [
    ['const d = x.toLocaleDateString(undefined, { month: "short", day: "numeric" });', true, "date options"],
    ["const d = x.toLocaleDateString();", true, "bare date call"],
    ["const d = x.toLocaleString(undefined, { dateStyle: \"medium\" });", true, "dateStyle"],
    ['const n = x.toLocaleString("en-US", { style: "currency", currency: "USD" });', false, "currency"],
    ["const n = Math.round(x).toLocaleString();", false, "plain number"],
    ['// x.toLocaleDateString(undefined, { day: "numeric" }) is the trap this file bans', false, "comment"],
    ["const w = new Date(iso).toLocaleString();", true, "bare toLocaleString on a Date"],
    ["const w = row.created_at.toLocaleString();", true, "bare toLocaleString on a date-named field"],
    ["const n = totalPrices.toLocaleString();", false, "bare toLocaleString on a number"],
  ];
  let failed = 0;
  for (const [src, shouldFire, id] of cases) {
    const fired = inspect(src, "self-test.ts").length > 0;
    if (fired !== shouldFire) {
      console.error(`✗ self-test: "${id}" ${fired ? "fired and should not" : "did not fire and should"}`);
      failed += 1;
    }
  }
  if (failed > 0) process.exit(1);
  console.log(`✓ date-format self-test — ${cases.length} cases behave (detector fires, numbers and comments do not).`);
  process.exit(0);
}

const hits = scan();
const offenders = hits.filter((h) => !CARVE_OUTS.has(h.rel));
const stale = [...CARVE_OUTS.keys()].filter((f) => !hits.some((h) => h.rel === f));

if (stale.length > 0) {
  console.error(`✗ ${stale.length} carve-out(s) no longer format a date. Ratchet down — remove them:`);
  for (const f of stale) console.error(`   ${f}  (${CARVE_OUTS.get(f)})`);
  process.exit(1);
}

if (offenders.length > 0) {
  console.error(`✗ ${offenders.length} date(s) formatted outside packages/shared/src/displayDate.ts:`);
  for (const o of offenders) console.error(`   ${o.rel}:${o.line}  ${o.text}`);
  console.error(
    "\n  A date is shown as MM/DD/YYYY, from one definition (D-DS17, extended to the whole product" +
      "\n  2026-09-20). Use formatDisplayDate / formatDisplayDateTime / formatDisplayDayShort from" +
      "\n  @silvicom/shared — or, in apps/web, formatDate / formatDateTime from @/lib/format." +
      "\n  If this is genuinely a DIFFERENT question — a month heading, a time of day, a clock in" +
      "\n  somebody else's timezone — add it to CARVE_OUTS with the question it answers.",
  );
  process.exit(1);
}

console.log(
  `✓ date format ok — 1 definition, ${CARVE_OUTS.size} carve-outs answering different questions.`,
);

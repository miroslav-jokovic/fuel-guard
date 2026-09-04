#!/usr/bin/env node
/**
 * Fitness function — fleet MPG is computed in ONE place (D-MPG1,
 * docs/plans/fuel/FLEET-MPG-CONSOLIDATION-PLAN.md M6).
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 * On 2026-09-04 the owner noticed fleet MPG read differently on different pages. It did: for the
 * week of 2026-08-25 the Fuel log showed 6.82 and the Spend trend 7.55, a 10.7% spread on the same
 * fleet and the same week. Neither page was buggy. There were three definitions of the number and
 * five implementations of them, and **nothing in the system compared any two**, so the divergence
 * could only ever be found by a person looking at two tabs.
 *
 * Four of those five were the SAME definition written four times. None of them was reviewed as a
 * duplicate, because each was a reasonable local decision — which is precisely the failure mode
 * CLAUDE.md's no-workarounds rule describes: individually cheap, only visible in aggregate. A ruling
 * alone does not survive that. A gate does.
 *
 * ── WHAT IT LOOKS FOR ───────────────────────────────────────────────────────────────────────────
 * Three arithmetic signatures, on one line, outside the one file allowed to carry them:
 *
 *   A. **The weighted mean** — an mpg accumulator built by multiplication: `mpgWeighted += mpg *
 *      gallons`, `sum + computed_mpg * gallons`, `sum(computed_mpg * gallons)`. That is a per-fill
 *      ratio being multiplied back out — both the duplicated definition and the source of its
 *      1.31–2.41% low bias, because the multiplication uses `gallons` while `computed_mpg` divided
 *      by `gallons + intermediateGallons`.
 *
 *      ACCUMULATION is the signature, deliberately. `impliedMiles = gallons * mpg` SPENDS an MPG it
 *      was handed and is not a second definition; an earlier draft of this gate could not tell the
 *      two apart and flagged seven innocent files, which is how a gate gets switched off.
 *   B. **The fleet ratio** — `miles… / …gallons`. This is the RIGHT arithmetic, which is exactly why
 *      it may only live in one place.
 *   C. **The accumulator division** — `mpg… / …mpg`, e.g. `mpgW / mpgG`, the form A's accumulators
 *      are finally divided in when neither identifier says "gallons".
 *
 * ── THE BLIND SPOT, NAMED RATHER THAN LEFT TO BE DISCOVERED ─────────────────────────────────────
 * A division routed through a helper — `ratio(milesMeasured, mpgGallons)` in `spendPeriodTotals.ts`
 * — carries no operator and is invisible here. That call is M5's target and disappears when the
 * spend report derives from `computeFleetMpg`; until then the gate does not see it. A gate that
 * pretended to catch it would be worse than one that says where it stops.
 *
 * `--self-test` proves all three detectors fire (a gate that cannot fail is not a gate).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SCAN = ["apps", "packages", "supabase/migrations"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".expo", "ios", "android", "coverage", ".git"]);
const EXT = /\.(ts|tsx|vue|mjs|sql)$/;

/** The one home. Everything else either derives from it or is pinned below with a reason. */
const HOME = "packages/shared/src/fuelSpend/fleetEfficiency.ts";

/**
 * PERMANENT carve-outs — figures that are legitimately not the fleet's operating MPG. These are not
 * debt and they do not shrink; each says what different question it answers.
 */
const CARVE_OUTS = new Map([
  [
    "packages/shared/src/ifta/position.ts",
    "D-MPG2: a TAX figure over taxable jurisdiction miles and purchased gallons. It answers a filing, not an efficiency, and forcing it to agree with the operating number would corrupt a return to tidy a dashboard.",
  ],
  [
    "packages/shared/src/ifta/tieOut.ts",
    "D-MPG2's family: a PLAUSIBILITY test, not a reported figure. `impliedMpg` asks whether the miles could have been driven on the fuel recorded, against IFTA_MPG_BAND.max, and is compared to a threshold rather than shown as the fleet's efficiency. Replacing it with the operating MPG would make the tie-out check its input against itself.",
  ],
  [
    "packages/shared/src/anomalyRules/helpers.ts",
    "computedMpg is ONE FILL's ratio — the input an anomaly rule judges, never a fleet figure. D-MPG3's reasoning: a per-subject MPG is a different number and says so.",
  ],
  [
    "supabase/migrations/0290_fuel_range_miles_inputs.sql",
    "An APPLIED migration, which may never be edited. Its `sum(computed_mpg * gallons)` returns a measurement for TypeScript to judge (FUEL-T3b); M4 retires its only consumer, and the function outlives it harmlessly.",
  ],
  [
    "supabase/migrations/0312_fuel_range_vehicle_lists.sql",
    "0290's function, re-created to take a truck LIST (FUEL-P1) — a signature change, which Postgres can only express as a drop and a create, so the whole body including that `sum` comes with it. Not a sixth implementation: it is the same measurement, byte for byte, and the division that would make it a fleet MPG still happens in TypeScript. Naming it here rather than letting the gate go quiet is the point of the list.",
  ],
]);

/**
 * SHRINK-ONLY waivers — the four duplicate implementations the plan's M4 and M5 retire. Each names
 * the step that removes it. Adding to this list needs a justification in the same commit; the
 * check-file-size.mjs convention.
 */
const WAIVERS = new Map([
  ["packages/shared/src/dashboard.ts", "M4 — the Dashboard tile and the MPG trend move onto GET /api/fueling/fleet-mpg; the trend becomes weekly under D-MPG6."],
  ["apps/web/src/features/fuel/useFuelLog.ts", "M4 — the Fuel log's Fills tab reads the endpoint; `fuel_range_miles_inputs` keeps returning the measurements, only the division moves."],
  ["apps/api/src/modules/insights/askData.ts", "M4 — the assistant's `fleet_mpg` and its daily series read the endpoint (the series at week grain, D-MPG6)."],
  ["apps/web/src/pages/DriverDetailPage.vue", "M4 — per-driver MPG moves onto the shared arithmetic and its label gains the scope (D-MPG3)."],
]);

const RULES = [
  {
    id: "weighted-mean",
    // ACCUMULATION is the signature, not merely mpg and gallons on one line. `mpgWeighted += mpg *
    // gallons` builds a gallon-weighted mean; `impliedMiles = gallons * mpg` spends one it was given,
    // and an earlier draft of this gate flagged seven files by failing to tell those apart.
    test: (line) =>
      /\bmpg[A-Za-z_]*\s*\+=\s*[^;]*\*/i.test(line) ||
      /\b(sum|acc|total)[A-Za-z_]*\s*\+\s*[^,;]*mpg[^,;]*\*/i.test(line) ||
      /\bsum\s*\(\s*[^)]*mpg[^)]*\*/i.test(line),
    why: "an mpg value accumulated against gallons — the gallon-weighted mean, which is the definition written four times",
  },
  {
    id: "fleet-ratio",
    test: (line) => /[A-Za-z_.]*miles?[A-Za-z_]*\s*\/\s*[A-Za-z_.]*gallons?/i.test(line),
    why: "miles divided by gallons — the right arithmetic, which is exactly why it may only live in one file",
  },
  {
    id: "accumulator-division",
    test: (line) => /\bmpg[A-Za-z_]*\s*\/\s*[A-Za-z_.()]*(mpg|gal)/i.test(line),
    why: "one mpg accumulator divided by its gallons — the weighted mean's final step",
  },
];

/** Comments are not code. A line that only discusses MPG is documentation, and this repo has a lot of it. */
const stripComment = (line, ext) => {
  const s = line.replace(/^\s*(\/\/|\*|--|#).*$/, "");
  return ext === ".sql" ? s.replace(/--.*$/, "") : s.replace(/\/\/.*$/, "");
};

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (EXT.test(name)) yield p;
  }
}

function scan() {
  const hits = [];
  for (const root of SCAN) {
    for (const file of walk(join(ROOT, root))) {
      const rel = relative(ROOT, file);
      if (rel === HOME) continue;
      if (/\.test\.|\.spec\.|\.generated\./.test(rel)) continue;
      const ext = rel.slice(rel.lastIndexOf("."));
      const lines = readFileSync(file, "utf8").split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const code = stripComment(lines[i], ext);
        if (!code.trim()) continue;
        for (const rule of RULES) {
          if (rule.test(code)) {
            hits.push({ rel, line: i + 1, rule: rule.id, why: rule.why, text: lines[i].trim() });
            break;
          }
        }
      }
    }
  }
  return hits;
}

if (process.argv.includes("--self-test")) {
  const cases = [
    ["weighted-mean", "      mpgWeighted += mpg * gallons;"],
    ["fleet-ratio", "  const fleetMpg = totalMiles / totalGallons;"],
    ["accumulator-division", "      fleet_mpg: mpgG > 0 ? Math.round((mpgW / mpgG) * 10) / 10 : null,"],
  ];
  let failed = 0;
  for (const [id, line] of cases) {
    const rule = RULES.find((r) => r.id === id);
    if (!rule.test(line)) {
      console.error(`✗ self-test: detector ${id} did not fire on its own example`);
      failed += 1;
    }
  }
  // And a negative: prose about MPG must not fire, or the gate drowns in this repo's comments.
  if (RULES.some((r) => r.test(stripComment("// fleet MPG is miles / gallons", ".ts")))) {
    console.error("✗ self-test: a comment fired a detector — the gate would be unusable");
    failed += 1;
  }
  if (failed > 0) process.exit(1);
  console.log(`✓ single-mpg self-test — ${cases.length} detectors fire, comments do not.`);
  process.exit(0);
}

const hits = scan();
const offenders = hits.filter((h) => !CARVE_OUTS.has(h.rel) && !WAIVERS.has(h.rel));
const stale = [...WAIVERS.keys(), ...CARVE_OUTS.keys()].filter((f) => !hits.some((h) => h.rel === f));

if (stale.length > 0) {
  console.error(`✗ ${stale.length} pinned file(s) no longer compute an MPG. Ratchet down — remove them:`);
  for (const f of stale) console.error(`   ${f}`);
  process.exit(1);
}

if (offenders.length > 0) {
  console.error(`✗ ${offenders.length} MPG computation(s) outside ${HOME}:`);
  for (const o of offenders) {
    console.error(`   ${o.rel}:${o.line}  [${o.rule}]  ${o.text}`);
    console.error(`     → ${o.why}`);
  }
  console.error(
    `\n  Fleet MPG has ONE definition (D-MPG1). Read it from GET /api/fueling/fleet-mpg, or call` +
      `\n  computeFleetMpg from @silvicom/shared. If this figure is legitimately a DIFFERENT question` +
      `\n  — a tax figure, one fill's ratio — add it to CARVE_OUTS with the question it answers.`,
  );
  process.exit(1);
}

console.log(
  `✓ single mpg ok — 1 home, ${CARVE_OUTS.size} carve-outs answering different questions, ` +
    `${WAIVERS.size} duplicate(s) pending M4/M5.`,
);

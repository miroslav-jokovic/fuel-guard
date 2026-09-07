#!/usr/bin/env node
/**
 * Fitness function — the scanner's quality metrics are DEFINED in one place
 * (D-SCAN8, docs/plans/drivers-app/SCANNER-UPGRADE-PLAN.md Step 2.2).
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 * `packages/capture-engine/src/config.ts` said its client thresholds were "aligned to the SERVER
 * usability gate" and that "client and server must agree". They did not, and could not, and nothing
 * in the system could have noticed — because the two agreed only in a comment. Measuring the server
 * gate on 2026-09-06 found five reasons they were computing different quantities (pinned by
 * `apps/api/.../imageSemantics.test.ts`): a clamped Laplacian, a metric that moves 1.7x with
 * resolution, a luminance nobody could restate from memory, a resampler that manufactures glare, and
 * a gate reading a contrast-stretched image.
 *
 * That is the same shape as the fleet-MPG divergence `check-single-mpg.mjs` was written for, and it
 * has the same answer: one home, enforced. A ruling alone does not survive a second implementation
 * that is locally reasonable.
 *
 * ── WHAT IT LOOKS FOR ───────────────────────────────────────────────────────────────────────────
 *   A. **A luminance formula** — two or more coefficients of a known luma family in one file
 *      (Rec.709 0.2126/0.7152/0.0722, Rec.601 0.299/0.587/0.114, or the fixed-point 13933/46871/4732).
 *      Per FILE rather than per line, because the natural way to write a second one is three named
 *      constants on three lines, which a per-line rule would sail past.
 *   B. **A Laplacian** — the 3x3 kernel array, or a four-neighbour sum with the `- 4 *` centre term.
 *   C. **A near-white census** — a `>= 250` comparison on a line that also counts something. That is
 *      the glare metric's shape; a bare `>= 250` elsewhere is not interesting.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────────────────────────
 * It does NOT re-run the metric over the corpus. `packages/capture-engine/tests/expected.test.ts`
 * already recomputes every fixture and holds `expected.json` to it, in CI, through vitest. Adding a
 * second numeric check here would be a second source of truth about the same invariant — the exact
 * thing this gate exists to prevent — and it would need a type-stripping Node that CI's version does
 * not guarantee. Numbers are the test's job; SINGULARITY is this gate's.
 *
 * ── THE BLIND SPOT, NAMED RATHER THAN LEFT TO BE DISCOVERED ─────────────────────────────────────
 * This reads TypeScript. The Swift and Kotlin ports that Phase 3 adds are, by design, second and
 * third implementations of exactly this arithmetic, and they are INVISIBLE here. Nothing in this gate
 * can tell whether they compute the same thing — that is `expected.json`'s job, checked by the native
 * test suites against the committed baseline. A gate that implied otherwise would be worse than one
 * that says where it stops.
 *
 * `--self-test` proves all three detectors fire and that a comment does not trip them.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SCAN_ROOTS = ["apps", "packages"];
const SKIP = new Set(["node_modules", "dist", "build", "coverage", ".git", ".expo", "ios", "android", "vendor"]);
const EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".vue"]);

/**
 * PERMANENT carve-outs — files that carry this arithmetic on purpose and are not a second definition.
 */
const CARVE_OUTS = new Map([
  ["packages/capture-engine/src/metrics.ts", "the one home — D-SCAN8's implementation of record"],
  [
    "apps/api/src/modules/hazmat/hazmatExtraction/imageSemantics.test.ts",
    "pins sharp's OWN arithmetic as measured evidence (M1-M5); reproducing it is the entire point",
  ],
  [
    // Moved here from apps/driver/tests/theme-colors.test.ts on 2026-09-07: scripts/gen-app-icons.mjs
    // needed the same arithmetic to decide which brand-mark fills become white, and this gate is what
    // stopped it becoming a second copy. The test now imports from here, so there is still one.
    "apps/driver/scripts/srgb.mjs",
    "WCAG relative luminance for contrast ratios — a DIFFERENT question that happens to share the " +
      "Rec.709 weights. It applies the sRGB-to-linear transfer function first, so it computes " +
      "linear-light luminance where the scanner computes gamma-encoded luma; pointing it at " +
      "metrics.ts would silently change every accessibility assertion that depends on it",
  ],
]);

/**
 * SHRINK-ONLY waivers — implementations a named plan step retires. Each must name the step, and a
 * waiver whose file no longer trips a detector fails as stale, so the list can only get shorter.
 */
const WAIVERS = new Map([
  // Empty since Step 2.3 retired its only entry. `apps/api/.../image.ts` carried its own luminance,
  // Laplacian and near-white census until `usabilityGate` was moved onto the reference; the gate
  // itself is what noticed, by failing on a stale waiver the moment the duplicate went away. The list
  // can only shrink, and this is what that looks like when it works.
]);

const LUMA_FAMILIES = [
  { id: "rec709", values: ["0.2126", "0.7152", "0.0722"] },
  { id: "rec601", values: ["0.299", "0.587", "0.114"] },
  { id: "fixedPoint", values: ["13933", "46871", "4732"] },
];

const LAPLACIAN_LINE = [
  /\[\s*0\s*,\s*1\s*,\s*0\s*,\s*1\s*,\s*-\s*4\s*,\s*1\s*,\s*0\s*,\s*1\s*,\s*0\s*\]/,
  /-\s*4\s*\*\s*[A-Za-z_$][\w$]*\s*\[/,
];
const NEAR_WHITE_LINE = /(>=|>)\s*250\b/;
const COUNTING = /(\+\+|\+=\s*1\b|count|tally|total)/i;

/** Comments are prose about the arithmetic, not the arithmetic. A gate that cannot tell is unusable. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

export function detect(source) {
  const code = stripComments(source);
  const hits = [];

  for (const family of LUMA_FAMILIES) {
    const found = family.values.filter((v) => code.includes(v));
    if (found.length >= 2) hits.push({ id: "A", detail: `luma coefficients (${family.id}): ${found.join(", ")}` });
  }

  const lines = code.split("\n");
  lines.forEach((line, index) => {
    if (LAPLACIAN_LINE.some((re) => re.test(line))) {
      hits.push({ id: "B", detail: `Laplacian at line ${index + 1}` });
    }
    if (NEAR_WHITE_LINE.test(line) && COUNTING.test(line)) {
      hits.push({ id: "C", detail: `near-white census at line ${index + 1}` });
    }
  });
  return hits;
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (EXTENSIONS.has(path.slice(path.lastIndexOf(".")))) out.push(path);
  }
  return out;
}

if (process.argv.includes("--self-test")) {
  const cases = [
    { id: "A", source: "const R = 0.2126;\nconst G = 0.7152;\nconst B = 0.0722;" },
    { id: "B", source: "convolve({ kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] });" },
    { id: "C", source: "if (lum[i] >= 250) nearWhite++;" },
  ];
  for (const c of cases) {
    if (!detect(c.source).some((h) => h.id === c.id)) {
      console.error(`✗ self-test: detector ${c.id} did not fire on its own example`);
      process.exit(1);
    }
  }
  const commented = cases.map((c) => `// ${c.source.split("\n").join(" ")}`).join("\n");
  if (detect(commented).length > 0) {
    console.error("✗ self-test: a comment fired a detector — the gate would be unusable");
    process.exit(1);
  }
  console.log(`✓ scanner-parity self-test — ${cases.length} detectors fire, comments do not.`);
  process.exit(0);
}

const files = SCAN_ROOTS.flatMap((r) => walk(join(ROOT, r)));
const hits = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  const found = detect(readFileSync(file, "utf8"));
  if (found.length > 0) hits.push({ rel, found });
}

const offenders = hits.filter((h) => !CARVE_OUTS.has(h.rel) && !WAIVERS.has(h.rel));
const stale = [...WAIVERS.keys(), ...CARVE_OUTS.keys()].filter((f) => !hits.some((h) => h.rel === f));

if (offenders.length > 0) {
  console.error("✗ scanner metrics are defined in more than one place:\n");
  for (const o of offenders) {
    console.error(`  ${o.rel}`);
    for (const f of o.found) console.error(`      ${f.id}: ${f.detail}`);
  }
  console.error(
    "\n  The quality metrics have ONE definition: packages/capture-engine/src/metrics.ts (D-SCAN8).",
  );
  console.error("  Call it, or add a shrink-only waiver naming the plan step that removes the duplicate.");
  process.exit(1);
}

if (stale.length > 0) {
  console.error("✗ stale entries — these no longer carry the arithmetic they are listed for:\n");
  for (const f of stale) console.error(`  ${f}`);
  console.error("\n  Remove them. A waiver list that outlives its duplicates stops meaning anything.");
  process.exit(1);
}

console.log(
  `✓ scanner parity ok — 1 definition, ${CARVE_OUTS.size} carve-out(s) carrying it on purpose, ` +
    `${WAIVERS.size} duplicate(s) pending their plan step.`,
);

#!/usr/bin/env node
/**
 * Fitness function — the capability decisions stay decided (R9; D-ROS2, D-ROS7, D-ROS11).
 *
 * Three rules from `docs/plans/roster/DRIVER-ROSTER-PLAN.md`, each of which was expensive to reach
 * and is cheap to lose:
 *
 *  1. `canManageFleet` is gone (D-ROS7). ONE boolean stood in for an eleven-section × eight-role
 *     matrix, and every workaround that plan removed was downstream of it. The web asks
 *     `session.can(section)` now.
 *  2. `requiresManage` NAMES a section (D-ROS7). It used to be a bare `true` resolved against that
 *     same boolean; a route meta that says `true` again is a route with no idea what it is guarding.
 *  3. A surface that edits driver fields either builds from `DRIVER_INLINE_EDITABLE` or is one of
 *     the two sanctioned editors (D-ROS2). A third one hand-picking its own fields is how a field
 *     ends up with two editors and two different amounts of honesty.
 *
 * ── WHY RULE 1 STRIPS COMMENTS INSTEAD OF GREPPING THE TEXT ─────────────────────────────────────
 * `lint:ui-adoption` is a plain regex over file text, and the design contract records the footgun
 * that follows: naming the banned thing in a comment trips it. That is tolerable for a raw `<button>`
 * and wrong here. R0's whole value was writing down WHY the boolean died — `session.ts`,
 * `PspRecordsSection.vue` and `routes/recruitment.ts` each explain it by name. A gate that forbade
 * saying the name would delete the reasoning it exists to protect. So this one parses: comments out,
 * then look for the identifier.
 *
 * Run:  node scripts/check-capabilities.mjs [--self-test]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const WEB = join(ROOT, "apps/web/src");

/** Sections, read from the source of truth rather than restated here. */
const SECTIONS = new Set(
  (readFileSync(join(ROOT, "packages/shared/src/auth.ts"), "utf8").match(
    /export const APP_SECTIONS = \[([^\]]+)\]/,
  )?.[1] ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean),
);

/**
 * Strip `//`, block comments and `<!-- -->` so a rule sees CODE.
 *
 * Deliberately not a parser: this runs over `.vue` as well as `.ts`, and the only thing it has to get
 * right is "is this identifier in a comment". Strings are left alone — a banned identifier inside a
 * string literal is still something worth failing on.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|vue)$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * The two sanctioned driver editors (D-ROS2, R6c). Shrink-only: a third entry is a deliberate,
 * reviewed decision, and the question it has to answer is which fields it owns that the other two
 * do not.
 */
const SANCTIONED_DRIVER_EDITORS = new Set([
  // The roster's drawer — the fields that need a warning before they claim a row from telematics.
  "apps/web/src/pages/DriversPage.vue",
  // Screening identity: date of birth, captured where the screening happens (P0b).
  "apps/web/src/features/compliance/ScreeningIdentityCard.vue",
  "apps/web/src/pages/ScreeningReadinessPage.vue",
]);

export function findViolations(files) {
  const out = [];
  for (const { path, src } of files) {
    const code = stripComments(src);

    if (/\bcanManageFleet\b/.test(code)) {
      out.push(`${path}: uses canManageFleet — deleted at R0. Ask session.can(<section>) instead.`);
    }

    for (const m of code.matchAll(/requiresManage\s*:\s*([^,}\n]+)/g)) {
      const raw = m[1].trim();
      const named = raw.match(/^["']([a-z_]+)["']$/)?.[1];
      // `AppSection` in a type declaration is the meta's TYPE, not a route's value.
      if (raw === "AppSection" || raw.startsWith("AppSection")) continue;
      if (!named || !SECTIONS.has(named)) {
        out.push(`${path}: requiresManage: ${raw} — must NAME a section (R0/D-ROS7).`);
      }
    }

    // A CALL, not the declaration: `useDrivers.ts` defines this composable and is not an editor.
    if (/(?<!function\s)useUpdateDriverProfile\s*\(/.test(code) && !SANCTIONED_DRIVER_EDITORS.has(path)) {
      if (!/DRIVER_INLINE_EDITABLE/.test(code)) {
        out.push(
          `${path}: edits driver fields without building from DRIVER_INLINE_EDITABLE (D-ROS2). ` +
            `Either derive the fields from that list, or add this file to SANCTIONED_DRIVER_EDITORS with why.`,
        );
      }
    }
  }
  return out;
}

function selfTest() {
  const cases = [
    ["a.ts", "const x = canManageFleet;", /canManageFleet/],
    ["b.ts", "meta: { requiresManage: true }", /must NAME a section/],
    ["c.ts", 'meta: { requiresManage: "banana" }', /must NAME a section/],
    ["d.vue", "const s = useUpdateDriverProfile();", /DRIVER_INLINE_EDITABLE/],
  ];
  const failures = [];
  for (const [path, src, expected] of cases) {
    const found = findViolations([{ path, src }]);
    if (!found.some((f) => expected.test(f))) failures.push(`detector did not fire for: ${src}`);
  }
  // …and the comment case, which is the reason this gate parses instead of grepping.
  const commented = findViolations([
    { path: "e.ts", src: "// canManageFleet used to live here, and R0 deleted it.\nconst ok = 1;" },
  ]);
  if (commented.length) failures.push("fired on a COMMENT mentioning canManageFleet — R0's reasoning must stay sayable");

  // The composable's own DECLARATION is not a driver editor; only its callers are.
  const declared = findViolations([
    { path: "f.ts", src: "export function useUpdateDriverProfile() { return 1; }" },
  ]);
  if (declared.length) failures.push("fired on the composable's declaration rather than on a caller");

  if (failures.length) {
    console.error("✗ capabilities self-test failed:");
    for (const f of failures) console.error(`   ${f}`);
    process.exit(1);
  }
  console.log("✓ capabilities self-test — all three detectors fire, and none fires on a comment.");
}

const files = walk(WEB).map((p) => ({ path: relative(ROOT, p), src: readFileSync(p, "utf8") }));
const violations = findViolations(files);

if (process.argv.includes("--self-test")) selfTest();

if (violations.length) {
  console.error(`✗ ${violations.length} capability violation(s):`);
  for (const v of violations) console.error(`   ${v}`);
  process.exit(1);
}
console.log(
  `✓ capabilities ok — ${files.length} web files: no canManageFleet, every requiresManage names a section, ` +
    `${SANCTIONED_DRIVER_EDITORS.size} sanctioned driver editors.`,
);

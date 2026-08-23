#!/usr/bin/env node
/**
 * Design-token linter: fails if templates use raw palette utilities, hex
 * colors, or inline color styles instead of the semantic tokens defined in
 * src/style.css (see docs/DESIGN-SYSTEM.md).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = new URL("../src", import.meta.url).pathname;

// Files allowed to contain raw color values, with the reason.
const ALLOW = new Set([
  "style.css", // defines the tokens themselves
  "features/dashboard/chartTheme.ts", // jsdom fallbacks for canvas charts
]);

/**
 * Every colour ROLE the design system actually defines, read from `tokens.css` rather than listed
 * here — a second copy of the palette is a second thing to forget to update.
 *
 * ── Why this rule exists ────────────────────────────────────────────────────────────────────────
 * `border-line` shipped and sat in three files. It is not a token: the roles are `edge`,
 * `edge-subtle`, `edge-strong`, `edge-control`. Tailwind emits nothing for an unknown role, so the
 * border simply was not drawn — and every gate passed, because the rules below only ban RAW palette
 * hues. A misspelt semantic name is invisible to all of them, which makes it the easier mistake to
 * make and the harder one to see. Found 2026-08-18 while reading the contract against the drawer.
 */
const TOKENS_CSS = new URL("../../../packages/ui/src/tokens.css", import.meta.url).pathname;
const TOKENS_SOURCE = readFileSync(TOKENS_CSS, "utf8");
const COLOR_ROLES = new Set(
  [...TOKENS_SOURCE.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]),
);

/**
 * Radius and elevation roles, read from the same file and for the same reason (D-DS7a).
 *
 * ── Why these joined the colour rules ───────────────────────────────────────────────────────────
 * Colour discipline in this app is close to perfect — three hex literals, all annotated — precisely
 * because this script watched it. Radius was not watched, and it rotted: `rounded-md` in seven
 * places, `rounded-lg` inside `BaseModal` (a shared primitive), and a map whose `rounded-t-xl`
 * corners were twice the radius of the `BaseCard` it sat in. None of it was visible to any gate,
 * because the rules above only ever looked at hue. Found by counting utilities, 2026-08-23.
 *
 * `rounded-full` and `rounded-none` are not off-scale values — they are "a circle" and "no corner",
 * both genuinely theme-independent — so they are allowed alongside the roles.
 */
const RADIUS_ROLES = new Set([
  ...[...TOKENS_SOURCE.matchAll(/--radius-([a-z0-9-]+)\s*:/g)].map((m) => m[1]),
  "full",
  "none",
]);
const ELEVATION_ROLES = new Set([
  ...[...TOKENS_SOURCE.matchAll(/--shadow-([a-z0-9-]+)\s*:/g)].map((m) => m[1]),
  "none",
]);

/** Tailwind's corner and side segments, so `rounded-t-surface` reads as side `t`, role `surface`. */
const RADIUS_SIDES = "(?:t|r|b|l|s|e|tl|tr|bl|br|ss|se|es|ee)";

/**
 * Tailwind's own structural suffixes for these prefixes — widths, sides, styles and offsets, none of
 * which name a colour. Listed rather than pattern-matched: a bare number is easy to spot and these
 * words are a closed set, whereas guessing at "looks structural" is how a real violation slips past.
 */
const STRUCTURAL = new Set([
  // border-* widths and sides, ring/outline modifiers, and the universal colour keywords.
  "t", "r", "b", "l", "x", "y", "s", "e", "none", "solid", "dashed", "dotted", "double", "hidden",
  "collapse", "separate", "inset", "offset", "reverse", "current", "transparent", "inherit",
  // text-* utilities that are about SIZE or ALIGNMENT and merely share the prefix.
  "xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl",
  "left", "center", "right", "justify", "start", "end", "wrap", "nowrap", "balance", "pretty",
  "ellipsis", "clip",
]);

/** `border-spacing-2`, `ring-offset-4` … a structural head with a value after it. */
const STRUCTURAL_HEADS = ["spacing", "offset", "opacity"];

/** `border-b-2`, `border-l-4`, `divide-y-0` — a side with a WIDTH, which names no colour. */
const SIDE_WIDTH = /^[trblxyse]-\d+$/;

const BANNED_HUES =
  "(?:slate|gray|zinc|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)";
const UTIL_PREFIX =
  "(?:bg|text|ring|border|divide|placeholder|outline|decoration|fill|stroke|accent|caret|from|via|to|shadow)";

const RULES = [
  {
    name: "raw palette utility (use semantic tokens)",
    re: new RegExp(`\\b${UTIL_PREFIX}-${BANNED_HUES}-\\d+(?:/\\d+)?\\b`, "g"),
  },
  {
    name: "raw neutral edge utility (use semantic edge tokens)",
    re: /\b(?:ring|border|divide|outline)-neutral-\d+(?:\/\d+)?\b/g,
  },
  {
    // Supersedes the older `shadow-sm|md|lg|xl|2xl` list: anything that is not a named elevation
    // fails, so a future `shadow-3xl` cannot arrive unnoticed the way `rounded-md` did.
    name: "elevation not in tokens.css (use shadow-card/card-raised/overlay/dialog)",
    classesOnly: true,
    // Two holes, both found by feeding the rule the thing it was supposed to reject and watching it
    // pass — which is the only way this class of hole shows up. A first draft required `[a-z]` after
    // the dash, so `shadow-2xl` walked through; a second closed with `\b`, which cannot fire after
    // the `]` of an arbitrary value, so `shadow-[0_1px_2px_red]` walked through too.
    re: /\bshadow-(\[[^\]]*\]|[a-z0-9][a-z0-9-]*)(?![\w-])/g,
    violates: (m) => !ELEVATION_ROLES.has(m[1]),
  },
  {
    /**
     * Column widths belong to the scale, not to `headerClass` (D-DS5).
     *
     * 173 of them had been written by hand across 25 files in 15 different sizes — 5rem and 6rem and
     * 7rem for the same kind of column in three different tables, because every author picked a
     * number and no two ever compared notes. `headerClass` was the channel that let it happen, so it
     * stops being the width channel. A fixed `w-32` is still fine there: that is a different intent.
     *
     * Scanned over the whole line rather than inside `class="…"`, because a column definition is an
     * object literal in a <script> block, which is exactly where the class-only rules never look.
     */
    name: "column width in headerClass (use the `width` prop: xs/sm/md/lg/xl/2xl/3xl)",
    re: /headerClass:\s*"[^"]*min-w-\[/g,
  },
  {
    name: "radius not in tokens.css (use rounded-detail/control/surface/overlay/dialog)",
    classesOnly: true,
    re: new RegExp(`\\brounded(?:-${RADIUS_SIDES})?-(\\[[^\\]]*\\]|[a-z0-9][a-z0-9-]*)(?![\\w-])`, "g"),
    violates: (m) => !RADIUS_ROLES.has(m[1]),
  },
  {
    name: "unknown colour role — not a token in tokens.css",
    /**
     * Scanned inside `class` / `:class` values ONLY, never over raw text.
     *
     * The first attempt ran over whole lines and reported `fill-ups`, `fill-up` and `fill-by-fill`
     * out of ordinary English prose — 103 findings, almost all of them sentences. A utility-class
     * rule has to look where utility classes live; the hue rules above get away with whole-line
     * scanning because a raw palette name is distinctive and an English word is not.
     */
    classesOnly: true,
    re: /\b(?:bg|text|ring|border|divide|outline|fill|stroke|accent|placeholder)-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\b/g,
    // A match is only a VIOLATION when the suffix names no role and is not structural. Numeric
    // suffixes (border-2, ring-1) and arbitrary values are left alone by the pattern itself.
    /**
     * ⚠ The FIRST version of this rule was wrong, and it was caught by breaking it rather than by
     * reading it. It waved through any suffix whose first segment matched no known role family —
     * which is exactly what `border-line` is. It therefore caught `text-brand-900` (a bad STEP in a
     * real family) and missed the very bug it was written for. A gate that passes its own defect is
     * worse than no gate, because it reads as coverage.
     *
     * The rule now refuses ANY suffix that is neither a defined role nor structural. That is only
     * safe because the structural sets above are closed and enumerated; the price of forgetting one
     * is a false positive on the next build, which is loud, rather than a silent miss.
     */
    violates: (m) => {
      const suffix = m[1];
      if (COLOR_ROLES.has(suffix) || STRUCTURAL.has(suffix) || SIDE_WIDTH.test(suffix)) return false;
      return !STRUCTURAL_HEADS.includes(suffix.split("-")[0]);
    },
  },
  { name: "hex color (use tokens / chartTheme)", re: /#[0-9a-fA-F]{3,8}\b/g },
  {
    name: "inline color style (use token classes)",
    re: /style="[^"]*(?:color|background)[^"]*"/g,
  },
];

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(vue|ts|css|html)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) yield p;
  }
}

let failures = 0;
for (const file of walk(SRC)) {
  const rel = relative(SRC, file);
  if (ALLOW.has(rel)) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (line.includes("token-check-disable-line")) return;
    // Everything between the quotes of a `class=` / `:class=` binding on this line, joined. Dynamic
    // bindings carry expressions too; harmless, since a role name in one is still a role name.
    // `@apply` is included because a component <style> block is just as capable of writing
    // `rounded-md` as a template is, and the class-only rules would otherwise never look there.
    const classText = [
      ...[...line.matchAll(/:?class="([^"]*)"/g)].map((m) => m[1]),
      ...[...line.matchAll(/@apply\s+([^;]*)/g)].map((m) => m[1]),
    ].join(" ");
    for (const rule of RULES) {
      const haystack = rule.classesOnly ? classText : line;
      if (!haystack) continue;
      for (const m of haystack.matchAll(rule.re)) {
        if (rule.violates && !rule.violates(m)) continue;
        failures++;
        console.error(`${rel}:${i + 1}  ${rule.name}  →  ${m[0]}`);
      }
    }
  });
}

if (failures) {
  console.error(`\n✗ ${failures} design-token violation(s). See docs/DESIGN-SYSTEM.md.`);
  process.exit(1);
}
console.log("✓ design tokens clean");

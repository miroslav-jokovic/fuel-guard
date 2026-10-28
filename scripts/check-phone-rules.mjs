#!/usr/bin/env node
/**
 * The phone and tablet rules, gated (DESIGN-SYSTEM-CONTRACT.md §9; Maintenance M4, Q-MX6).
 *
 * ── WHY A GATE AND NOT A BROWSER PASS ALONE ───────────────────────────────────────────────────
 * M3's pass at 390 px measured twelve targets under 44 px on the truck's page, every one of them a
 * SHARED control left at its desk size, and the proposal's pass a day earlier measured thirty-one on
 * the Units list. A browser pass finds that once; the next page added to the shop is 36 px again
 * unless something refuses it. Most of §9 is enforced where it is drawn — the touch floor in the
 * primitives, the tab row and the one Back in the shell, each with its tests — so what is left for a
 * static check is what a PAGE can still get wrong. Three things:
 *
 *   1. A column with no `card:` marker (rule 3). A card's three facts are the page's to state; an
 *      unmarked column on a shop page is a card that falls back to every column, five lines a row.
 *   2. A primary verb in `PageHeader`'s actions (rule 2). Below `md` the header scrolls away with
 *      the page; a page's one or two verbs go through `WalkActions`, which draws the header row on a
 *      desk and the bottom bar on a phone from one definition.
 *   3. A hand-sized control (rule 1): a raw `<button>`, `<a>` or `<RouterLink>` given a box under
 *      48 px with no touch branch. The primitives raise themselves under the floor; a hand-written
 *      control does not, which is the whole reason it must say why it is hand-written. A desk-only
 *      control says so where it stands: `ui-adoption: desk-only — <why>`.
 *
 * ── WHICH FILES ARE THE SHOP'S ───────────────────────────────────────────────────────────────
 * Derived, never listed: every page a `/shop…` route in `router/routes/*.ts` imports, plus every
 * `@/features/…` or relative `.vue` file those pages import, transitively. A component moved into
 * the shop is checked the day it is imported there, and one moved out stops being checked.
 *
 * `--self-test` runs each detector over a fixture it must flag and one it must pass, and `--check`
 * runs them too before reading the tree, so a detector that stops firing fails the gate.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB_SRC = join(ROOT, "apps/web/src");
const DESK_ONLY = /ui-adoption: desk-only\s+—\s+\S/;

/** Comments out, offsets kept: a commented example must not count, and a line number must still be true. */
export function stripComments(source) {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  return source
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^[ \t]*\/\/.*$/gm, blank);
}

const lineOf = (source, offset) => source.slice(0, offset).split("\n").length;

/** The text from the bracket at `start` to its partner, inclusive; strings are skipped whole. */
function balanced(source, start) {
  const open = source[start];
  const close = open === "[" ? "]" : open === "{" ? "}" : ")";
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = source.indexOf(ch, i + 1);
      if (end < 0) break;
      i = end;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close && (depth -= 1) === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

/** Rule 3: every column object of a `DataTableColumn[]` array carries `card:`. */
export function unmarkedColumns(relativePath, source) {
  const code = stripComments(source);
  const found = [];
  const ARRAY = /DataTableColumn\[\]\s*(?:=|>\s*\(\s*\(\s*\)\s*=>|=>)\s*\[/g;
  for (const match of code.matchAll(ARRAY)) {
    const start = match.index + match[0].length - 1;
    const array = balanced(code, start);
    for (const object of array.matchAll(/\{\s*key:/g)) {
      const at = start + object.index;
      if (!/\bcard:\s*"(?:title|sentence|meta|none)"/.test(balanced(code, at))) found.push(`${relativePath}:${lineOf(code, at)}`);
    }
  }
  return found;
}

/** Rule 2: a primary button in `PageHeader`'s `#actions` slot instead of `WalkActions`. */
export function headerVerbs(relativePath, source) {
  const code = stripComments(source);
  const found = [];
  for (const header of code.matchAll(/<PageHeader\b/g)) {
    const end = code.indexOf("</PageHeader>", header.index);
    if (end < 0) continue;
    const body = code.slice(header.index, end);
    const slot = body.match(/<template\s+(?:#actions|v-slot:actions)\b[\s\S]*?<\/template>/);
    if (!slot) continue;
    for (const button of slot[0].matchAll(/<(?:BaseButton|AppButton)\b[^>]*\svariant="primary"/g))
      found.push(`${relativePath}:${lineOf(code, header.index + slot.index + button.index)}`);
  }
  return found;
}

/** Rule 1: a raw control given a box under 48 px, with no touch branch and no desk-only reason. */
export function handSizedControls(relativePath, source) {
  const code = stripComments(source);
  const found = [];
  const SMALL = /(?:^|\s)(?:h|size|min-h)-(?:[1-9]|10|11)(?:\.5)?(?=\s|$)/;
  for (const tag of code.matchAll(/<(button|a|RouterLink)\b(?:[^>"']|"[^"]*"|'[^']*')*>/g)) {
    const cls = tag[0].match(/\sclass="([^"]*)"/)?.[1] ?? "";
    if (!SMALL.test(cls) || /:class="[^"]*\btouch\b/.test(tag[0])) continue;
    const line = lineOf(code, tag.index);
    const before = source.split("\n").slice(Math.max(0, line - 4), line - 1).join("\n");
    if (!DESK_ONLY.test(before)) found.push(`${relativePath}:${line}`);
  }
  return found;
}

/** The pages `/shop…` routes import, from the route files as written. */
export function shopPages(routeSources) {
  return routeSources.flatMap((source) =>
    stripComments(source).split(/\bpath:\s*"/).slice(1).flatMap((chunk) => {
      const path = chunk.slice(0, chunk.indexOf('"'));
      const page = chunk.match(/import\("@\/pages\/([^"]+\.vue)"\)/)?.[1];
      return path.startsWith("/shop") && page ? [join(WEB_SRC, "pages", page)] : [];
    }),
  );
}

/** Those pages and every feature or relative `.vue` they import, transitively. */
function renderSet(pages) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    const code = stripComments(readFileSync(file, "utf8"));
    for (const [, spec] of code.matchAll(/from\s+["']((?:@\/features\/|\.{1,2}\/)[^"']+\.vue)["']/g))
      visit(spec.startsWith("@/") ? join(WEB_SRC, spec.slice(2)) : resolve(dirname(file), spec));
  };
  pages.forEach(visit);
  return [...seen].sort();
}

function selfTest() {
  const failures = [];
  const expect = (name, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  };
  expect("unmarked column flagged", unmarkedColumns("f.vue", `const C: DataTableColumn[] = [\n  { key: "a", label: "A", card: "title" },\n  { key: "b", label: "B" },\n];`), ["f.vue:3"]);
  expect("computed columns read", unmarkedColumns("f.vue", `const C = computed<DataTableColumn[]>(() => [\n  { key: "a", label: "A" },\n]);`), ["f.vue:2"]);
  expect("marked columns pass", unmarkedColumns("f.vue", `const C: DataTableColumn[] = [{ key: "a", label: "A", card: "meta" }, { key: "b", label: "B", card: "none" }];`), []);
  expect("commented column ignored", unmarkedColumns("f.vue", `const C: DataTableColumn[] = [\n  // { key: "x", label: "X" },\n  { key: "a", label: "A", card: "title" },\n];`), []);
  expect("primary header verb flagged", headerVerbs("p.vue", `<PageHeader>\n<template #actions>\n<BaseButton variant="primary" @click="go">Add</BaseButton>\n</template>\n</PageHeader>`), ["p.vue:3"]);
  expect("walk actions pass", headerVerbs("p.vue", `<PageHeader><template #actions><WalkActions :actions="a" /><BaseButton to="/x">Labels</BaseButton></template></PageHeader>`), []);
  expect("hand-sized button flagged", handSizedControls("c.vue", `<template>\n<button type="button" class="inline-flex h-8 px-2">x</button>\n</template>`), ["c.vue:2"]);
  expect("touch branch passes", handSizedControls("c.vue", `<button type="button" class="px-2" :class="touch ? 'h-12' : 'h-8'">x</button><button class="h-8 px-2" :class="touch && 'h-12'">y</button>`), []);
  expect("desk-only reason passes", handSizedControls("c.vue", `<!-- ui-adoption: desk-only — prints a sheet -->\n<button class="h-8">x</button>`), []);
  expect("bare desk-only mark fails", handSizedControls("c.vue", `<!-- ui-adoption: desk-only -->\n<button class="h-8">x</button>`), ["c.vue:2"]);
  expect("shop routes only", shopPages([`{ path: "/shop/units", component: () => import("@/pages/UnitsPage.vue") }, { path: "/vehicles", component: () => import("@/pages/VehiclesPage.vue") }`]).map((p) => relative(WEB_SRC, p)), ["pages/UnitsPage.vue"]);
  return failures;
}

const failures = selfTest();
if (process.argv.includes("--self-test")) {
  if (failures.length) {
    console.error(`check-phone-rules: self-test failed\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("check-phone-rules: self-test passed (11 fixtures)");
  process.exit(0);
}

const routeDir = join(WEB_SRC, "router/routes");
const routeSources = readdirSync(routeDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => readFileSync(join(routeDir, f), "utf8"));
const pages = shopPages(routeSources);
const files = renderSet(pages);
const findings = { "an unmarked card column (rule 3)": [], "a primary verb in PageHeader, not WalkActions (rule 2)": [], "a hand-sized control under 48 px (rule 1)": [] };
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const at = relative(ROOT, file);
  findings["an unmarked card column (rule 3)"].push(...unmarkedColumns(at, source));
  findings["a primary verb in PageHeader, not WalkActions (rule 2)"].push(...headerVerbs(at, source));
  findings["a hand-sized control under 48 px (rule 1)"].push(...handSizedControls(at, source));
}
if (failures.length) console.error(`check-phone-rules: self-test failed\n  ${failures.join("\n  ")}`);
const broken = Object.entries(findings).filter(([, list]) => list.length);
for (const [rule, list] of broken) console.error(`check-phone-rules: ${list.length} × ${rule}\n  ${list.join("\n  ")}`);
if (pages.length === 0) console.error("check-phone-rules: no /shop route found — the route parser no longer matches the route files");
if (failures.length || broken.length || pages.length === 0) {
  console.error("See DESIGN-SYSTEM-CONTRACT.md §9 (phone and tablet).");
  process.exit(1);
}
console.log(`check-phone-rules: ${files.length} shop files (${pages.length} pages) meet §9`);

#!/usr/bin/env node
/**
 * Fitness function — three ways a Vue template can be wrong that nothing else in this repo checks.
 *
 * All three come from the 2026-08-30 HazmatGuard audit (docs/plans/hazmat-consolidation/), and each
 * one had SHIPPED. What they share is that they type-check, pass every existing gate, and look
 * deliberate in review:
 *
 *  1. UNRESOLVED COMPONENT — a PascalCase tag used in a template and never bound in the script.
 *     Vue renders it as an unknown custom element with no styles and no error. `vue-tsc` does not
 *     resolve template components, so nothing caught `HazmatProductLines` using `<BaseCard>` without
 *     importing it: the main card of the public placard calculator had never been a card.
 *
 *  2. TAILWIND `!important` ON A SHARED PRIMITIVE — `apps/web/CLAUDE.md`'s first rule is that a
 *     primitive is "never re-styled". Two call sites wrote six `!important`s each to turn a button
 *     into a link. The right reading of that is a MISSING VARIANT, and the fix was to add one.
 *
 *  3. RAW ANCHOR TO AN AUTHENTICATED API ROUTE — this SPA holds its session token in storage, not a
 *     cookie, and the API accepts only `Authorization: Bearer`. An `<a href="/api/...">` therefore
 *     sends no credential and 401s every time. `HazmatPanel`'s roadside-packet link could never have
 *     worked, for any load, for anyone. Downloads go through a fetch that attaches the token.
 *
 * ⚠ WHAT THIS DELIBERATELY DOES NOT CHECK: `capitalize` on a badge. That was the fourth audit
 * finding, and a blanket rule would be wrong — `badges.ts` says a call-site `capitalize` legitimately
 * "marks a vocabulary that has not been mapped yet", and eleven sites across anomalies, rejections
 * and StatusBadge are exactly that. The harmful case is `capitalize` over an ALREADY-MAPPED label,
 * which no static check can tell from the sanctioned one. It is pinned where it belongs instead, by
 * "renders the status label exactly as the map states it" in
 * apps/web/src/features/hazmat/LoadStatusBadge.test.ts.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SKIP = new Set(["node_modules", "dist", "coverage", ".git", ".pnpm-store", "android", "ios", ".expo", "worktrees"]);

/** Vue built-ins plus the headless-UI components this app registers by import elsewhere. */
const BUILTIN = new Set([
  "Teleport", "Transition", "TransitionGroup", "KeepAlive", "Suspense", "Component", "Fragment",
  "RouterLink", "RouterView", "Slot",
]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (full.endsWith(".vue")) out.push(full);
  }
  return out;
}

const roots = ["apps/web/src", "apps/admin/src", "packages/ui/src"].map((r) => join(ROOT, r));
const files = roots.flatMap((r) => walk(r));
const failures = [];

/** Strip HTML comments so a comment DESCRIBING markup is never counted as markup. */
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, "");

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const rel = relative(ROOT, file);
  const templateAt = source.indexOf("<template>");
  if (templateAt < 0) continue;
  const script = source.slice(0, source.lastIndexOf("</script>") + 1);
  const template = stripComments(source.slice(templateAt));

  // ── 1 · unresolved components ───────────────────────────────────────────────────────────────
  for (const name of new Set([...template.matchAll(/<([A-Z][A-Za-z0-9_]*)/g)].map((m) => m[1]))) {
    if (BUILTIN.has(name)) continue;
    const bound =
      new RegExp(`\\bas\\s+${name}\\b`).test(script) ||
      new RegExp(`\\b(?:const|let|var|function|class)\\s+${name}\\b`).test(script) ||
      new RegExp(`import\\s+${name}\\b`).test(script) ||
      new RegExp(`[{,]\\s*${name}\\s*[,}]`).test(script);
    if (!bound) failures.push(`${rel}: <${name}> is used in the template and never bound in the script — Vue will render an unstyled unknown element`);
  }

  // ── 2 · Tailwind !important in a STATIC class attribute ─────────────────────────────────────
  // `:class` is skipped on purpose: `:class="!loading ? …"` is a JS negation, not an override, and
  // counting it was the first thing this check got wrong.
  for (const attr of template.matchAll(/(?<!:)\bclass="([^"]*)"/g)) {
    const bang = attr[1].match(/(?:^|[\s:])!(?:-)?[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)?/g);
    if (bang) {
      failures.push(`${rel}: \`class="…${bang.join(" ")}…"\` uses Tailwind !important on a component — a primitive is never re-styled; add the variant it is missing`);
    }
  }

  // ── 3 · raw anchors at an authenticated API route ───────────────────────────────────────────
  for (const anchor of template.matchAll(/<a\b[^>]*?(?::href="[^"]*\/api\/|href="\/api\/)/g)) {
    const line = source.slice(0, templateAt + anchor.index).split("\n").length;
    failures.push(`${rel}:${line}: <a> points at /api/… — the API takes only a bearer header, so a plain link 401s; fetch it with the session token instead`);
  }
}

if (failures.length) {
  console.error(`✗ ${failures.length} template-integrity violation(s):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`✓ template integrity ok — ${files.length} components: every tag resolves, no !important on a primitive, no unauthenticated API links.`);

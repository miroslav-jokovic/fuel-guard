#!/usr/bin/env node
/**
 * The design system's one source of token values (D-DS3).
 *
 * ── What this replaced ──────────────────────────────────────────────────────────────────────────
 * `packages/ui/src/tokens.css` was 471 hand-written lines in which the values, the comments and the
 * Tailwind bindings were all authored by hand and had to be kept in agreement by remembering to.
 * The bindings especially: every role needed a matching `--color-*` line in `@theme inline`, and
 * forgetting one produced a token that resolved to nothing — which is exactly the `border-line`
 * failure `apps/web/scripts/check-design-tokens.mjs` was written for after it shipped.
 *
 * Now the values live in DTCG JSON under `src/`, and the `@theme inline` block is DERIVED. Measured
 * before the switch: 106 of the 116 bindings followed one of four mechanical rules and none was an
 * exception, so deriving them loses no expressiveness and removes the class of bug entirely.
 *
 * ── On DTCG conformance, stated rather than implied ─────────────────────────────────────────────
 * These files are DTCG-SHAPED, not strictly conformant, and the deviation is deliberate. A large
 * part of this system's theming is runtime CSS indirection — `--viz-brand: var(--brand-accent-strong)`
 * — so that a future `.dark` block re-points one variable and every dependent follows. Expressed as
 * a DTCG `{reference}` instead, the build would FLATTEN it to a literal colour and the indirection
 * that makes theming possible would be gone. So those values stay literal CSS strings.
 *
 * ── Why Style Dictionary, given the above ───────────────────────────────────────────────────────
 * Not for reference resolution, which we deliberately do not use. For the loader, the DTCG shape
 * validation, and the `platforms` extension point: the driver app's four themes are the second
 * consumer this pipeline exists for (D-DS3b), and they need a different emitter over the same
 * source. That is the interchange value the plan bought, and a bespoke script would not have it.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import StyleDictionary from "style-dictionary";

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => join(here, "src", f);
const read = (f) => readFileSync(src(f), "utf8");
const json = (f) => JSON.parse(read(f));

/**
 * Source order is the file's order — the sections read as prose, so it is not incidental.
 *
 * `roles.light.json` is named for the scheme it carries. D-DS2 adds `roles.dark.json` beside it and
 * the emitter pairs them into `light-dark()`; splitting the files rather than nesting two values per
 * token keeps each scheme readable on its own and makes the diff of a re-theme legible.
 */
const GROUPS = [
  ["primitives.json", "ramp"],
  ["roles.light.json", "role"],
];

const ordered = [];
for (const [file, group] of GROUPS) {
  for (const [name, node] of Object.entries(json(file)[group] ?? {})) ordered.push({ name, ...node });
}
const literals = Object.entries(json("theme.json").theme).map(([name, node]) => ({ name, ...node }));

const ext = (t, key) => t.$extensions?.[`fuelguard.${key}`];

/** `/* … *\/`, wrapped at the file's 100-column budget so long rationales stay readable. */
function comment(text, indent = "  ") {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > 96 - indent.length) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.length === 1
    ? `${indent}/* ${lines[0]} */`
    : `${indent}/* ${lines[0]}\n${lines.slice(1).map((l) => `${indent}   ${l}`).join("\n")} */`;
}

function emitCss() {
  const out = [":root {"];
  for (const t of ordered) {
    for (const section of ext(t, "section") ?? []) out.push("", comment(section));
    out.push(`  --${t.name}: ${t.$value};${t.$description ? ` /* ${t.$description} */` : ""}`);
  }
  out.push("}", "", "@theme inline {");

  for (const t of literals) {
    for (const section of ext(t, "section") ?? []) out.push("", comment(section));
    out.push(`  --${t.name}: ${t.$value};${t.$description ? ` /* ${t.$description} */` : ""}`);
  }

  /**
   * The four exposure rules, measured off the hand-written file rather than invented: a ramp or a
   * role becomes `--color-<name>`, a shape becomes `--radius-<name>`, an elevation becomes
   * `--shadow-<name>`. A token with no `expose` is deliberately internal — the `--viz-*` roles are
   * read at runtime by features/dashboard/chartTheme.ts and were never Tailwind utilities.
   */
  const RENAME = { shape: "radius", elevation: "shadow" };
  out.push("", comment("Tailwind bindings — derived, never authored. A token is exposed here because its source declares it, so a new role cannot arrive without its utility."));
  for (const t of ordered) {
    const namespace = ext(t, "expose");
    if (!namespace) continue;
    const prefix = Object.keys(RENAME).find((p) => t.name.startsWith(`${p}-`));
    const bare = t.name.startsWith("ramp-")
      ? t.name.slice("ramp-".length)
      : prefix
        ? t.name.slice(prefix.length + 1)
        : t.name;
    out.push(`  --${namespace}-${bare}: var(--${t.name});`);
  }
  out.push("}");
  return out.join("\n");
}

// Style Dictionary loads and shape-checks the same sources; the emitter above formats them.
StyleDictionary.registerFormat({ name: "fuelguard/css", format: () => emitCss() });
const sd = new StyleDictionary({
  source: [src("primitives.json"), src("roles.light.json")],
  platforms: { css: { transformGroup: "css", files: [{ destination: "check.css", format: "fuelguard/css" }] } },
  log: { verbosity: "silent", warnings: "disabled" },
});
const built = await sd.formatPlatform("css");
if (!built?.length) throw new Error("Style Dictionary produced no output — the DTCG sources did not load.");

const target = join(here, "..", "ui", "src", "tokens.generated.css");
mkdirSync(dirname(target), { recursive: true });
const HEADER = `/* GENERATED by packages/tokens/build.mjs — do not edit.
   Values live in packages/tokens/src/*.json; the prose around them in preamble.css and
   epilogue.css. Run \`pnpm gen:tokens\` after changing either. \`lint:codegen\` fails the build
   when this file and its sources disagree. */
`;
writeFileSync(
  target,
  `${HEADER}${read("preamble.css").trimEnd()}\n\n${emitCss()}\n\n${read("epilogue.css").trimStart()}`,
);
console.log(
  `✓ tokens.css generated — ${ordered.length} values, ${literals.length} theme literals, ` +
    `${ordered.filter((t) => ext(t, "expose")).length} derived bindings`,
);

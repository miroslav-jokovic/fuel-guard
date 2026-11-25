/**
 * The design system's colour tokens out of `tokens.generated.css`, for the driver's training page
 * (vite.config.ts, SAFETY-VIDEOS D-TR12). Importing the token file whole pulls in Tailwind and every
 * utility the office app uses (115 KB of CSS), so the page takes only what it needs, cut from the one
 * source at build time. Pure; throws when a block is missing, so a renamed or restructured token file
 * fails the build instead of shipping a page with no colours.
 */

/** The first top-level block whose opening line matches `opener` (`:root {`, `@theme inline {`), braces balanced. */
export function topBlock(css: string, opener: RegExp, what: string): string {
  const start = css.search(opener);
  if (start < 0) throw new Error(`tokens: no top-level ${what} block`);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error(`tokens: unterminated ${what} block`);
}

/** The first top-level `:root { … }` block: the raw values (`--surface`, `--ramp-brand-600`, …). */
export const rootBlock = (css: string): string => topBlock(css, /^:root\s*\{/m, ":root");

/**
 * What the page's stylesheet reads: the `:root` block, and the `--color-*` names the components use.
 * Those are declared in the `@theme inline` block (`--color-surface: var(--surface)`), which Tailwind
 * consumes and never emits, so on their own the names define nothing. Found 2026-11-25 by
 * `rootBlock.test.ts` — the first build had them unset and the page drew in the browser's defaults.
 * They are re-declared here on `:root`, exactly as the token file writes them.
 */
export function portalTokens(css: string): string {
  const theme = topBlock(css, /^@theme inline\s*\{/m, "@theme inline");
  const colours = theme.match(/^\s*--color-[\w-]+\s*:[^;]+;/gm);
  if (!colours?.length) throw new Error("tokens: @theme inline declares no --color-* names");
  return `${rootBlock(css)}\n:root {\n${colours.map((d) => `  ${d.trim()}`).join("\n")}\n}`;
}

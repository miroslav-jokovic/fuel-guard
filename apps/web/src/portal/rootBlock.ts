/**
 * The first top-level `:root { … }` block of a stylesheet, braces balanced — the design system's colour
 * tokens out of `tokens.generated.css`, for the driver's training page (vite.config.ts). Pure; throws when
 * the block is missing, so a renamed token file fails the build instead of shipping a page with no colours.
 */
export function rootBlock(css: string): string {
  const start = css.search(/^:root\s*\{/m);
  if (start < 0) throw new Error("tokens: no top-level :root block");
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error("tokens: unterminated :root block");
}

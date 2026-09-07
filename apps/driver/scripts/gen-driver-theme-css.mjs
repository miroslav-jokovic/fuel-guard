#!/usr/bin/env node
/**
 * Rewrites the four `/* theme:<name>:start|end *​/` blocks of global.css from
 * src/theme/theme.roles.json, which is the single colour source (Direction B plan §2.1, B0.3).
 *
 * Before 2026-09-07 the mirror was maintained by hand: the file header said "generated" and nothing
 * generated it, so a 50-role re-value would have been fifty hand edits per theme with `lint:theme`
 * as the only safety net. This script is the convenience; `scripts/check-driver-theme.mjs` remains
 * the verifier, and `tests/theme-css-mirror.test.ts` asserts running this against the committed
 * global.css produces no diff.
 *
 * `--check` exits non-zero instead of writing, for use outside a test runner.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const ROLES_PATH = join(ROOT, 'src/theme/theme.roles.json');
const CSS_PATH = join(ROOT, 'global.css');

/** The selector each appearance is published under; ThemeProvider applies the class natively. */
const SELECTORS = {
  light: ':root',
  dark: '.dark',
  highContrastLight: '.high-contrast-light',
  highContrastDark: '.high-contrast-dark',
};

export function renderThemeCss(css, roles) {
  let next = css;
  for (const [theme, selector] of Object.entries(SELECTORS)) {
    const start = `/* theme:${theme}:start */`;
    const end = `/* theme:${theme}:end */`;
    const startIndex = next.indexOf(start);
    const endIndex = next.indexOf(end);
    if (startIndex < 0 || endIndex < startIndex) {
      throw new Error(`global.css is missing the ${theme} block markers`);
    }
    const values = roles[theme];
    if (!values) throw new Error(`theme.roles.json is missing ${theme}`);
    const declarations = Object.entries(values)
      .map(([role, value]) => `    --color-${role}: ${value};`)
      .join('\n');
    const block = `${start}\n  ${selector} {\n${declarations}\n  }\n  `;
    next = next.slice(0, startIndex) + block + next.slice(endIndex);
  }
  return next;
}

export function generate() {
  const roles = JSON.parse(readFileSync(ROLES_PATH, 'utf8'));
  const css = readFileSync(CSS_PATH, 'utf8');
  return { css, next: renderThemeCss(css, roles), roleCount: Object.keys(roles.light).length };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const { css, next, roleCount } = generate();
  if (process.argv.includes('--check')) {
    if (css !== next) {
      console.error('✗ global.css is not what gen-driver-theme-css.mjs would write; run `pnpm gen:theme`');
      process.exit(1);
    }
    console.log('✓ global.css matches theme.roles.json');
  } else {
    writeFileSync(CSS_PATH, next);
    console.log(`✓ global.css mirrors ${roleCount} roles × ${Object.keys(SELECTORS).length} themes`);
  }
}

#!/usr/bin/env node
/* eslint-disable no-redeclare */
// Guardrails for the AI-facing driver design contract. This is intentionally narrow: it rejects
// generic brand/layout escapes without trying to replace visual review or product judgment.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SCAN = ['app', 'src'];
const forbidden = [
  { pattern: /\b(?:Inter|Arial|Helvetica|Open Sans|Poppins|Hanken|HankenGrotesk)\b/i, message: 'Lexend through AppText only' },
  { pattern: /font-sans(?:-|\b)/, message: 'use semantic AppText variants instead of legacy font aliases' },
  // Direction B D-DB3: weight is the FAMILY for a loaded custom face, so a Tailwind weight utility
  // is silently inert — it looked like emphasis and rendered as none. Seventeen call sites were in
  // exactly that state the moment Lexend replaced the platform face; use font-ui-md|sb|bold.
  { pattern: /(?<![\w-])font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)(?![\w-])/, message: 'weight is the family: use font-ui, font-ui-md, font-ui-sb or font-ui-bold' },
  { pattern: /<Text(?:\s|>)/, message: 'use AppText instead of raw React Native Text' },
  { pattern: /\bAlert\.alert\s*\(/, message: 'use ConfirmSheet or an intentional Banner instead of native Alert' },
  { pattern: /from\s+['"]@\/theme\/ramps['"]/, message: 'screens and components must use semantic color roles, not primitive ramps' },
  { pattern: /from\s+['"]@react-navigation\//, message: 'SDK 56+ app code must import navigation APIs from the matching expo-router entry point' },
  { pattern: /(?:rounded|border|shadow|space|gap|p[trblxy]?|m[trblxy]?)-\[/, message: 'do not introduce arbitrary layout values; use the semantic 4pt-based scale or update DESIGN.md first' },
  { pattern: /\bshadow-(?:sm|md|lg|xl|2xl)\b/, message: 'shadows are reserved for system navigation, sheets, and overlays rather than content surfaces' },
  { pattern: /\btext-\[/, message: 'use the semantic typography scale rather than an arbitrary text size' },
  { pattern: /\b(?:gap|p[trblxy]?|m[trblxy]?)-(?:1\.5|2\.5)\b/, message: 'use 4pt-based structural spacing; 2pt optical spacing is only for tightly stacked text' },
  // The last escape hatch, closed in B7. Twenty-nine sizes had leaked in through it — every one a
  // number nobody could look up — and the scale now names all of them (spacing 13/15/18, maxWidth
  // `bubble`). A genuinely new size means adding a step to tailwind.config.js, where it gets a name.
  { pattern: /\b(?:h|w|min-h|min-w|max-w|max-h)-\[/, message: 'add the step to tailwind.config.js and use its name; no arbitrary sizes' },
  // react-native-svg implements NO CSS: a `<style>` block and `class="…"` selectors are parsed and
  // then ignored, so every path falls back to the default black fill. It is silent — the SVG is
  // valid, a browser and every design tool render it correctly, and only a device shows the truth.
  // The Silvicom mark shipped this way from the 2026-08 re-founding until 2026-09-07 and rendered as
  // black blobs on the sign-in screen, which is the FIRST screen a driver sees. Inline the fills.
  { pattern: /<style>/, message: 'react-native-svg ignores CSS: put fills on the elements, not in a <style> block' },
  { pattern: /\sclass="/, message: 'react-native-svg ignores class selectors: use a fill attribute' },
];

// Direction B D-DB5: the app has exactly ONE shadow and it is tinted with the hero navy. A local
// style object is the easy way back to a neutral drop shadow, so the role is reserved to the theme.
const forbiddenOutsideTheme = [
  { pattern: /\bshadowColor\b/, message: 'shadows come from src/theme/elevation.ts only' },
];

const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (['.ts', '.tsx'].includes(extname(path)) && !path.endsWith('.d.ts')) files.push(path);
  }
}
for (const directory of SCAN) walk(join(ROOT, directory));

const failures = [];
for (const path of files) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const insideTheme = path.includes('/src/theme/');
  const rules = insideTheme ? forbidden : [...forbidden, ...forbiddenOutsideTheme];
  lines.forEach((line, index) => {
    for (const rule of rules) {
      if (path.endsWith('src/components/AppText.tsx') && rule.pattern.source === '<Text(?:\\s|>)') continue;
      if (rule.pattern.test(line)) failures.push(`${path}:${index + 1} ${rule.message}`);
    }
  });
}

if (failures.length) {
  console.error('✗ driver design-contract check failed:\n' + failures.map((failure) => `  ${failure}`).join('\n'));
  process.exit(1);
}

console.log('✓ driver design-contract check passed');

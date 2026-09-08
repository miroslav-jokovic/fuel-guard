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

/**
 * A text colour on `AppText` must be a `tone`, never a class.
 *
 * `AppText` always renders `TEXT_TONE_CLASS[tone]`, so a colour arriving through `className` is a
 * SECOND class setting `color` on the same element, and NativeWind settles that by the CSS cascade —
 * whose last tiebreaker is position in the compiled stylesheet, where Tailwind sorts colour
 * utilities alphabetically. Position in the className string is not consulted at all.
 *
 * The outcome is that the class wins or loses on its own spelling. Measured 2026-09-07 across the
 * nine soft tones: `secondary`, `success`, `warning` and `onHero` happened to sort after `text-ink`
 * and rendered; `accent`, `action`, `caution`, `danger` and `info` sorted before it and rendered as
 * plain ink. Seven components were relying on it. The unread-count badges rendered `ink` on amber at
 * 1.67:1 in the dark appearance, and `Badge` carried a comment explaining why that must never happen
 * directly above the code where it was happening.
 *
 * This is deliberately narrow: it fires only on an `AppText` opening tag, and only for a class that
 * names a real colour role. `Icon` parses `className` itself and is untouched.
 */
const ROLE_NAMES = Object.keys(JSON.parse(readFileSync(join(ROOT, 'src/theme/theme.roles.json'), 'utf8')).light);
const COLOUR_CLASS = new RegExp(`(?<![\\w-])text-(?:${ROLE_NAMES.join('|')})(?![\\w-])`);

for (const path of files) {
  const source = readFileSync(path, 'utf8');
  // theme/textTone.ts IS the mapping, and the two comments that explain the rule name the classes.
  if (path.includes('/src/theme/')) continue;
  for (let at = source.indexOf('<AppText'); at !== -1; at = source.indexOf('<AppText', at + 1)) {
    let depth = 0;
    let end = at;
    while (end < source.length) {
      const ch = source[end];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) break;
      end += 1;
    }
    const props = source.slice(at, end);
    const colour = props.match(COLOUR_CLASS);
    if (!colour) continue;
    // A `tone=` in the same tag would win or lose by spelling; either way the class is the bug.
    const line = source.slice(0, at).split('\n').length;
    failures.push(
      `${path}:${line} AppText takes a colour as tone="…", not className="${colour[0]}" — a second colour class is resolved by stylesheet order, not by the className string`,
    );
  }
}

/**
 * The auth mast's texture (D-DB21) is capped at 80 rather than the band's 52, and that is only
 * honest while the mast carries nothing dimmer than `on-hero-secondary`. `on-hero-muted` tolerates a
 * background of grey 52 and no more, so a single muted caption added to a login screen would fail
 * WCAG against artwork that is otherwise correct — silently, because the pixels come from a `.webp`
 * that no assertion can read. The looser ceiling buys the sunset; this is what it costs.
 */
const AUTH_SURFACES = ['/app/(auth)/', '/src/features/auth/'];
for (const path of files) {
  if (!AUTH_SURFACES.some((surface) => path.includes(surface))) continue;
  readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
    if (/onHeroMuted|text-on-hero-muted/.test(line)) {
      failures.push(
        `${path}:${index + 1} the auth hero texture is capped for on-hero-secondary, so on-hero-muted may not appear on an auth surface (src/theme/heroTexture.ts)`,
      );
    }
  });
}

if (failures.length) {
  console.error('✗ driver design-contract check failed:\n' + failures.map((failure) => `  ${failure}`).join('\n'));
  process.exit(1);
}

console.log('✓ driver design-contract check passed');

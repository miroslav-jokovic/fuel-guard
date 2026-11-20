#!/usr/bin/env node
/**
 * The driver app's colour SYSTEM, in two tiers (Visual 2026 plan, D-DV3–D-DV5, owner-approved
 * 2026-11-20 on the V1 mock).
 *
 *   PALETTE  — every colour the app may use, named for what it IS. Nothing else in the app may
 *              introduce a colour; a new one starts here, with its provenance.
 *   ROLES    — the 50 semantic roles screens paint with, named for what they DO, each one a palette
 *              name per appearance. A screen never names a palette colour, only a role.
 *
 * This script writes `src/theme/theme.roles.json` from the two; `pnpm gen:theme` then writes
 * `global.css` from that file, and `src/theme/colors.ts` derives the native colours from it.
 * `tests/theme-roles-generated.test.ts` fails if the committed JSON differs from this file's output,
 * so a hand edit to the JSON is caught the same way a hand edit to global.css already was
 * (`tests/theme-css-mirror.test.ts`).
 *
 * WHY TWO TIERS. Until 2026-11-20 the 200 role values were typed by hand, with the generator that
 * produced Direction B's softened palette living only in one session's scratchpad (memory note
 * direction-b-position: "re-derive from DESIGN.md's table if values must change again"). A re-value
 * therefore meant 200 edits with nothing saying which ones were the same colour. Here a colour is
 * defined once and every role that shares it says so.
 *
 * Contrast is NOT asserted here; `tests/theme-colors.test.ts` and `tests/tone-pairings.test.ts`
 * measure every pairing the roles promise, in all four appearances.
 *
 * `--check` exits non-zero instead of writing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const ROLES_PATH = join(ROOT, 'src/theme/theme.roles.json');

/**
 * Brand colours are MEASURED, not chosen (`.claude/skills/silvicom-brand/SKILL.md`): navy from the
 * Silvicom wordmark, cyan from the "silvicom" decal on the trailers. Status colours sit outside the
 * brand's two-colours rule by owner ruling Q-DV2 (2026-11-20): they are functional, and used only as
 * state. Everything else is a navy-tinted neutral, so no grey in the app is a stock grey.
 */
export const PALETTE = {
  // ── The carrier's brand ─────────────────────────────────────────────────────────────────
  navy: '#0A2144', // the wordmark
  cyan: '#00B2E3', // the trailer decal
  white: '#FFFFFF',

  // ── Night cab: the dark neutrals, navy-tinted ──────────────────────────────────────────
  night950: '#000000', // high-contrast dark canvas only
  night900: '#070D1A', // dark canvas
  night850: '#0B1424', // dark subtle surface
  night800: '#0F1A2E', // dark surface
  night750: '#1A2944', // dark raised / muted surface (≥10 red-channel steps above night800: tests/elevation.test.ts)
  night700: '#1F2E4A', // dark subtle edge
  night650: '#233452', // dark edge
  night600: '#3E5175', // dark strong edge
  night500: '#55667F', // dark disabled ink

  // ── Mist: light inks on the night ──────────────────────────────────────────────────────
  mist50: '#E8EDF5', // dark ink
  mist100: '#E1E7F0', // high-contrast dark secondary
  mist200: '#C3CDDB', // high-contrast dark muted
  mist300: '#A9B4C6', // dark secondary ink
  mist400: '#8E9BB0', // dark muted ink

  // ── Day steel: the light neutrals, navy-tinted ─────────────────────────────────────────
  steel25: '#F6F8FB', // light subtle surface
  steel50: '#EEF2F7', // light canvas ("Day steel")
  steel100: '#E6EBF2', // light muted surface / subtle edge
  steel200: '#D3DAE4', // light edge
  steel400: '#8E9AAD', // light strong edge / disabled ink
  slate600: '#56647B', // light muted ink
  slate700: '#3D4E6B', // light secondary ink
  slate800: '#24324D', // high-contrast light muted
  slate900: '#16233D', // high-contrast light secondary
  ink950: '#050F22', // high-contrast light ink

  // ── Navy hero family (the status block) ─────────────────────────────────────────────────
  heroNight: '#0E2550', // the navy block lifted off the dark canvas
  heroRaised: '#16305E',
  heroTile: '#1B3768',
  heroEdge: '#2A4372',
  heroInk2: '#BFD0EA', // secondary text on the navy block
  heroInk3: '#A3B6D3', // muted text on the navy block

  // ── Live (cyan as a state: the current load, the active stop, "sent") ───────────────────
  liveInkDay: '#006E8E', // cyan as TEXT on light grounds (the decal itself is 2.4:1 on white)
  liveInkHc: '#00536C',
  liveInkNightHc: '#5FD8F7',
  liveSoftDay: '#DDF2FA',
  liveSoftNight: '#0B2F45',

  // ── Act (amber: the driver must do something) ───────────────────────────────────────────
  amber: '#FFB020',
  amberPressed: '#E89A0C',
  amberHc: '#FFC857',
  actInkDay: '#8F5400',
  actInkHc: '#6B3F00',
  actSoftDay: '#FFF1D6',
  actSoftNight: '#3A2A08',

  // ── Stop (red: safety or compliance) ───────────────────────────────────────────────────
  redDay: '#B42B34',
  redHc: '#8E1820',
  redNight: '#FF7A7A',
  redNightHc: '#FFA3A3',
  redSoftDay: '#FBE3E4',
  redSoftNight: '#3F1A1E',

  // ── Done (green: complete, compliant) ──────────────────────────────────────────────────
  greenDay: '#1A7046',
  greenHc: '#0D5232',
  greenNight: '#3DD68C',
  greenNightHc: '#72E8B0',
  greenSoftDay: '#DDF2E7',
  greenSoftNight: '#0F3524',

  // ── Pressed brand fills ────────────────────────────────────────────────────────────────
  navyPressed: '#16305C',
  mistPressed: '#C3CFE0',
};

/**
 * One row per role: [light, dark, highContrastLight, highContrastDark], each a PALETTE key.
 * Role names are unchanged from Direction B so every screen re-values without an edit (plan §2);
 * the comments say what each role now MEANS under D-DV5, which is what a new screen should read.
 */
export const ROLES = {
  // Grounds
  canvas: ['steel50', 'night900', 'white', 'night950'],
  surface: ['white', 'night800', 'white', 'night850'],
  'surface-subtle': ['steel25', 'night850', 'steel25', 'night950'],
  'surface-muted': ['steel100', 'night750', 'steel100', 'night800'],
  'surface-raised': ['white', 'night750', 'white', 'night750'],
  'surface-selected': ['liveSoftDay', 'liveSoftNight', 'liveSoftDay', 'liveSoftNight'], // selection reads as "live"
  'surface-inverse': ['navy', 'mist50', 'ink950', 'white'],

  // Inks
  ink: ['navy', 'mist50', 'ink950', 'white'],
  'ink-secondary': ['slate700', 'mist300', 'slate900', 'mist100'],
  'ink-muted': ['slate600', 'mist400', 'slate800', 'mist200'],
  'ink-subtle': ['slate600', 'mist400', 'slate800', 'mist200'],
  'ink-disabled': ['steel400', 'night500', 'slate600', 'mist400'],
  'ink-inverse': ['white', 'night900', 'white', 'night950'],

  // Edges — used sparingly: D-DV7 separates by space, not by rules
  'edge-subtle': ['steel100', 'night700', 'steel400', 'night600'],
  edge: ['steel200', 'night650', 'slate600', 'mist400'],
  'edge-strong': ['steel400', 'night600', 'slate900', 'mist200'],
  'edge-focus': ['liveInkDay', 'cyan', 'liveInkHc', 'liveInkNightHc'],

  // Brand: the navy, as ink and as a secondary fill. On the night there is no readable navy, so the
  // role turns to mist — the brand is carried there by the navy status block (hero), not by text.
  brand: ['navy', 'mist50', 'ink950', 'white'],
  'brand-pressed': ['navyPressed', 'mistPressed', 'navy', 'mist100'],
  'brand-subtle': ['steel100', 'night750', 'steel100', 'night800'],
  'brand-fg': ['white', 'navy', 'white', 'navy'],

  // State inks (D-DV5): live = cyan, act = amber, stop = red, done = green. Nothing else is coloured.
  danger: ['redDay', 'redNight', 'redHc', 'redNightHc'],
  warning: ['actInkDay', 'amber', 'actInkHc', 'amberHc'],
  caution: ['actInkDay', 'amber', 'actInkHc', 'amberHc'],
  success: ['greenDay', 'greenNight', 'greenHc', 'greenNightHc'],
  info: ['liveInkDay', 'cyan', 'liveInkHc', 'liveInkNightHc'],
  'operation-current': ['liveInkDay', 'cyan', 'liveInkHc', 'liveInkNightHc'],
  'operation-next': ['slate700', 'mist300', 'slate900', 'mist100'],
  'operation-complete': ['greenDay', 'greenNight', 'greenHc', 'greenNightHc'],
  'operation-blocked': ['redDay', 'redNight', 'redHc', 'redNightHc'],
  'sync-local': ['slate600', 'mist400', 'slate800', 'mist200'],
  'sync-pending': ['actInkDay', 'amber', 'actInkHc', 'amberHc'],
  'sync-failed': ['redDay', 'redNight', 'redHc', 'redNightHc'],

  // The navy status block (D-DV6) and what may sit on it
  hero: ['navy', 'heroNight', 'navy', 'navy'],
  'hero-raised': ['heroRaised', 'heroRaised', 'heroRaised', 'heroRaised'],
  'hero-edge': ['heroEdge', 'heroEdge', 'heroEdge', 'heroEdge'],
  'hero-tile': ['heroTile', 'heroTile', 'heroTile', 'heroTile'],
  'on-hero': ['white', 'white', 'white', 'white'],
  'on-hero-secondary': ['heroInk2', 'heroInk2', 'heroInk2', 'heroInk2'],
  'on-hero-muted': ['heroInk3', 'heroInk3', 'heroInk2', 'heroInk2'],

  // Act: the one primary action, amber, in every appearance
  action: ['amber', 'amber', 'amber', 'amberHc'],
  'action-pressed': ['amberPressed', 'amberPressed', 'amberPressed', 'amber'],
  'action-fg': ['navy', 'navy', 'navy', 'navy'],
  'action-ink': ['actInkDay', 'amber', 'actInkHc', 'amberHc'],
  'action-soft': ['actSoftDay', 'actSoftNight', 'actSoftDay', 'actSoftNight'],

  // Live: the carrier cyan as a fill, its ink and its tint (was the lavender "accent")
  accent: ['cyan', 'cyan', 'cyan', 'liveInkNightHc'],
  'accent-ink': ['liveInkDay', 'cyan', 'liveInkHc', 'liveInkNightHc'],
  'accent-soft': ['liveSoftDay', 'liveSoftNight', 'liveSoftDay', 'liveSoftNight'],
  'success-soft': ['greenSoftDay', 'greenSoftNight', 'greenSoftDay', 'greenSoftNight'],
  'danger-soft': ['redSoftDay', 'redSoftNight', 'redSoftDay', 'redSoftNight'],
};

const THEMES = ['light', 'dark', 'highContrastLight', 'highContrastDark'];

function channels(hex) {
  const digits = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)).join(' ');
}

/** @returns {Record<string, Record<string, string>>} theme → role → "r g b" */
export function buildRoles() {
  /** @type {Record<string, Record<string, string>>} */
  const out = Object.fromEntries(THEMES.map((theme) => [theme, {}]));
  for (const [role, keys] of Object.entries(ROLES)) {
    if (keys.length !== THEMES.length) throw new Error(`${role} must name ${THEMES.length} palette colours`);
    keys.forEach((key, index) => {
      const hex = PALETTE[key];
      if (!hex) throw new Error(`${role} names "${key}", which is not in PALETTE`);
      out[THEMES[index]][role] = channels(hex);
    });
  }
  return out;
}

export function render() {
  return `${JSON.stringify(buildRoles(), null, 2)}\n`;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const next = render();
  if (process.argv.includes('--check')) {
    if (readFileSync(ROLES_PATH, 'utf8') !== next) {
      console.error('✗ theme.roles.json differs from scripts/gen-driver-roles.mjs — run `pnpm gen:roles`');
      process.exit(1);
    }
    console.log('✓ theme.roles.json matches the palette');
  } else {
    writeFileSync(ROLES_PATH, next);
    console.log(`✓ wrote theme.roles.json (${Object.keys(ROLES).length} roles × ${THEMES.length} themes)`);
  }
}

import type { roleColors } from './colors';

/**
 * Resolve an `Icon`'s colour from its `text-*` class.
 *
 * WHY THIS IS DERIVED RATHER THAN A SWITCH. It was a hand-written `switch` listing 19 of the
 * theme's ~50 roles, and anything it did not list fell through to `default: ink` — silently. On
 * 2026-09-07 that turned every icon in the navy tab bar invisible: `TabBar` passes `text-on-hero`
 * and `text-on-hero-muted`, neither was a case, so all four icons rendered in near-black ink on a
 * near-black navy bar. They were drawn correctly, in a colour nobody can see, and the tab bar looked
 * like it had no icons at all.
 *
 * A copy of a list that already exists is a copy with a delay fuse (root CLAUDE.md). The role names
 * live in `theme.roles.json` and reach here as the camelCase keys of `roleColors`, so the mapping is
 * a case conversion, not a table — every role works the day it is added, including the ones nobody
 * has used yet.
 */
export type RoleColors = (typeof roleColors)['light'];

/** The one token that is NOT a role: `text-brand-fg` means "the ink that sits on brand", which the
 *  palette calls `inkInverse`. Everything else is its own name. */
const ALIASES: Record<string, keyof RoleColors> = { 'brand-fg': 'inkInverse' };

/** `"px-2 text-on-hero-muted"` → `"on-hero-muted"`. */
export function tokenFromClassName(className: string | undefined): string | undefined {
  return /(?:^|\s)text-([a-z-]+)/.exec(className ?? '')?.[1];
}

/** `"on-hero-muted"` → `"onHeroMuted"`, which is how colors.ts names it. */
export function roleKeyForToken(token: string): string {
  return ALIASES[token] ?? token.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * @param onUnknown called when a `text-*` token names no role — the caller warns in development.
 *   Falling back silently is what hid the bug above for as long as it existed.
 */
export function resolveIconColor(
  className: string | undefined,
  explicit: string | undefined,
  colors: RoleColors,
  onUnknown?: (token: string) => void,
): string {
  if (explicit) return explicit;
  const token = tokenFromClassName(className);
  if (!token) return colors.ink;
  const value = (colors as unknown as Record<string, string | undefined>)[roleKeyForToken(token)];
  if (value) return value;
  onUnknown?.(token);
  return colors.ink;
}

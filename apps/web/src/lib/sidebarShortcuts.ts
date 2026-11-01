import type { NavGroup, NavItem } from "./nav";

/**
 * Pinned and Recent — the two blocks at the top of the sidebar (SIDEBAR-REDESIGN-PLAN.md D-SB2).
 *
 * ── Why they hold KEYS and resolve them against the sidebar every time ──────────────────────────
 * An admin's sidebar is 36 links in eight sections, about 2,000 px tall against ~800 px of window
 * (measured 2026-11-01), and every person uses perhaps five of them. Pinned is how a dispatcher stops
 * scrolling past Fuel, Safety and Fleet to reach the board; Recent is how anybody gets back to where
 * they just were.
 *
 * What is stored is a surface KEY, never a label or a path and never an item. A label changes (this
 * redesign renamed twelve), a path can redirect, and a stored item would carry yesterday's
 * permission: revoke Loads from a role and a pinned copy would still offer the link. Resolving the
 * stored keys against today's `buildNavGroups` output means a pin is only ever a pointer into the
 * sidebar the guard already agrees with — a key the caller can no longer reach simply drops out, and
 * comes back by itself if the grant does.
 */

/** Six fits above the fold beside a full Dispatch section; a seventh pin would push the list down. */
export const MAX_PINNED = 6;
/** Three is "where was I" — more than that and Recent becomes a second copy of the sidebar. */
export const MAX_RECENT = 3;
/** History kept beyond what is shown, so pins and the current page can be skipped and still leave three. */
const HISTORY_DEPTH = MAX_RECENT + MAX_PINNED + 1;

/** Every item the caller can reach, by key. Footer items (Settings, Users) can be pinned too. */
function itemsByKey(groups: readonly NavGroup[]): Map<string, NavItem> {
  return new Map(groups.flatMap((g) => g.items.map((i) => [i.key, i] as const)));
}

/** The stored keys as the caller's own sidebar items, in stored order; unreachable keys drop out. */
export function resolveKeys(groups: readonly NavGroup[], keys: readonly string[]): NavItem[] {
  const byKey = itemsByKey(groups);
  return keys.flatMap((k) => {
    const item = byKey.get(k);
    return item ? [item] : [];
  });
}

/**
 * Recent, as shown: the last pages visited, newest first, without the page you are on (you are
 * there) and without anything already pinned (it is one row above).
 */
export function recentItems(
  groups: readonly NavGroup[],
  history: readonly string[],
  pinned: readonly string[],
  currentKey: string | null,
): NavItem[] {
  const skip = new Set([...pinned, ...(currentKey ? [currentKey] : [])]);
  return resolveKeys(
    groups,
    history.filter((k) => !skip.has(k)),
  ).slice(0, MAX_RECENT);
}

/** A visit moves the key to the front; the list never repeats a key and never outgrows its depth. */
export function pushHistory(history: readonly string[], key: string): string[] {
  return [key, ...history.filter((k) => k !== key)].slice(0, HISTORY_DEPTH);
}

/**
 * Pin or unpin. A seventh pin is refused rather than evicting the oldest: silently dropping
 * something a person chose to keep is worse than asking them to choose — and the button says so
 * (`pinFull`) before they press it.
 */
export function togglePin(pinned: readonly string[], key: string): string[] {
  if (pinned.includes(key)) return pinned.filter((k) => k !== key);
  if (pinned.length >= MAX_PINNED) return [...pinned];
  return [...pinned, key];
}

/** The key of the sidebar item the current route stands under, by the shell's own `isCurrent`. */
export function currentItemKey(groups: readonly NavGroup[], isCurrent: (to: string) => boolean): string | null {
  for (const g of groups) for (const i of g.items) if (isCurrent(i.to)) return i.key;
  return null;
}

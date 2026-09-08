/**
 * The floating tab shell's rules and geometry (D-DB11), kept pure so `apps/driver/tests/tab-bar-model.test.ts`
 * can pin them. `TabBar.tsx` only draws what this file decides.
 *
 * The shell is a capsule inset from the screen edges, riding above the home indicator. The active
 * tab's icon rises out of the capsule on an apricot disc; a ring in the canvas colour sits behind
 * the disc so it reads as CUT OUT of the capsule rather than pasted on it. That ring is why the
 * shell reserves `rise` points of canvas above the capsule — the scene ends where that strip starts,
 * so nothing ever scrolls behind the notch and the illusion never breaks on a white card.
 */
export const shell = {
  /** Horizontal margin of the capsule; it floats, it does not dock. */
  inset: 16,
  /** Capsule height: 10 top + 24 icon box + 4 + 16 label + 6 bottom. */
  height: 60,
  /** The raised disc that carries the active icon. */
  disc: 52,
  /** The canvas-coloured ring behind the disc; 5pt of ring shows around it. */
  notch: 62,
  /** Where the icon box starts inside the capsule. */
  iconTop: 10,
  /** How far the notch protrudes above the capsule's top edge (its centre sits ON the edge). */
  get rise() {
    return this.notch / 2;
  },
} as const;

/**
 * Is this a tab expo-router was told to hide with `href: null`?
 *
 * NOT by reading `options.href`, which is what `TabBar` did until 2026-09-07 and which could never
 * work: expo-router CONSUMES `href`, and by the time options reach a custom tab bar the key is gone
 * entirely — replaced by the `tabBarItemStyle` + `tabBarButton` pair its own bar uses to hide an
 * item. Measured, not assumed: an enabled tab's options are `["headerShown","title"]` and a hidden
 * one's are `["headerShown","tabBarItemStyle","tabBarButton"]`.
 */
export function isHiddenTab(options: object | undefined): boolean {
  return options !== undefined && 'tabBarButton' in options;
}

export interface TabRouteLike {
  key: string;
  name: string;
}

/** The tabs that draw, in navigator order: known to the icon map, and not hidden by a feature flag. */
export function visibleTabs<R extends TabRouteLike>(
  routes: readonly R[],
  descriptors: Record<string, { options?: object } | undefined>,
  known: Record<string, unknown>,
): R[] {
  return routes.filter((route) => route.name in known && !isHiddenTab(descriptors[route.key]?.options));
}

/**
 * Which visible slot the disc sits over. The active route is normally one of the visible tabs; a
 * hidden Score route reached from More keeps More lit, because that is where the driver came from.
 * `-1` means no disc at all — a route that is neither visible nor Score-from-More.
 */
export function activeSlot<R extends TabRouteLike>(
  visible: readonly R[],
  active: R | undefined,
  activeIsHidden: boolean,
): number {
  if (!active) return -1;
  const direct = visible.findIndex((route) => route.key === active.key);
  if (direct >= 0) return direct;
  if (active.name === 'score' && activeIsHidden) return visible.findIndex((route) => route.name === 'more');
  return -1;
}

/** The disc's left edge for a slot: centred over the slot, whatever the slot's width. */
export function discOffset(index: number, slotWidth: number, size: number): number {
  return index * slotWidth + (slotWidth - size) / 2;
}

/** The capsule sits ON the home indicator's safe area, and never closer than 12pt to the edge. */
export function shellBottomMargin(insetBottom: number): number {
  return Math.max(insetBottom, 12);
}

/**
 * How much of the screen the floating shell occupies, bottom edge upward — the notch strip, the
 * capsule, and the margin it rides on.
 *
 * `Screen` needs this to keep the last row of a list clear of the capsule, and takes it from HERE
 * rather than from `BottomTabBarHeightContext`: since the shell became absolutely positioned (owner
 * ruling 2026-09-08) there is no guarantee the navigator measures it, and a silently-zero height
 * would put every list's final row under the bar with nothing to show for it. Both the bar and the
 * scene now read the same three numbers, so they cannot disagree about where the bar ends.
 */
export function shellHeight(insetBottom: number): number {
  return shell.rise + shell.height + shellBottomMargin(insetBottom);
}

/**
 * The capsule, with a circular hole punched where the active disc sits (owner ruling 2026-09-08:
 * "we should have that ring all the way around active button so we have that effect that button is
 * free floating in that place").
 *
 * A GENUINE hole, not a ring drawn on top. Three versions were tried on the device and only this one
 * is right: a canvas-coloured ring worked while the shell stood on an opaque canvas band and became
 * a cream blob the moment the shell went transparent; a capsule-coloured ring is just a dark blob;
 * and no ring at all leaves the disc pasted onto the bar. What the effect needs is to SEE THE PAGE
 * between the disc and the capsule, and nothing but a hole does that.
 *
 * Returned as an SVG path with two subpaths — the rounded capsule, then the circle — to be filled
 * with `fillRule="evenodd"`, which is what turns the second subpath into a hole rather than a
 * second blob. The circle's centre sits ON the capsule's top edge, so half of it bites into the
 * capsule and half is already open air.
 */
export function capsulePath(width: number, height: number, holeCentreX: number, holeRadius: number): string {
  const r = height / 2;
  const capsule = [
    `M ${r} 0`,
    `L ${width - r} 0`,
    `A ${r} ${r} 0 0 1 ${width - r} ${height}`,
    `L ${r} ${height}`,
    `A ${r} ${r} 0 0 1 ${r} 0`,
    'Z',
  ].join(' ');
  // Drawn as two arcs so it closes cleanly; direction does not matter under evenodd.
  const hole = [
    `M ${holeCentreX - holeRadius} 0`,
    `a ${holeRadius} ${holeRadius} 0 1 0 ${holeRadius * 2} 0`,
    `a ${holeRadius} ${holeRadius} 0 1 0 ${-holeRadius * 2} 0`,
    'Z',
  ].join(' ');
  return `${capsule} ${hole}`;
}

/**
 * The unread count on a tab, as it reads: nothing for zero, the number to nine, then `9+` so the
 * badge never widens into the neighbouring slot. Strings pass through — expo-router allows them.
 */
export function badgeLabel(badge: number | string | undefined): string | null {
  if (badge === undefined || badge === null) return null;
  if (typeof badge === 'string') return badge.length > 0 ? badge : null;
  if (!Number.isFinite(badge) || badge <= 0) return null;
  return badge > 9 ? '9+' : String(Math.floor(badge));
}

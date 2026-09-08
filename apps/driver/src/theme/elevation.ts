import { roleColors, type ThemeKey } from './colors';

/**
 * ELEVATION IS TWO STEPS, AND IT IS NOT ALWAYS A SHADOW (D-DB19, owner ruling 2026-09-07,
 * amending D-DB5).
 *
 * D-DB5 said the app has exactly one card shadow and that content surfaces otherwise cast none. The
 * result, measured on the running app, is that a card the driver can TAP and a card that merely
 * holds text are the same object: same fill, same corner, same nothing underneath. On the cream
 * sheet that reads as a page of rectangles, which is the "flat and amateur" the owner named.
 *
 * So there are two steps — `resting` and `raised` — and the ruling that survives from D-DB5 is the
 * important half: a driver may not be shown a fifth kind of depth. Two steps, no more, and neither
 * is available as a Tailwind utility (`lint:design` still bans the `shadow-*` scale and still bans
 * `shadowColor` outside this directory).
 *
 * The step is expressed differently per appearance because the grounds are different, and this is
 * measured, not stylistic:
 *
 * - LIGHT and HIGH-CONTRAST LIGHT — `surface` and `surface-raised` are BOTH pure white (255 255 255).
 *   There is no lighter surface to climb to, so the step has to be cast: a soft offset shadow tinted
 *   with the hero navy, never a neutral black, which reads as grime on a warm ground.
 * - DARK and HIGH-CONTRAST DARK — a cast shadow on a near-black ground (canvas is 19 23 32, and 0 0 0
 *   in high contrast) is invisible; rendering one is a cost with no picture. There the surface value
 *   IS the step: `surface` → `surface-raised` is +10 in each channel, with the edge stepping
 *   `edge-subtle` → `edge` alongside it, which is how a dark UI has always shown height.
 *
 * `Card` picks the step from whether it is interactive rather than from a prop at each call site, so
 * "tappable things sit higher" cannot drift into a per-screen opinion.
 */
export type ElevationStep = 'resting' | 'raised';

/** Whether this appearance shows height by casting or by climbing. See the note above. */
export function castsShadow(themeKey: ThemeKey): boolean {
  return themeKey === 'light' || themeKey === 'highContrastLight';
}

/**
 * The cast step, for the appearances that have somewhere to cast onto.
 *
 * `resting` is unchanged from D-DB10's softening: 12% at 10pt read as a hard block under a white
 * card on the cream sheet, and 8% at 8pt is a card resting rather than floating. `raised` is
 * deliberately not much heavier — it is a card lifted a few points, not a dialog — because two steps
 * a driver cannot tell apart are one step with extra code, and two steps he reads as "modal" are a
 * different component.
 */
export function cardElevation(themeKey: ThemeKey, step: ElevationStep = 'resting') {
  if (!castsShadow(themeKey)) return undefined;
  const resting = step === 'resting';
  return {
    shadowColor: roleColors[themeKey].hero,
    shadowOpacity: resting ? 0.14 : 0.20,
    shadowRadius: resting ? 14 : 20,
    shadowOffset: { width: 0, height: resting ? 5 : 9 },
    elevation: resting ? 4 : 8,
  } as const;
}

/**
 * The climbed step, for the appearances a shadow cannot reach. Returned as class names because the
 * surface and the edge are both theme roles, and naming them here keeps the two expressions of one
 * idea in one file rather than in a conditional inside `Card`.
 */
export function cardSurfaceClass(themeKey: ThemeKey, step: ElevationStep = 'resting'): string {
  if (castsShadow(themeKey)) return 'bg-surface';
  return step === 'raised'
    ? 'border border-edge bg-surface-raised'
    : 'border border-edge-subtle bg-surface';
}

/**
 * The SECOND shadow, and the last (D-DB11, 2026-09-07). The tab shell floats above the sheet on
 * the home indicator, and a capsule with no shadow there is a dark bar painted on the page. It is
 * heavier than a card's because it is further from the ground and must hold against scrolled
 * content passing under it. D-DB5's "nothing else casts a shadow" now reads: cards and the shell.
 */
export function shellElevation(themeKey: ThemeKey) {
  return {
    shadowColor: roleColors[themeKey].hero,
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  } as const;
}

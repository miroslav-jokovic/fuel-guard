import { roleColors, type ThemeKey } from './colors';

/**
 * The ONE shadow in the app (Direction B D-DB5). Cards on the light sheet carry a single soft offset
 * shadow tinted with the hero navy — never a neutral black, which reads as grime on a coloured
 * ground. Hero cards carry a 1px `hero-edge` border and no shadow; nothing else casts one.
 *
 * The Tailwind shadow utility scale stays banned by `lint:design`, and that gate also bans
 * `shadowColor` outside `src/theme/` so this helper cannot be bypassed by a local style object.
 */
export function cardElevation(themeKey: ThemeKey) {
  return {
    shadowColor: roleColors[themeKey].hero,
    // Softened 2026-09-07 with the cream sheet (D-DB10): 12% at 10pt offset read as a hard block
    // under a white card on a warm ground; 8% at 8pt is a card resting, not floating.
    shadowOpacity: 0.08,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  } as const;
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

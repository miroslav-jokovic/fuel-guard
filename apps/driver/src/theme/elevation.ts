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
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  } as const;
}

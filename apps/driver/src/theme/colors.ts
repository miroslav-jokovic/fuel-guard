import roleValues from './theme.roles.json';

/**
 * Semantic color source (Direction B §2.1–2.2).
 *
 * `theme.roles.json` is authoritative. NativeWind variables and native-API color strings are both
 * derived here so an icon, spinner, SVG, and class-based surface cannot drift into parallel themes.
 * `global.css` is the generated web mirror (`pnpm gen:theme`) and `lint:theme` verifies every
 * declaration.
 */
export type ThemeKey = keyof typeof roleValues;
export type ThemeRole = keyof (typeof roleValues)['light'];

type RoleMap = Record<ThemeRole, string>;
type ThemeVariables = Record<`--color-${ThemeRole}`, string>;

function toVariables(roles: RoleMap): ThemeVariables {
  return Object.fromEntries(
    Object.entries(roles).map(([role, value]) => [`--color-${role}`, value]),
  ) as ThemeVariables;
}

function rgb(value: string): string {
  return `rgb(${value.split(' ').join(', ')})`;
}

function nativeColors(theme: ThemeKey) {
  const roles = roleValues[theme];
  return {
    brand: rgb(roles.brand),
    brandPressed: rgb(roles['brand-pressed']),
    brandSubtle: rgb(roles['brand-subtle']),
    ink: rgb(roles.ink),
    inkSecondary: rgb(roles['ink-secondary']),
    inkMuted: rgb(roles['ink-muted']),
    inkSubtle: rgb(roles['ink-subtle']),
    inkInverse: rgb(roles['ink-inverse']),
    surface: rgb(roles.surface),
    surfaceMuted: rgb(roles['surface-muted']),
    surfaceRaised: rgb(roles['surface-raised']),
    edge: rgb(roles.edge),
    edgeStrong: rgb(roles['edge-strong']),
    danger: rgb(roles.danger),
    warning: rgb(roles.warning),
    caution: rgb(roles.caution),
    success: rgb(roles.success),
    info: rgb(roles.info),
    operationCurrent: rgb(roles['operation-current']),
    operationNext: rgb(roles['operation-next']),
    operationComplete: rgb(roles['operation-complete']),
    operationBlocked: rgb(roles['operation-blocked']),
    syncLocal: rgb(roles['sync-local']),
    syncPending: rgb(roles['sync-pending']),
    syncFailed: rgb(roles['sync-failed']),
    // Direction B: the navy hero region, the amber action colour and the lavender secondary.
    // `canvas` joins the native list because the map fallback and the trend chart paint it.
    canvas: rgb(roles.canvas),
    hero: rgb(roles.hero),
    heroRaised: rgb(roles['hero-raised']),
    heroEdge: rgb(roles['hero-edge']),
    heroTile: rgb(roles['hero-tile']),
    onHero: rgb(roles['on-hero']),
    onHeroSecondary: rgb(roles['on-hero-secondary']),
    onHeroMuted: rgb(roles['on-hero-muted']),
    action: rgb(roles.action),
    actionPressed: rgb(roles['action-pressed']),
    actionFg: rgb(roles['action-fg']),
    actionInk: rgb(roles['action-ink']),
    actionSoft: rgb(roles['action-soft']),
    accent: rgb(roles.accent),
    accentInk: rgb(roles['accent-ink']),
    accentSoft: rgb(roles['accent-soft']),
    successSoft: rgb(roles['success-soft']),
    dangerSoft: rgb(roles['danger-soft']),
  } as const;
}

export const themeVars = {
  light: toVariables(roleValues.light),
  dark: toVariables(roleValues.dark),
  highContrastLight: toVariables(roleValues.highContrastLight),
  highContrastDark: toVariables(roleValues.highContrastDark),
} as const;

export const roleColors = {
  light: nativeColors('light'),
  dark: nativeColors('dark'),
  highContrastLight: nativeColors('highContrastLight'),
  highContrastDark: nativeColors('highContrastDark'),
} as const;

export { roleValues };

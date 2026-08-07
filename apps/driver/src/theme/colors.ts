import roleValues from './theme.roles.json';

/**
 * Design System 2.0 semantic color source.
 *
 * `theme.roles.json` is authoritative. NativeWind variables and native-API color strings are both
 * derived here so an icon, spinner, SVG, and class-based surface cannot drift into parallel themes.
 * `global.css` is the generated/fallback web mirror and `lint:theme` verifies every declaration.
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

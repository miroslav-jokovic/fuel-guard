import { Text, type TextProps, type TextStyle } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';

export type TextVariant =
  | 'caption'
  | 'label'
  | 'supporting'
  | 'body'
  | 'rowTitle'
  | 'action'
  | 'navigationTitle'
  | 'sectionTitle'
  | 'screenTitle'
  | 'numericInline'
  | 'numericCompact'
  | 'numericHero';

export type TextTone =
  | 'primary'
  | 'secondary'
  | 'muted'
  | 'subtle'
  | 'disabled'
  | 'inverse'
  | 'brand'
  | 'danger'
  | 'warning'
  | 'caution'
  | 'success'
  | 'info'
  | 'action'
  | 'accent'
  | 'onHero'
  | 'onHeroSecondary'
  | 'onHeroMuted';

/**
 * Weight is the family in React Native: a Tailwind weight utility does nothing to a loaded custom
 * face, so the variant names one of the four Lexend families outright (Direction B §2.3). Keeping the family and
 * the size in separate maps means Bold Text swaps ONE class rather than appending a second
 * `font-*` whose precedence would depend on stylesheet order.
 */
const FAMILY: Record<TextVariant, string> = {
  caption: 'font-ui',
  label: 'font-ui-md',
  supporting: 'font-ui',
  body: 'font-ui',
  rowTitle: 'font-ui-md',
  action: 'font-ui-sb',
  navigationTitle: 'font-ui-sb',
  sectionTitle: 'font-ui-sb',
  screenTitle: 'font-ui-sb',
  numericInline: 'font-ui-sb',
  numericCompact: 'font-ui-sb',
  numericHero: 'font-ui-sb',
};

/** Bold Text steps every variant one weight up: 400→500, 500→600, 600→700. 700 has nowhere to go. */
const FAMILY_BOLD: Record<TextVariant, string> = {
  caption: 'font-ui-md',
  label: 'font-ui-sb',
  supporting: 'font-ui-md',
  body: 'font-ui-md',
  rowTitle: 'font-ui-sb',
  action: 'font-ui-bold',
  navigationTitle: 'font-ui-bold',
  sectionTitle: 'font-ui-bold',
  screenTitle: 'font-ui-bold',
  numericInline: 'font-ui-bold',
  numericCompact: 'font-ui-bold',
  numericHero: 'font-ui-bold',
};

const SIZE: Record<TextVariant, string> = {
  caption: 'text-caption',
  label: 'text-label uppercase',
  supporting: 'text-supporting',
  body: 'text-body',
  rowTitle: 'text-rowTitle',
  action: 'text-action',
  navigationTitle: 'text-navigationTitle',
  sectionTitle: 'text-section-title',
  screenTitle: 'text-screenTitle',
  numericInline: 'text-numericInline',
  numericCompact: 'text-numericCompact',
  numericHero: 'text-numericHero',
};

/** Figures a driver reads at a glance never jitter: the numeric variants are tabular by definition. */
const ALWAYS_TABULAR: readonly TextVariant[] = ['numericInline', 'numericCompact', 'numericHero'];

const TONE: Record<TextTone, string> = {
  primary: 'text-ink',
  secondary: 'text-ink-secondary',
  muted: 'text-ink-muted',
  subtle: 'text-ink-subtle',
  disabled: 'text-ink-disabled',
  inverse: 'text-ink-inverse',
  brand: 'text-brand',
  danger: 'text-danger',
  warning: 'text-warning',
  caution: 'text-caution',
  success: 'text-success',
  info: 'text-info',
  action: 'text-action-ink',
  accent: 'text-accent-ink',
  onHero: 'text-on-hero',
  onHeroSecondary: 'text-on-hero-secondary',
  onHeroMuted: 'text-on-hero-muted',
};

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  tone?: TextTone;
  tabular?: boolean;
  className?: string;
}

/**
 * Semantic, Dynamic-Type-safe text. One typeface — Lexend — in four weights (D-DB3); the `action`
 * and `accent` tones are the amber and lavender *text* roles, never the fills. No default max
 * multiplier is imposed: layouts must adapt to the driver's selected content size instead of
 * silently capping it.
 */
export function AppText({
  variant = 'body',
  tone = 'primary',
  tabular = false,
  className = '',
  style,
  allowFontScaling = true,
  ...props
}: AppTextProps) {
  const { boldText } = useTheme();
  const numericStyle: TextStyle | undefined =
    tabular || ALWAYS_TABULAR.includes(variant) ? { fontVariant: ['tabular-nums'] } : undefined;
  const family = boldText ? FAMILY_BOLD[variant] : FAMILY[variant];

  return (
    <Text
      {...props}
      allowFontScaling={allowFontScaling}
      className={`${family} ${SIZE[variant]} ${TONE[tone]} ${className}`.trim()}
      style={[numericStyle, style]}
    />
  );
}

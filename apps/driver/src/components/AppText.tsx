import { Text, type TextProps, type TextStyle } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';

export type TextVariant =
  | 'caption'
  | 'supporting'
  | 'body'
  | 'action'
  | 'navigationTitle'
  | 'rowTitle'
  | 'sectionTitle'
  | 'screenTitle'
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
  | 'success'
  | 'info';

const VARIANT: Record<TextVariant, string> = {
  caption: 'font-ui text-caption',
  supporting: 'font-ui text-supporting',
  body: 'font-ui text-body',
  action: 'font-ui text-action font-semibold',
  navigationTitle: 'font-ui text-nav font-semibold',
  rowTitle: 'font-ui text-body font-medium',
  sectionTitle: 'font-ui text-section-title font-semibold',
  screenTitle: 'font-display-bold text-screen-title',
  numericCompact: 'font-display-sb text-numeric-compact',
  numericHero: 'font-display-bold text-numeric-hero',
};

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
  success: 'text-success',
  info: 'text-info',
};

const BOLD_TEXT_VARIANT: Record<TextVariant, string> = {
  caption: 'font-medium',
  supporting: 'font-medium',
  body: 'font-medium',
  action: 'font-bold',
  navigationTitle: 'font-bold',
  rowTitle: 'font-semibold',
  sectionTitle: 'font-bold',
  screenTitle: '',
  numericCompact: 'font-display-bold',
  numericHero: '',
};

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  tone?: TextTone;
  tabular?: boolean;
  className?: string;
}

/**
 * Semantic, Dynamic-Type-safe text. Operational text uses the platform UI face; Hanken Grotesk is
 * reserved for screen identity and numeric/display moments. No default max multiplier is imposed:
 * layouts must adapt to the driver's selected content size instead of silently capping it.
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
  const numericStyle: TextStyle | undefined = tabular ? { fontVariant: ['tabular-nums'] } : undefined;

  return (
    <Text
      {...props}
      allowFontScaling={allowFontScaling}
      className={`${VARIANT[variant]} ${boldText ? BOLD_TEXT_VARIANT[variant] : ''} ${TONE[tone]} ${className}`.trim()}
      style={[numericStyle, style]}
    />
  );
}

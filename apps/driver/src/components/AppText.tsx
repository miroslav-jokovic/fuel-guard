import { Text, type TextProps } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { TEXT_TONE_CLASS, type TextTone } from '@/theme/textTone';
import { textStyle, type TextVariant, type TextWeight } from '@/theme/typography';

export { TEXT_TONE_CLASS, type TextTone };
export type { TextVariant, TextWeight };

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  tone?: TextTone;
  /** Raise the variant's weight for emphasis — the only way to change weight (lint:design). */
  weight?: TextWeight;
  /** Tabular figures on a variant that is not tabular by definition (numeric variants always are). */
  tabular?: boolean;
  className?: string;
}

/**
 * Semantic, Dynamic-Type-safe text. Face, size, weight and figure style come from
 * `src/theme/typography.ts` (D-DV8, D-DV15); colour comes from `tone` (D-DV5). `className` is for
 * layout only — a font or colour class here is refused by `lint:design`, because a second class
 * setting the same property is resolved by stylesheet order, not by what the call site wrote.
 * No default max multiplier is imposed: layouts adapt to the driver's text size (D-DV9).
 */
export function AppText({
  variant = 'body',
  tone = 'primary',
  weight,
  tabular = false,
  className = '',
  style,
  allowFontScaling = true,
  ...props
}: AppTextProps) {
  const { boldText } = useTheme();
  return (
    <Text
      {...props}
      allowFontScaling={allowFontScaling}
      className={`${TEXT_TONE_CLASS[tone]} ${className}`.trim()}
      style={[textStyle(variant, { boldText, weight, tabular }), style]}
    />
  );
}

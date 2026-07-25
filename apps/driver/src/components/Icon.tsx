import { Text, type StyleProp, type TextStyle } from 'react-native';
import { MATERIAL_SYMBOLS, type MaterialSymbolName } from '@/theme/materialSymbols.generated';

// Material Symbols — Rounded/Outlined, weight 200, grade 200, opsz 24 baked into the fonts (see
// scripts/gen-material-symbols.mjs). Color comes from a token `className` (e.g. "text-ink-muted");
// the `color` prop is only for runtime nav tints. Never pass hex.
const FAMILY = {
  rounded: { outline: 'MaterialSymbolsRounded', fill: 'MaterialSymbolsRoundedFill' },
  outlined: { outline: 'MaterialSymbolsOutlined', fill: 'MaterialSymbolsOutlinedFill' },
} as const;

export type IconProps = {
  name: MaterialSymbolName;
  size?: number;
  variant?: 'rounded' | 'outlined';
  fill?: boolean;
  className?: string;
  color?: string;
  style?: StyleProp<TextStyle>;
};

export function Icon({ name, size = 24, variant = 'rounded', fill = false, className, color, style }: IconProps) {
  const family = FAMILY[variant][fill ? 'fill' : 'outline'];
  return (
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no"
      suppressHighlighting
      className={className}
      style={[{ fontFamily: family, fontSize: size, lineHeight: size, textAlign: 'center' }, color ? { color } : null, style]}
    >
      {String.fromCodePoint(MATERIAL_SYMBOLS[name])}
    </Text>
  );
}

import { Text, type StyleProp, type TextStyle } from 'react-native';
import { MATERIAL_SYMBOLS, type MaterialSymbolName } from '@/theme/materialSymbols.generated';

// Material Symbols — Rounded/Outlined, weight 200, grade 200, opsz 24 baked into the fonts (see
// scripts/gen-material-symbols.py). Color comes from a token `className` (e.g. "text-ink-muted");
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

export function Icon({
  name,
  size = 24,
  variant = 'rounded',
  fill = false,
  className,
  color,
  style,
}: IconProps) {
  const family = FAMILY[variant][fill ? 'fill' : 'outline'];
  return (
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no"
      suppressHighlighting
      allowFontScaling={false}
      className={className}
      // Box the glyph in an exact size×size square and kill Android font padding so it sits dead
      // center inside flex rows (buttons, list rows, banners, tabs) on both platforms.
      style={[
        {
          fontFamily: family,
          fontSize: size,
          lineHeight: size,
          width: size,
          height: size,
          textAlign: 'center',
          textAlignVertical: 'center',
          includeFontPadding: false,
        },
        color ? { color } : null,
        style,
      ]}
    >
      {String.fromCodePoint(MATERIAL_SYMBOLS[name])}
    </Text>
  );
}

import { Platform, Text, type StyleProp, type TextStyle } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { roleColors } from '@/theme/colors';
import { iconGlyph } from '@/theme/iconFont';
import { sfGlyph } from '@/theme/sfSymbols';
import { resolveIconColor } from '@/theme/iconColor';
import { useTheme } from '@/theme/ThemeProvider';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

export type IconName = MaterialSymbolName;

export interface IconProps {
  /** A Material Symbol name; it is the glyph drawn (`src/theme/iconFont.ts`). */
  name: IconName;
  size?: number;
  /** The filled cut, for a selected or affirmative state. */
  fill?: boolean;
  className?: string;
  color?: string;
  style?: StyleProp<TextStyle>;
}

function colorFor(
  className: string | undefined,
  explicit: string | undefined,
  themeKey: keyof typeof roleColors,
): string {
  return resolveIconColor(className, explicit, roleColors[themeKey], (token) => {
    if (__DEV__) {
      console.warn(
        `[Icon] "text-${token}" names no colour role, so this icon fell back to ink. ` +
          'That is invisible on a dark surface — see src/theme/iconColor.ts.',
      );
    }
  });
}

/**
 * One icon in its state colour, in the platform's own family (Visual 2026 D-DV11): an SF Symbol on
 * iOS (V9, `sfSymbols.ts`), a Material Symbols glyph from the bundled font elsewhere (V8). Call sites
 * name the Material Symbol on both. The colour is resolved from the `text-*` class to a literal value,
 * as before, so a class naming no role is caught (`iconColor.ts`).
 *
 * An icon is decoration to assistive tech: the control it sits in carries the label. It does not
 * scale with the phone's text size, as the SVG it replaced did not, because the rows and buttons
 * around it already grow (D-DV9) and a glyph that grew would push their text out of line.
 *
 * Raw `Text` is allowed in this one file besides `AppText` (`check-driver-design.mjs`): a glyph is not
 * text, and `AppText`'s variants would give it a line height and a face it must not have.
 */
export function Icon({ name, size = 24, fill = false, className, color, style }: IconProps) {
  const { themeKey } = useTheme();
  const tint = colorFor(className, color, themeKey);
  if (Platform.OS === 'ios') {
    return (
      <SymbolView
        name={sfGlyph(name, fill)}
        size={size}
        tintColor={tint}
        weight="regular"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no"
        // The symbol's box is the icon's box, as the glyph's is: callers lay it out by `size`.
        style={[{ width: size, height: size }, style]}
      />
    );
  }
  const { glyph, style: glyphStyle } = iconGlyph(name, fill, size);
  return (
    <Text
      allowFontScaling={false}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[glyphStyle, { color: tint }, style]}
    >
      {glyph}
    </Text>
  );
}

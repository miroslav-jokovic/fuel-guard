import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { haptics } from '@/lib/haptics';
import { cardElevation } from '@/theme/elevation';
import { useTheme } from '@/theme/ThemeProvider';
import { layout } from '@/theme/tokens';

/**
 * A 24pt container in one of three registers (D-DB1, D-DB5):
 *
 * - `sheet` — the default. White on the light canvas, carrying the app's ONE shadow: a soft offset
 *   tinted with the hero navy, never a neutral black, which reads as grime on a coloured ground.
 * - `hero` — a card sitting ON the navy. A shadow is invisible there, so containment comes from a
 *   1px translucent edge instead, and the padding opens up to 20.
 * - `flat` — no shadow and no edge, for a card that groups rows inside an already-contained region.
 *
 * Pass `onPress` to make the whole card a target with press feedback.
 */
export function Card({
  children,
  onPress,
  padded = true,
  variant = 'sheet',
}: {
  children: ReactNode;
  onPress?: () => void;
  padded?: boolean;
  variant?: 'sheet' | 'hero' | 'flat';
}) {
  const { themeKey } = useTheme();
  const surface = {
    sheet: 'rounded-xl bg-surface',
    hero: 'rounded-xl border border-hero-edge bg-hero-raised',
    flat: 'rounded-xl bg-surface',
  }[variant];
  const padding = padded
    ? { padding: variant === 'hero' ? layout.cardPadding : layout.sheetCardPadding, gap: 8 }
    : undefined;
  const elevation = variant === 'sheet' ? cardElevation(themeKey) : undefined;
  const style = [padding, elevation];

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          haptics.select();
          onPress();
        }}
        className={`${surface} ${variant === 'hero' ? 'active:bg-hero-tile' : 'active:bg-surface-selected'}`}
        style={style}
      >
        {children}
      </Pressable>
    );
  }
  return <View className={surface} style={style}>{children}</View>;
}

import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { haptics } from '@/lib/haptics';
import { cardElevation, cardSurfaceClass, heroCardSurfaceClass, type ElevationStep } from '@/theme/elevation';
import { useTheme } from '@/theme/ThemeProvider';
import { layout } from '@/theme/tokens';

type Variant = 'sheet' | 'hero';

/**
 * A 24pt container, flat colour, in one of two registers.
 *
 * - `sheet` is the surface colour with the app's one card shadow in light. In dark, a hairline edge
 *   replaces the shadow, which a near-black ground swallows.
 * - `hero` is a card on the navy: the raised navy step with its edge.
 *
 * **Visual 2026 restricts where a card belongs (D-DV7).** Rows are not carded; they sit on the canvas
 * in a `GroupedList`. A raised surface is for a screen's one signature block (`StatusBlock`), a
 * `NextStep`, or an independent object such as a captured-document preview. Screens that still wrap
 * rows in a Card move off it in their own step (V5–V8). Do not add a new one.
 *
 * The SVG wash that "lit" every card (D-DB16) is gone in V4: a gradient on a container is on
 * D-DV14's banned list, and the approved mock is flat colour throughout.
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
  variant?: Variant;
}) {
  const { themeKey } = useTheme();
  /** D-DB19: a card the driver can tap sits higher than one that only holds text. */
  const step: ElevationStep = onPress ? 'raised' : 'resting';
  const surface = {
    sheet: `overflow-hidden rounded-xl ${cardSurfaceClass(themeKey, step)}`,
    hero: `overflow-hidden rounded-xl ${heroCardSurfaceClass()}`,
  }[variant];
  const padding = padded
    ? { padding: variant === 'hero' ? layout.cardPadding : layout.sheetCardPadding, gap: 8 }
    : undefined;
  const elevation = variant === 'sheet' ? cardElevation(themeKey, step) : undefined;

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          haptics.select();
          onPress();
        }}
        className={`${surface} ${variant === 'hero' ? 'active:bg-hero-tile' : 'active:bg-surface-selected'}`}
        style={[elevation, padding]}
      >
        {children}
      </Pressable>
    );
  }
  return <View className={surface} style={[elevation, padding]}>{children}</View>;
}

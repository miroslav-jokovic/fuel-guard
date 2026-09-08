import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { haptics } from '@/lib/haptics';
import { roleColors } from '@/theme/colors';
import { cardElevation, cardSurfaceClass, type ElevationStep } from '@/theme/elevation';
import { useTheme } from '@/theme/ThemeProvider';
import { layout } from '@/theme/tokens';

type Variant = 'sheet' | 'hero';

/**
 * A 24pt container in one of three registers (D-DB1, D-DB5, D-DB16):
 *
 * - `sheet` — the default. The surface colour carrying the app's ONE card shadow, a soft offset
 *   tinted with the hero navy, and a faint top-to-bottom wash so the card reads as a lit object
 *   rather than a flat rectangle. In the dark appearances the wash runs the other way (lighter at
 *   the top) and a hairline `edge-subtle` replaces the shadow, which a near-black ground swallows.
 * - `hero` — a card sitting ON the navy. A shadow is invisible there, so containment comes from a
 *   1px translucent edge and a wash toward the hero colour at the foot; the padding opens up to 20.
 * There was a third, `flat` — no shadow, no edge, no wash — documented as "a container for rows
 * inside an already-contained region". On 2026-09-07 it was carrying **32 of the app's 49 cards**,
 * and NOT ONE of them was nested inside another card: every single use was a top-level card on the
 * sheet that had simply opted out of depth. The variant described a case this app does not have,
 * while two thirds of the surface rendered as flat rectangles — which is the substance of the
 * owner's "it looks sloppy and amateur". It is gone; if a genuinely nested card ever appears, the
 * depth should be derived from the nesting, never chosen again at the call site.
 *
 * The wash is an SVG gradient rather than a native gradient view: react-native-svg is already in
 * the binary, and `expo-linear-gradient` would have been a native module added for one effect —
 * a rebuild on every lane for a tint. It is drawn as an overlay whose alpha runs from 0 to 1, over a
 * solid base, so a pressed card still shows its pressed colour underneath.
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
  const { themeKey, isDark } = useTheme();
  const rc = roleColors[themeKey];
  /**
   * D-DB19: a card the driver can tap sits higher than one that only holds text. Derived from
   * `onPress` rather than taken as a prop, so the rule is the same on every screen and cannot become
   * a per-call-site opinion. `flat` opts out entirely — it groups rows inside something already
   * contained, and a raised card inside a raised card is noise.
   */
  const step: ElevationStep = onPress ? 'raised' : 'resting';
  const surface = {
    sheet: `rounded-xl ${cardSurfaceClass(themeKey, step)}`,
    hero: 'rounded-xl border border-hero-edge bg-hero-raised',
  }[variant];
  const padding = padded
    ? { padding: variant === 'hero' ? layout.cardPadding : layout.sheetCardPadding, gap: 8 }
    : undefined;
  const elevation = variant === 'sheet' ? cardElevation(themeKey, step) : undefined;

  // The wash: which colour, and which way it runs. Light sheet cards darken toward the foot by a
  // hair (white → the subtle surface); dark ones lighten at the head (the raised surface over the
  // card); hero cards sink toward the hero colour at the foot.
  const wash =
    variant === 'sheet'
      ? isDark
        ? { color: rc.surfaceRaised, top: 1, bottom: 0 }
        : { color: rc.surfaceMuted, top: 0, bottom: 0.9 }
      : variant === 'hero'
        ? { color: rc.hero, top: 0, bottom: 0.55 }
        : null;

  // Sized from the measured box rather than percentages: react-native-svg resolves a percentage
  // root size against its own parent, which is fine, but a Rect's percentage is resolved against
  // the Svg's viewBox, which this Svg does not have — numeric sizes leave nothing to interpret.
  const [box, setBox] = useState({ width: 0, height: 0 });
  const inner = (
    <View
      className="overflow-hidden rounded-xl"
      style={padding}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        if (width !== box.width || height !== box.height) setBox({ width, height });
      }}
    >
      {wash && box.width > 0 && box.height > 0 ? (
        <Svg
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0 }}
          width={box.width}
          height={box.height}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          <Defs>
            <LinearGradient id="wash" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={wash.color} stopOpacity={wash.top} />
              <Stop offset="1" stopColor={wash.color} stopOpacity={wash.bottom} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width={box.width} height={box.height} fill="url(#wash)" />
        </Svg>
      ) : null}
      {children}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          haptics.select();
          onPress();
        }}
        className={`${surface} ${variant === 'hero' ? 'active:bg-hero-tile' : 'active:bg-surface-selected'}`}
        style={elevation}
      >
        {inner}
      </Pressable>
    );
  }
  return <View className={surface} style={elevation}>{inner}</View>;
}

import { Image, StyleSheet, View } from 'react-native';
import heroTexture from '../../assets/hero-band.webp';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { roleColors } from '@/theme/colors';
import { heroTextureOpacity } from '@/theme/heroTexture';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Atmosphere behind the navy hero (D-DB20).
 *
 * The hero was a flat slab of one colour. The owner's reference artwork is the same navy and the
 * same amber the palette already holds — measured against `theme.roles.json` on 2026-09-08, the art
 * sits at rgb(25,37,52) against `hero`'s rgb(32,40,58), and its amber at rgb(244,180,113) against
 * `action`'s rgb(242,178,103) — so nothing here repaints the theme. What the art has and a slab does
 * not is depth: contour lines, a road, a network, and light falling across it.
 *
 * Three rules keep it from costing anything:
 *
 * 1. It is DECORATIVE. Hidden from the accessibility tree, and no information is ever carried here.
 * 2. It is held far enough back that `on-hero` text keeps its contrast. The opacity is per
 *    appearance, not one number: the art is a mid navy, so on the LIGHT hero (32 40 58) it darkens
 *    and on the DARK hero (15 18 25) it lightens, and the dark case is the one that eats a white
 *    foreground's margin. Both are asserted by 'the hero backdrop cannot cost on-hero its contrast'.
 * 3. HIGH CONTRAST turns it off completely. A decorative texture is precisely what that setting
 *    exists to remove, and it would spend the margin the setting exists to create.
 *
 * The scrim underneath is the other half: it runs to solid `hero` at the foot so the light sheet
 * always meets flat colour, never a road in mid-curve.
 */
export function HeroBackdrop() {
  const { themeKey, isHighContrast } = useTheme();
  if (isHighContrast) return null;

  const hero = roleColors[themeKey].hero;
  const opacity = heroTextureOpacity(themeKey);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no">
      <Image
        source={heroTexture}
        style={[StyleSheet.absoluteFill, { opacity }]}
        resizeMode="cover"
        // Decorative: an empty label is the RN spelling of "skip me", and the parent is already
        // hidden from the tree. Both, because the two platforms honour different halves.
        accessibilityLabel=""
        accessible={false}
      />
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id="heroScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={hero} stopOpacity={0} />
            <Stop offset="0.55" stopColor={hero} stopOpacity={0.3} />
            <Stop offset="1" stopColor={hero} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroScrim)" />
      </Svg>
    </View>
  );
}

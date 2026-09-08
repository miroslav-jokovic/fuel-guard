import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import heroBandTexture from '../../assets/hero-band.webp';
import heroAuthTexture from '../../assets/hero-auth.webp';
import { roleColors } from '@/theme/colors';
import { heroTextureOpacity, type HeroTextureName } from '@/theme/heroTexture';
import { useTheme } from '@/theme/ThemeProvider';

const ASSET: Record<HeroTextureName, number> = {
  band: heroBandTexture,
  auth: heroAuthTexture,
};

/**
 * Atmosphere behind the navy hero (D-DB20; the auth texture is D-DB21).
 *
 * The hero was a flat slab of one colour. The owner's reference artwork is the same navy and the
 * same amber the palette already holds — measured on 2026-09-08, the art sits at rgb(25,37,52)
 * against `hero`'s rgb(32,40,58) and its amber at rgb(244,180,113) against `action`'s
 * rgb(242,178,103) — so nothing here repaints the theme. What the art has and a slab does not is
 * depth: contour lines, a road, a network, and light falling across it.
 *
 * Three rules keep it from costing anything:
 *
 * 1. It is DECORATIVE. Hidden from the accessibility tree, and no information is ever carried here.
 * 2. Its brightness is capped in the ASSET, not by a scrim, and the cap is per texture because the
 *    two heroes carry different text. `src/theme/heroTexture.ts` holds both ceilings and the
 *    reasoning; 'every texture is safe for every tone it is allowed to back' asserts them.
 * 3. HIGH CONTRAST turns it off completely. A decorative texture is precisely what that setting
 *    exists to remove, and it would spend the margin the setting exists to create.
 *
 * The scrim is the other half: it runs to solid `hero` at the foot so the light sheet always meets
 * flat colour, never a road in mid-curve.
 */
export function HeroBackdrop({ texture = 'band' }: { texture?: HeroTextureName }) {
  const { themeKey, isHighContrast } = useTheme();
  /**
   * Measured, not `height="100%"`. react-native-svg resolves a Rect's percentage against the Svg's
   * VIEWBOX, and this Svg has none — the same trap `Card` documents, and it bit again here on
   * 2026-09-08: the scrim covered only the upper part of the taller login hero and left a hard
   * horizontal seam across it at the row where the gradient ran out. Each half rendered correctly in
   * isolation, which is what made it worth writing down a second time.
   */
  const [box, setBox] = useState({ width: 0, height: 0 });

  if (isHighContrast) return null;

  const hero = roleColors[themeKey].hero;
  const opacity = heroTextureOpacity(themeKey);

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no"
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        if (width !== box.width || height !== box.height) setBox({ width, height });
      }}
    >
      <Image
        source={ASSET[texture]}
        style={[StyleSheet.absoluteFill, { opacity }]}
        resizeMode="cover"
        // Decorative: an empty label is the RN spelling of "skip me", and the parent is already
        // hidden from the tree. Both, because the two platforms honour different halves.
        accessibilityLabel=""
        accessible={false}
      />
      {box.width > 0 && box.height > 0 ? (
        <Svg style={StyleSheet.absoluteFill} width={box.width} height={box.height}>
          <Defs>
            <LinearGradient id="heroScrim" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={hero} stopOpacity={0} />
              <Stop offset="0.55" stopColor={hero} stopOpacity={0.3} />
              <Stop offset="1" stopColor={hero} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width={box.width} height={box.height} fill="url(#heroScrim)" />
        </Svg>
      ) : null}
    </View>
  );
}

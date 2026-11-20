import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { AppText } from './AppText';
import { haptics } from '@/lib/haptics';
import { layout } from '@/theme/tokens';

/**
 * The screen's signature (Visual 2026 D-DV6, the V1 mock's Today and Documents blocks).
 *
 * One navy block per screen, saying what the screen is about. It reads top to bottom:
 * - `context`: where this sits ("Pickup · stop 1 of 2 · Load 1184530").
 * - `subject`: the thing ("Ardent Mills").
 * - `place`: an optional second line ("Chicago, IL").
 * - `figure`: the ONE lone figure, in Big Shoulders (`numericHero`). It never aligns with another
 *   figure, which is why the display face's missing `tnum` is irrelevant here (D-DV15).
 * - `figureSuffix`: an optional smaller tail ("– 08:00"), in the platform face, tabular.
 * - `live`: the live line in cyan, a real countdown to a real time ("Window opens in 18 min"), never an
 *   ETA (D-DV13).
 *
 * - `liveTone="act"` turns the live line amber, for the one time-critical state the block reports (a
 *   closed window, V5). Cyan says "live", amber says "act" (D-DV5); nothing else colours it.
 *
 * Every slot is optional, `subject` included: the pre-shift block in the mock (screen 9) is a context
 * line, the figure and the live line, with no subject. So the same block serves "Off duty · 06:00" on a
 * pre-shift Today and "2 photos missing" on Documents. The block is flat navy in light and dark alike: the brand
 * on the night is carried by this block, not by navy text (DESIGN.md, colour roles).
 *
 * `children` sits under the figure for the rare extra line a screen needs. Do not put rows in it;
 * rows belong on the canvas (D-DV7).
 */
export function StatusBlock({
  context,
  subject,
  place,
  figure,
  figureSuffix,
  live,
  liveTone = 'live',
  onPress,
  accessibilityLabel,
  children,
}: {
  context?: string;
  subject?: string;
  place?: string;
  figure?: string;
  figureSuffix?: string;
  live?: string;
  liveTone?: 'live' | 'act';
  onPress?: () => void;
  accessibilityLabel?: string;
  children?: ReactNode;
}) {
  const body = (
    <>
      {context ? (
        <AppText variant="supporting" weight="semibold" tone="onHeroSecondary">{context}</AppText>
      ) : null}
      {subject || place ? (
        <View>
          {subject ? <AppText variant="navigationTitle" tone="onHero" accessibilityRole="header">{subject}</AppText> : null}
          {place ? <AppText variant="supporting" tone="onHeroSecondary">{place}</AppText> : null}
        </View>
      ) : null}
      {figure ? (
        <View className="flex-row flex-wrap items-baseline" style={{ columnGap: 8, paddingTop: 8 }}>
          <AppText variant="numericHero" tone="onHero">{figure}</AppText>
          {figureSuffix ? (
            <AppText variant="numericInline" tone="onHeroSecondary">{figureSuffix}</AppText>
          ) : null}
        </View>
      ) : null}
      {live ? <AppText variant="body" weight="semibold" tone={liveTone === 'act' ? 'onHeroAct' : 'onHeroLive'} tabular>{live}</AppText> : null}
      {children}
    </>
  );

  const className = 'gap-1 rounded-xl bg-hero';
  const style = { padding: layout.cardPadding + 2 };
  if (!onPress) {
    return (
      <View className={className} style={style} accessible accessibilityLabel={accessibilityLabel}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      className={`${className} active:bg-hero-raised`}
      style={style}
    >
      {body}
    </Pressable>
  );
}

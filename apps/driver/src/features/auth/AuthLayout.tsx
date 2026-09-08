import type { ReactNode } from 'react';
import { View } from 'react-native';
import { AppText, Icon, Screen, SilvicomLogo360, TONE_SOFT, type Tone } from '@/components';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

/**
 * The auth screens' hero (D-DB15, 2026-09-07): the Silvicom mark, white, centred on the navy, and
 * nothing else. The first version of these screens put a 240pt mark hard-left over a left-aligned
 * title, a 16pt gutter beside the app's 20pt one, and a centred "Development bypass" under
 * left-aligned help copy — the owner's word for it was "alignment is not correct". Now the mark
 * owns the hero and the sheet owns every line of text, all at the one screen inset.
 *
 * `icon` and `tone` give the non-form screens (pending, wrong app) a 56pt tinted disc under the
 * mark, so a driver knows at a glance whether they are waiting or blocked before reading a word.
 */
export function AuthMast({ icon, tone = 'neutral' }: { icon?: MaterialSymbolName; tone?: Tone }) {
  return (
    <View className="items-center gap-6 py-6">
      <SilvicomLogo360 width={208} height={40} onHero />
      {icon ? (
        <View className={`h-14 w-14 items-center justify-center rounded-full ${TONE_SOFT[tone].bg}`}>
          <Icon name={icon} size={26} fill className={TONE_SOFT[tone].text} />
        </View>
      ) : null}
    </View>
  );
}

/** The title block at the head of the sheet — one place, so every auth screen aligns the same. */
export function AuthTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View className="gap-1">
      <AppText variant="screenTitle" accessibilityRole="header">{title}</AppText>
      {subtitle ? <AppText variant="body" tone="muted">{subtitle}</AppText> : null}
    </View>
  );
}

/**
 * Sheet-only identity block, kept for accept-invite, whose steps each carry their own title inside
 * one scrolling form. Left-aligned to the screen inset like everything under it.
 */
export function AuthHero({
  title,
  subtitle,
}: {
  icon: MaterialSymbolName;
  tone?: Tone;
  title: string;
  subtitle?: string;
}) {
  return (
    <View className="gap-4">
      <SilvicomLogo360 width={184} height={35} />
      <AuthTitle title={title} subtitle={subtitle} />
    </View>
  );
}

/**
 * The hero-and-sheet auth composition (D-DB1's two layers, applied to the front door). The mark on
 * the navy, the words and the controls on the cream, the footer at the foot of the sheet rather than
 * floating in the middle of the page.
 */
export function AuthScreen({
  icon,
  tone,
  title,
  subtitle,
  children,
  footer,
}: {
  icon: MaterialSymbolName;
  tone?: Tone;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Screen hero={<AuthMast icon={icon} tone={tone} />} flow="flat">
      <AuthTitle title={title} subtitle={subtitle} />
      {children ? <View className="gap-3">{children}</View> : null}
      {footer ? <View className="gap-3 pt-2">{footer}</View> : null}
    </Screen>
  );
}

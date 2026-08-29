import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, SilvicomLogo360, type Tone } from '@/components';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';
import { layout } from '@/theme/tokens';

/** Compact enterprise identity block; no oversized centered badge or decorative hero space. */
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
    <View className="items-start gap-3">
      <SilvicomLogo360 />
      <View className="gap-1">
        <AppText variant="screenTitle" accessibilityRole="header">{title}</AppText>
        {subtitle ? <AppText variant="body" tone="muted">{subtitle}</AppText> : null}
      </View>
    </View>
  );
}

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
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      className="flex-1 bg-canvas"
      contentContainerClassName="gap-6 px-4"
      contentContainerStyle={{
        paddingTop: insets.top + layout.sectionGap,
        paddingBottom: insets.bottom + layout.screenInset,
      }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <AuthHero icon={icon} tone={tone} title={title} subtitle={subtitle} />
      {children ? <View className="gap-3">{children}</View> : null}
      {footer ? <View className="gap-3">{footer}</View> : null}
    </ScrollView>
  );
}

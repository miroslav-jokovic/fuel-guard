import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Icon, type Tone } from '@/components';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';
import { layout } from '@/theme/tokens';

const FG: Record<Tone, string> = {
  neutral: 'text-ink-secondary', brand: 'text-brand', danger: 'text-danger', caution: 'text-caution',
  warning: 'text-warning', success: 'text-success', info: 'text-info',
};

/** Compact enterprise identity block; no oversized centered badge or decorative hero space. */
export function AuthHero({
  icon,
  tone = 'brand',
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
      <View className="flex-row items-center gap-2">
        <Icon name={icon} size={24} fill className={FG[tone]} />
        <AppText variant="sectionTitle" tone="secondary">FuelGuard Driver</AppText>
      </View>
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
    <View
      className="flex-1 bg-canvas px-4"
      style={{ paddingTop: insets.top + layout.sectionGap, paddingBottom: insets.bottom + layout.screenInset }}
    >
      <View className="gap-6">
        <AuthHero icon={icon} tone={tone} title={title} subtitle={subtitle} />
        {children ? <View className="gap-3">{children}</View> : null}
      </View>
      {footer ? <View className="mt-6 gap-3">{footer}</View> : null}
    </View>
  );
}

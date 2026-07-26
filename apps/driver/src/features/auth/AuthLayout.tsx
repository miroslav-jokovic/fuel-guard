import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type Tone } from '@/components';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

const RING: Record<Tone, string> = {
  neutral: 'bg-surface-muted',
  brand: 'bg-brand/10',
  danger: 'bg-danger/10',
  caution: 'bg-caution/10',
  warning: 'bg-warning/10',
  success: 'bg-success/10',
  info: 'bg-info/10',
};
const FG: Record<Tone, string> = {
  neutral: 'text-ink-muted',
  brand: 'text-brand',
  danger: 'text-danger',
  caution: 'text-caution',
  warning: 'text-warning',
  success: 'text-success',
  info: 'text-info',
};

/** The icon-badge + title + subtitle hero shared by every auth surface. Token-only. */
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
    <View className="items-center gap-3">
      <View className={`h-16 w-16 items-center justify-center rounded-2xl ${RING[tone]}`}>
        <Icon name={icon} size={32} fill className={FG[tone]} />
      </View>
      <Text className="text-center text-2xl font-sans-bold text-ink">{title}</Text>
      {subtitle ? (
        <Text className="text-center text-base leading-relaxed text-ink-muted">{subtitle}</Text>
      ) : null}
    </View>
  );
}

/**
 * Vertically-centered auth surface (pending / wrong-app / any keyboard-free state).
 * `footer` pins to the bottom safe area; `children` (actions) sit under the hero.
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
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 bg-canvas px-6"
      style={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }}
    >
      <View className="flex-1 justify-center gap-6">
        <AuthHero icon={icon} tone={tone} title={title} subtitle={subtitle} />
        {children ? <View className="gap-3">{children}</View> : null}
      </View>
      {footer ? <View className="gap-3">{footer}</View> : null}
    </View>
  );
}

import { useEffect } from 'react';
import { Modal, Pressable, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './AppText';
import { Button } from './Button';
import { Icon } from './Icon';
import type { Tone } from './Badge';
import { haptics } from '@/lib/haptics';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';
import { useTheme } from '@/theme/ThemeProvider';

const BG: Record<Tone, string> = {
  neutral: 'bg-surface-muted', brand: 'bg-brand-subtle', danger: 'bg-danger/10',
  caution: 'bg-caution/10', warning: 'bg-warning/10', success: 'bg-success/10', info: 'bg-info/10',
};
const FG: Record<Tone, string> = {
  neutral: 'text-ink-secondary', brand: 'text-brand', danger: 'text-danger',
  caution: 'text-caution', warning: 'text-warning', success: 'text-success', info: 'text-info',
};

export function ConfirmSheet({
  visible,
  tone = 'danger',
  icon = 'warning',
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  loading = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  tone?: Tone;
  icon?: MaterialSymbolName;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { reduceMotion } = useTheme();

  useEffect(() => {
    if (visible) haptics.warning();
  }, [visible]);

  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType="none" onRequestClose={onCancel}>
      <View className="flex-1 justify-end">
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(140)}
          className="absolute inset-0 bg-surface-inverse/40"
        >
          <Pressable className="flex-1" accessibilityLabel="Dismiss" onPress={onCancel} />
        </Animated.View>
        <Animated.View
          entering={reduceMotion ? undefined : SlideInDown.springify().damping(28).stiffness(320)}
          className="gap-4 rounded-t-2xl border-t border-edge-subtle bg-surface-raised px-5 pt-3"
          style={{ paddingBottom: insets.bottom + 16 }}
          accessibilityViewIsModal
        >
          <View className="h-1 w-9 self-center rounded-full bg-edge-strong" />
          <View className="flex-row items-start gap-3">
            <View className={`h-10 w-10 items-center justify-center rounded-lg ${BG[tone]}`}>
              <Icon name={icon} size={21} fill className={FG[tone]} />
            </View>
            <View className="flex-1 gap-1">
              <AppText variant="navigationTitle" accessibilityRole="header">{title}</AppText>
              <AppText variant="supporting" tone="secondary">{message}</AppText>
            </View>
          </View>
          <View className="gap-2">
            <Button
              label={confirmLabel}
              variant={tone === 'danger' ? 'danger' : 'primary'}
              loading={loading}
              haptic="warning"
              onPress={onConfirm}
            />
            <Button label={cancelLabel} variant="ghost" onPress={onCancel} />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

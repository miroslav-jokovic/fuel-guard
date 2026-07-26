import { useEffect } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from './Button';
import { Icon } from './Icon';
import type { Tone } from './Badge';
import { haptics } from '@/lib/haptics';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

const BG: Record<Tone, string> = {
  neutral: 'bg-surface-muted', brand: 'bg-brand/10', danger: 'bg-danger/10',
  caution: 'bg-caution/10', warning: 'bg-warning/10', success: 'bg-success/10', info: 'bg-info/10',
};
const FG: Record<Tone, string> = {
  neutral: 'text-ink-muted', brand: 'text-brand', danger: 'text-danger',
  caution: 'text-caution', warning: 'text-warning', success: 'text-success', info: 'text-info',
};

// The tokenized confirm sheet (D19): destructive/blocking confirmations slide up as a branded
// bottom sheet — never a native Alert. Grabber, icon badge, stacked actions, safe-area aware.
// Warning haptic on present (D20).
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

  useEffect(() => {
    if (visible) haptics.warning();
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={onCancel}
    >
      <View className="flex-1 justify-end">
        <Animated.View entering={FadeIn.duration(160)} className="absolute inset-0 bg-surface-inverse/40">
          <Pressable className="flex-1" accessibilityLabel="Dismiss" onPress={onCancel} />
        </Animated.View>
        <Animated.View
          entering={SlideInDown.springify().damping(26).stiffness(300)}
          className="gap-3 rounded-t-xl bg-surface px-5 pt-3"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          <View className="h-1 w-10 self-center rounded-full bg-edge-strong" />
          <View className={`h-12 w-12 items-center justify-center self-center rounded-full ${BG[tone]}`}>
            <Icon name={icon} size={24} fill className={FG[tone]} />
          </View>
          <Text className="text-center text-lg font-sans-sb text-ink">{title}</Text>
          <Text className="text-center text-sm leading-relaxed text-ink-secondary">{message}</Text>
          <View className="gap-2 pt-1">
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

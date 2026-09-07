import { useEffect } from 'react';
import { Modal, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './AppText';
import { Button } from './Button';
import { Icon } from './Icon';
import { TONE_SOFT, type Tone } from './tone';
import { haptics } from '@/lib/haptics';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';
import { useTheme } from '@/theme/ThemeProvider';

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
  const { height } = useWindowDimensions();
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
          <Pressable
            className="flex-1"
            accessibilityRole="button"
            accessibilityLabel="Dismiss confirmation"
            onPress={onCancel}
          />
        </Animated.View>
        <Animated.View
          entering={reduceMotion ? undefined : SlideInDown.springify().damping(28).stiffness(320)}
          className="rounded-t-2xl bg-surface-raised px-5 pt-3"
          style={{ maxHeight: height - insets.top - 8, paddingBottom: insets.bottom + 16 }}
          accessibilityViewIsModal
        >
          <View className="h-1 w-9 self-center rounded-full bg-edge-strong" />
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerClassName="gap-4 py-4"
          >
            <View className="flex-row items-start gap-3">
              <View className={`h-11 w-11 items-center justify-center rounded-full ${TONE_SOFT[tone].bg}`}>
                <Icon name={icon} size={21} fill className={TONE_SOFT[tone].text} />
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
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

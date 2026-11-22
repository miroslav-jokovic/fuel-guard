import { useEffect } from 'react';
import { View } from 'react-native';
import { AppText, TEXT_TONE_CLASS } from './AppText';
import { Button } from './Button';
import { SystemSheet } from './SystemSheet';
import { Icon } from './Icon';
import { TONE_SOFT, type Tone } from './tone';
import { haptics } from '@/lib/haptics';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

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
  useEffect(() => {
    if (visible) haptics.warning();
  }, [visible]);

  return (
    <SystemSheet visible={visible} onDismiss={onCancel}>
      <View className="flex-row items-start gap-3">
        <View className={`h-11 w-11 items-center justify-center rounded-full ${TONE_SOFT[tone].bg}`}>
          <Icon name={icon} size={21} fill className={TEXT_TONE_CLASS[TONE_SOFT[tone].textTone]} />
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
    </SystemSheet>
  );
}

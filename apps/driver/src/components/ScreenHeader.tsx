import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { IconButton } from './IconButton';

// One header pattern for every screen/modal — big bold title, optional subtitle, optional
// back/close, optional right-side action. Replaces the ad-hoc header rows each screen rolled itself.
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  onClose,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  onClose?: () => void;
  right?: ReactNode;
}) {
  return (
    <View className="flex-row items-center gap-2">
      {onBack ? <IconButton name="arrow_back" label="Back" onPress={onBack} /> : null}
      <View className="flex-1 gap-0.5">
        <Text className="text-2xl font-sans-bold text-ink" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text className="text-sm text-ink-muted">{subtitle}</Text> : null}
      </View>
      {right}
      {onClose ? <IconButton name="close" label="Close" onPress={onClose} /> : null}
    </View>
  );
}

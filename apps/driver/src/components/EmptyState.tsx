import { View } from 'react-native';
import { Text } from 'react-native';
import { Button } from './Button';
import { Icon } from './Icon';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

export function EmptyState({
  title, subtitle, icon, actionLabel, actionIcon, onAction,
}: {
  title: string;
  subtitle?: string;
  icon?: MaterialSymbolName;
  actionLabel?: string;
  actionIcon?: MaterialSymbolName;
  onAction?: () => void;
}) {
  return (
    <View className="items-center justify-center gap-2 py-12 px-6">
      {icon ? (
        <View className="w-16 h-16 items-center justify-center rounded-full bg-surface-muted mb-1">
          <Icon name={icon} size={32} className="text-ink-subtle" />
        </View>
      ) : null}
      <Text className="text-lg font-semibold text-ink text-center">{title}</Text>
      {subtitle ? <Text className="text-ink-muted text-center">{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <View className="pt-2">
          <Button label={actionLabel} icon={actionIcon} variant="primary" onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

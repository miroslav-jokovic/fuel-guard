import { Text, View } from 'react-native';
import { Button } from './Button';
import { Icon } from './Icon';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

// Empty states teach the next action (plan §22.5/§22.9). An optional icon badge anchors the message.
export function EmptyState({
  icon,
  title,
  subtitle,
  actionLabel,
  actionIcon,
  onAction,
}: {
  icon?: MaterialSymbolName;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  actionIcon?: MaterialSymbolName;
  onAction?: () => void;
}) {
  return (
    <View className="items-center justify-center gap-3 py-10 px-6">
      {icon ? (
        <View className="h-12 w-12 items-center justify-center rounded-2xl bg-surface-muted">
          <Icon name={icon} size={24} className="text-ink-muted" />
        </View>
      ) : null}
      <View className="items-center gap-1">
        <Text className="text-center text-lg font-sans-sb text-ink">{title}</Text>
        {subtitle ? <Text className="text-center text-ink-muted">{subtitle}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <View className="pt-1">
          <Button label={actionLabel} icon={actionIcon} variant="primary" onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

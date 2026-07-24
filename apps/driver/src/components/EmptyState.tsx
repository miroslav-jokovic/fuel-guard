import { Text, View } from 'react-native';
import { Button } from './Button';

// Empty states teach the next action (plan §22.5/§22.9).
export function EmptyState({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View className="items-center justify-center gap-2 py-12 px-6">
      <Text className="text-lg font-semibold text-ink text-center">{title}</Text>
      {subtitle ? <Text className="text-ink-muted text-center">{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <View className="pt-2">
          <Button label={actionLabel} variant="primary" onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

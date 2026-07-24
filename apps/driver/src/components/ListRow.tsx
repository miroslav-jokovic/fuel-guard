import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

export function ListRow({
  title,
  subtitle,
  right,
  onPress,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-lg bg-surface border border-edge px-4 min-h-[56px] active:bg-surface-subtle"
    >
      <View className="flex-1 gap-0.5">
        <Text className="text-base font-medium text-ink">{title}</Text>
        {subtitle ? <Text className="text-sm text-ink-muted">{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Text className="text-ink-subtle text-lg">{'›'}</Text> : null)}
    </Pressable>
  );
}

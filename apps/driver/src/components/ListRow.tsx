import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Icon } from './Icon';
import { haptics } from '@/lib/haptics';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

export function ListRow({
  title, subtitle, icon, iconFill, right, onPress,
}: {
  title: string;
  subtitle?: string;
  icon?: MaterialSymbolName;
  iconFill?: boolean;
  right?: ReactNode;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={
        onPress
          ? () => {
              haptics.select();
              onPress();
            }
          : undefined
      }
      className="flex-row items-center gap-3 rounded-lg bg-surface border border-edge px-4 min-h-[56px] active:bg-surface-subtle"
    >
      {icon ? (
        <View className="w-9 h-9 items-center justify-center rounded-md bg-surface-muted">
          <Icon name={icon} fill={iconFill} size={20} className="text-ink-secondary" />
        </View>
      ) : null}
      <View className="flex-1 gap-0.5">
        <Text className="text-base font-medium text-ink">{title}</Text>
        {subtitle ? <Text className="text-sm text-ink-muted">{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron_right" size={22} className="text-ink-subtle" /> : null)}
    </Pressable>
  );
}

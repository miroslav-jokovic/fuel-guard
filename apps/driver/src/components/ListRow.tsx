import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Icon } from './Icon';
import { haptics } from '@/lib/haptics';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';
import { ui } from '@/theme/classes';

export function ListRow({
  title,
  subtitle,
  icon,
  iconFill,
  right,
  onPress,
  disabled = false,
}: {
  title: string;
  subtitle?: string;
  icon?: MaterialSymbolName;
  iconFill?: boolean;
  right?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={onPress ? { disabled } : undefined}
      disabled={disabled}
      onPress={
        onPress
          ? () => {
              haptics.select();
              onPress();
            }
          : undefined
      }
      className={`${ui.listRow} active:bg-surface-subtle ${disabled ? 'opacity-50' : ''}`}
    >
      {icon ? (
        <View className="h-10 w-10 items-center justify-center rounded-lg bg-surface-muted">
          <Icon name={icon} fill={iconFill} size={20} className="text-ink" />
        </View>
      ) : null}
      <View className="flex-1 gap-0.5">
        <Text className="text-base font-sans-md text-ink">{title}</Text>
        {subtitle ? <Text className="text-sm text-ink-muted">{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron_right" size={22} className="text-ink" /> : null)}
    </Pressable>
  );
}

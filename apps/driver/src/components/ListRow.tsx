import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { AppText } from './AppText';
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
  destructive = false,
}: {
  title: string;
  subtitle?: string;
  icon?: MaterialSymbolName;
  iconFill?: boolean;
  right?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const tone = destructive ? 'danger' : disabled ? 'disabled' : 'primary';
  const content = (
    <>
      {icon ? (
        <View className="w-6 items-center justify-center">
          <Icon
            name={icon}
            fill={iconFill}
            size={21}
            className={destructive ? 'text-danger' : disabled ? 'text-ink-disabled' : 'text-ink-secondary'}
          />
        </View>
      ) : null}
      <View className="flex-1 gap-0.5">
        <AppText variant="rowTitle" tone={tone}>{title}</AppText>
        {subtitle ? <AppText variant="supporting" tone={disabled ? 'disabled' : 'muted'}>{subtitle}</AppText> : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron_right" size={20} className="text-ink-subtle" /> : null)}
    </>
  );

  const className = `${ui.listRow} ${disabled ? 'opacity-60' : ''}`;
  if (!onPress) return <View accessible className={className}>{content}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      className={`${className} active:bg-surface-selected`}
    >
      {content}
    </Pressable>
  );
}

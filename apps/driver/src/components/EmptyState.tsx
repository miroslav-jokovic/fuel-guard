import { View } from 'react-native';
import { AppText } from './AppText';
import { Button } from './Button';
import { Icon } from './Icon';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

/** Compact inline empty state; it never expands merely to balance the viewport. */
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
    <View className="items-center gap-2 px-4 py-6">
      {icon ? <Icon name={icon} size={24} className="text-ink-muted" /> : null}
      <View className="items-center gap-1">
        <AppText variant="rowTitle" className="text-center">{title}</AppText>
        {subtitle ? <AppText variant="supporting" tone="muted" className="text-center">{subtitle}</AppText> : null}
      </View>
      {actionLabel && onAction ? (
        <View className="pt-1">
          <Button label={actionLabel} icon={actionIcon} variant="primary" size="sm" onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

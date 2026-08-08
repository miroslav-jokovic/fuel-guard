import { Switch, View } from 'react-native';
import { AppText } from './AppText';
import { roleColors } from '@/theme/colors';
import { useTheme } from '@/theme/ThemeProvider';

/** Platform switch inside the same grouped-row anatomy used by settings and preferences. */
export function ToggleRow({
  title,
  subtitle,
  value,
  onValueChange,
  disabled = false,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const { themeKey } = useTheme();
  const colors = roleColors[themeKey];
  return (
    <View className={`min-h-[52px] flex-row items-center gap-3 bg-surface px-4 py-2 ${disabled ? 'opacity-60' : ''}`}>
      <View className="flex-1 gap-0.5">
        <AppText accessible={false} variant="rowTitle" tone={disabled ? 'disabled' : 'primary'}>{title}</AppText>
        {subtitle ? <AppText accessible={false} variant="supporting" tone={disabled ? 'disabled' : 'muted'}>{subtitle}</AppText> : null}
      </View>
      <Switch
        accessibilityLabel={title}
        accessibilityHint={subtitle}
        accessibilityState={{ disabled, checked: value }}
        disabled={disabled}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.edge, true: colors.brand }}
        thumbColor={colors.surface}
        ios_backgroundColor={colors.edge}
      />
    </View>
  );
}

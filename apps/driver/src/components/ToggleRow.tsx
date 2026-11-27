import { Platform, View } from 'react-native';
import { Host, Switch } from '@expo/ui';
import { AppText } from './AppText';
import { roleColors } from '@/theme/colors';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * The platform's switch in the grouped-row anatomy settings use (Visual 2026 V9, D-DV1): SwiftUI's
 * `Toggle` on iOS, Material 3's `Switch` on Android, through `@expo/ui`. React Native's own `Switch`
 * was the native control on iOS but Material 2's on Android. iOS keeps the system's own colours (a
 * switch is system chrome, D-DV2); Android's Material palette is seeded from the brand navy. The host
 * takes the APP's scheme, which Settings → Theme may set apart from the phone's.
 */
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
  const { isDark, themeKey } = useTheme();
  return (
    <View className={`min-h-13 flex-row items-center gap-3 px-4 py-2 ${disabled ? 'opacity-60' : ''}`}>
      <View className="flex-1 gap-0.5">
        <AppText accessible={false} variant="rowTitle" tone={disabled ? 'disabled' : 'primary'}>{title}</AppText>
        {subtitle ? <AppText accessible={false} variant="supporting" tone={disabled ? 'disabled' : 'muted'}>{subtitle}</AppText> : null}
      </View>
      <Host
        matchContents
        colorScheme={isDark ? 'dark' : 'light'}
        // Material 3's baseline palette is lavender (D-DV14 bans it); Android derives the switch's
        // colours from the brand navy instead. iOS keeps the system's own switch colours.
        seedColor={Platform.OS === 'android' ? roleColors[themeKey].brand : undefined}
        accessibilityLabel={title}
        accessibilityHint={subtitle}
      >
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
        />
      </Host>
    </View>
  );
}

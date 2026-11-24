import { Host, SegmentedButton, SingleChoiceSegmentedButtonRow, Text } from '@expo/ui/jetpack-compose';
import { haptics } from '@/lib/haptics';
import { roleColors } from '@/theme/colors';
import { useTheme } from '@/theme/ThemeProvider';

export interface NativeSegmentedProps<T extends string> {
  options: readonly { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * Material 3's single-choice segmented buttons (Visual 2026 V9, D-DV1), the Android twin of
 * `NativeSegmented.ios.tsx`. The selected segment is the raised surface on the muted track, the roles
 * the drawn control it replaces used; the host takes the app's scheme, not the phone's.
 */
export function NativeSegmented<T extends string>({ options, value, onChange }: NativeSegmentedProps<T>) {
  const { isDark, themeKey } = useTheme();
  const colors = roleColors[themeKey];
  return (
    <Host matchContents={{ vertical: true }} colorScheme={isDark ? 'dark' : 'light'} style={{ width: '100%' }}>
      <SingleChoiceSegmentedButtonRow>
        {options.map((option) => (
          <SegmentedButton
            key={option.value}
            selected={option.value === value}
            onClick={() => {
              if (option.value === value) return;
              haptics.select();
              onChange(option.value);
            }}
            colors={{
              activeContainerColor: colors.surface,
              activeContentColor: colors.ink,
              activeBorderColor: colors.edge,
              inactiveContainerColor: colors.surfaceMuted,
              inactiveContentColor: colors.inkSecondary,
              inactiveBorderColor: colors.edge,
            }}
          >
            <SegmentedButton.Label>
              <Text>{option.label}</Text>
            </SegmentedButton.Label>
          </SegmentedButton>
        ))}
      </SingleChoiceSegmentedButtonRow>
    </Host>
  );
}

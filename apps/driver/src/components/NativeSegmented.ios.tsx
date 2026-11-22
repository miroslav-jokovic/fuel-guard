import { Host, Picker, Text } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import type { NativeSegmentedProps } from './NativeSegmented';

/**
 * The system's segmented control (`UISegmentedControl` through SwiftUI's `Picker`), Liquid Glass on
 * iOS 26 (Visual 2026 V9, D-DV1). The host takes the APP's colour scheme, not the phone's: Settings →
 * Theme can differ from the system setting, and a light control on the dark canvas would glare.
 */
export function NativeSegmented<T extends string>({ options, value, onChange }: NativeSegmentedProps<T>) {
  const { isDark } = useTheme();
  return (
    <Host matchContents={{ vertical: true }} colorScheme={isDark ? 'dark' : 'light'} style={{ width: '100%' }}>
      <Picker<string>
        selection={value}
        onSelectionChange={(next) => {
          if (next === value) return;
          haptics.select();
          onChange(next as T);
        }}
        modifiers={[pickerStyle('segmented')]}
      >
        {options.map((option) => (
          <Text key={option.value} modifiers={[tag(option.value)]}>{option.label}</Text>
        ))}
      </Picker>
    </Host>
  );
}

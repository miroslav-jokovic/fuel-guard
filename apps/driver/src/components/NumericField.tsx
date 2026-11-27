import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { textStyle } from '@/theme/typography';
import { AppText } from './AppText';
import { useFieldAccessibility } from './Field';

// Big numeric entry (plan §22.4): large tabular value (`textStyle('numericCompact')`) + unit suffix, native decimal-pad, visible
// focus state. `items-center` (not baseline — unreliable with a TextInput) keeps the unit aligned.
export function NumericField({
  value,
  onChangeText,
  unit,
  placeholder = '0',
  invalid = false,
  accessibilityLabel,
}: {
  value: string;
  onChangeText: (v: string) => void;
  unit?: string;
  placeholder?: string;
  invalid?: boolean;
  accessibilityLabel?: string;
}) {
  const field = useFieldAccessibility();
  const { boldText } = useTheme();
  const [focused, setFocused] = useState(false);
  const isInvalid = invalid || Boolean(field?.error);
  const border = isInvalid ? 'border-danger' : focused ? 'border-2 border-edge-focus' : 'border-transparent';
  return (
    <View
      className={`min-h-14 flex-row items-center gap-2 rounded-lg border bg-surface-muted px-4 ${border}`}
    >
      <TextInput
        keyboardType="decimal-pad"
        inputMode="decimal"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        accessibilityLabel={accessibilityLabel ?? field?.label}
        accessibilityHint={field?.error ?? field?.hint ?? (unit ? `Enter a value in ${unit}` : undefined)}
        aria-invalid={isInvalid || undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="flex-1 text-ink placeholder:text-ink-subtle"
        // An entered figure is compared digit by digit as it is typed, so it is the tabular platform
        // face (D-DV15), not the display face that sets a lone hero figure.
        style={{
          ...textStyle('numericCompact', { boldText }),
          paddingVertical: 8,
          includeFontPadding: false,
          textAlignVertical: 'center',
        }}
      />
      {unit ? (
        <AppText tone="muted" style={{ includeFontPadding: false }}>{unit}</AppText>
      ) : null}
    </View>
  );
}

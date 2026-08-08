import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { AppText } from './AppText';
import { useFieldAccessibility } from './Field';

// Big numeric entry (plan §22.4): large tabular value + unit suffix, native decimal-pad, visible
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
  const [focused, setFocused] = useState(false);
  const isInvalid = invalid || Boolean(field?.error);
  const border = isInvalid ? 'border-danger' : focused ? 'border-2 border-edge-focus' : 'border-edge';
  return (
    <View
      className={`min-h-14 flex-row items-center gap-2 rounded-lg border bg-surface px-4 ${border}`}
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
        className="flex-1 font-display-bold text-numeric-hero text-ink placeholder:text-ink-subtle"
        style={{
          fontVariant: ['tabular-nums'],
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

import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

// Big numeric entry (plan §22.4): large tabular value + unit suffix, native decimal-pad, visible
// focus state. `items-center` (not baseline — unreliable with a TextInput) keeps the unit aligned.
export function NumericField({
  value,
  onChangeText,
  unit,
  placeholder = '0',
  invalid = false,
}: {
  value: string;
  onChangeText: (v: string) => void;
  unit?: string;
  placeholder?: string;
  invalid?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const border = invalid ? 'border-danger' : focused ? 'border-2 border-brand' : 'border-edge-strong';
  return (
    <View
      className={`flex-row items-center gap-2 rounded-xl border bg-surface px-4 min-h-[60px] ${border}`}
    >
      <TextInput
        keyboardType="decimal-pad"
        inputMode="decimal"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="flex-1 text-3xl font-bold text-ink placeholder:text-ink-subtle"
        style={{
          fontVariant: ['tabular-nums'],
          paddingVertical: 8,
          includeFontPadding: false,
          textAlignVertical: 'center',
        }}
      />
      {unit ? (
        <Text className="text-lg font-medium text-ink-muted" style={{ includeFontPadding: false }}>
          {unit}
        </Text>
      ) : null}
    </View>
  );
}

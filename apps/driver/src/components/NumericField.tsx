import { Text, TextInput, View } from 'react-native';

// The app's core interaction (plan §22.4): a big tabular value + unit suffix, native decimal-pad.
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
  return (
    <View
      className={`flex-row items-baseline gap-2 rounded-md bg-surface border px-3 min-h-[56px] ${
        invalid ? 'border-danger' : 'border-edge-strong'
      }`}
    >
      <TextInput
        keyboardType="decimal-pad"
        inputMode="decimal"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        className="flex-1 text-3xl font-bold text-ink placeholder:text-ink-subtle"
        style={{ fontVariant: ['tabular-nums'] }}
      />
      {unit ? <Text className="text-lg text-ink-muted">{unit}</Text> : null}
    </View>
  );
}

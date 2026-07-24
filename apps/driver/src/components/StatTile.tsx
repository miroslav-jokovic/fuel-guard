import { Text, View } from 'react-native';

// Glanceable metric: big tabular numeral is the signature (plan §22.8).
export function StatTile({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View className="flex-1 rounded-lg bg-surface border border-edge p-4 gap-1">
      <Text className="text-xs uppercase tracking-wide text-ink-muted">{label}</Text>
      <View className="flex-row items-baseline gap-1">
        <Text className="text-ink font-bold" style={{ fontSize: 32, fontVariant: ['tabular-nums'] }}>
          {value}
        </Text>
        {unit ? <Text className="text-base text-ink-muted">{unit}</Text> : null}
      </View>
    </View>
  );
}

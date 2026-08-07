import { Children, type ReactNode } from 'react';
import { View } from 'react-native';

/**
 * One contained information group with internal separators. This replaces the generic pattern of
 * rendering every setting, notification, or metadata row as its own floating card.
 */
export function GroupedList({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children);
  if (rows.length === 0) return null;

  return (
    <View className="overflow-hidden rounded-xl border border-edge-subtle bg-surface">
      {rows.map((row, index) => (
        <View key={index}>
          {row}
          {index < rows.length - 1 ? <View className="ml-4 h-px bg-edge-subtle" /> : null}
        </View>
      ))}
    </View>
  );
}

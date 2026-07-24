import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

export function Field({
  label,
  required = false,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View className="gap-1">
      <Text className="text-sm font-medium text-ink-secondary">
        {label}
        {required ? <Text className="text-danger"> *</Text> : null}
      </Text>
      {children}
      {error ? (
        <Text className="text-sm text-danger">{error}</Text>
      ) : hint ? (
        <Text className="text-xs text-ink-muted">{hint}</Text>
      ) : null}
    </View>
  );
}

import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { Icon } from './Icon';

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
    <View className="gap-1.5">
      <Text className="text-sm font-sans-md text-ink-secondary">
        {label}
        {required ? <Text className="text-danger"> *</Text> : null}
      </Text>
      {children}
      {error ? (
        <View className="flex-row items-center gap-1">
          <Icon name="error" size={14} className="text-danger" />
          <Text className="flex-1 text-sm text-danger">{error}</Text>
        </View>
      ) : hint ? (
        <Text className="text-xs text-ink-muted">{hint}</Text>
      ) : null}
    </View>
  );
}

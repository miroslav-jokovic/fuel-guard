import type { ReactNode } from 'react';
import { View } from 'react-native';
import { AppText } from './AppText';
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
      <AppText variant="supporting" tone="secondary" className="font-medium">
        {label}{required ? <AppText variant="supporting" tone="danger"> *</AppText> : null}
      </AppText>
      {children}
      {error ? (
        <View className="flex-row items-start gap-1.5">
          <Icon name="error" size={15} className="mt-0.5 text-danger" />
          <AppText variant="supporting" tone="danger" className="flex-1">{error}</AppText>
        </View>
      ) : hint ? (
        <AppText variant="caption" tone="muted">{hint}</AppText>
      ) : null}
    </View>
  );
}

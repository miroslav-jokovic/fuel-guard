import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { haptics } from '@/lib/haptics';
import { ui } from '@/theme/classes';

// Surface card with a hairline edge ring (plan §11.6) at the system 12px radius. Pass `onPress`
// to make the whole card a target (≥ list-row size) with press feedback. Token-only.
export function Card({
  children,
  onPress,
  padded = true,
  variant = 'grouped',
}: {
  children: ReactNode;
  onPress?: () => void;
  padded?: boolean;
  variant?: 'grouped' | 'operational' | 'raised' | 'plain';
}) {
  const surface = {
    grouped: ui.card,
    operational: 'rounded-2xl border border-edge bg-surface',
    raised: 'rounded-xl border border-edge-subtle bg-surface-raised shadow-sm',
    plain: 'bg-transparent',
  }[variant];
  const base = `${surface} ${padded ? ui.cardContent : ''}`;
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          haptics.select();
          onPress();
        }}
        className={`${base} active:bg-surface-selected`}
      >
        {children}
      </Pressable>
    );
  }
  return <View className={base}>{children}</View>;
}

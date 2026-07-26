import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { haptics } from '@/lib/haptics';

// Surface card with a hairline edge ring (plan §11.6) at the system 12px radius. Pass `onPress`
// to make the whole card a target (≥ list-row size) with press feedback. Token-only.
export function Card({
  children,
  onPress,
  padded = true,
}: {
  children: ReactNode;
  onPress?: () => void;
  padded?: boolean;
}) {
  const base = `rounded-xl border border-edge bg-surface ${padded ? 'p-4 gap-1.5' : ''}`;
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          haptics.select();
          onPress();
        }}
        className={`${base} active:bg-surface-subtle`}
      >
        {children}
      </Pressable>
    );
  }
  return <View className={base}>{children}</View>;
}

import type { ReactNode } from 'react';
import { View } from 'react-native';

/** Compact, raised task-action region. Screen owns safe-area and horizontal padding. */
export function ActionBar({ children }: { children: ReactNode }) {
  return <View className="gap-2 border-t border-edge-subtle bg-surface-raised pt-3">{children}</View>;
}

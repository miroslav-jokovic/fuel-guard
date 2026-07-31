import type { ReactNode } from 'react';
import { View } from 'react-native';

/** Bottom action grouping for task screens: primary action first, safe secondary actions below. */
export function ActionBar({ children }: { children: ReactNode }) {
  return <View className="gap-2 border-t border-edge-subtle bg-canvas pt-3">{children}</View>;
}

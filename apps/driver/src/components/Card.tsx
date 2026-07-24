import type { ReactNode } from 'react';
import { View } from 'react-native';

// Surface card with a hairline edge ring (plan §11.6). Token-only.
export function Card({ children }: { children: ReactNode }) {
  return <View className="rounded-lg bg-surface border border-edge p-4 gap-1">{children}</View>;
}

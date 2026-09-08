import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * Compact task-action region pinned above the home indicator. Screen owns safe-area and horizontal
 * padding. It sits on the canvas and paints the canvas: it was `surface-raised`, which on the cream
 * sheet (D-DB10) drew a square white slab behind a pill button — the one unrounded rectangle in the
 * app, and on the Documents tab it sat right on top of the floating shell.
 */
export function ActionBar({ children }: { children: ReactNode }) {
  return <View className="gap-2 bg-canvas pt-3">{children}</View>;
}

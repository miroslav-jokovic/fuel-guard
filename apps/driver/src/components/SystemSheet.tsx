import type { ReactNode } from 'react';
import { View } from 'react-native';
import { BottomSheet, RNHostView } from '@expo/ui';
import { roleColors } from '@/theme/colors';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * The operating system's own sheet (Visual 2026 V9, D-DV1): SwiftUI's `.sheet` on iOS, Liquid Glass
 * on iOS 26, and Material 3's modal bottom sheet on Android, through `@expo/ui`'s `BottomSheet`. Its
 * drag-to-dismiss, the scrim, the detent and the back gesture are the platform's, so none is drawn
 * here. It sizes itself to the content.
 *
 * The content stays ours (React Native, through `RNHostView`), so `ConfirmSheet` and `ChoiceSheet`
 * keep their primitives and every call site keeps its props. A swipe down or a tap outside is
 * `onDismiss`, which they treat as Cancel, as their own scrim did.
 *
 * The sheet's background is the role theme's raised surface, set explicitly: the native sheet would
 * otherwise follow the PHONE's appearance, which Settings → Theme may override.
 */
export function SystemSheet({
  visible,
  onDismiss,
  children,
}: {
  visible: boolean;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const { themeKey } = useTheme();
  return (
    <BottomSheet
      isPresented={visible}
      onDismiss={onDismiss}
      containerColor={roleColors[themeKey].surfaceRaised}
      contentPadding={0}
    >
      {/* Height follows the content; width is the SHEET's, which iOS 26 insets from the screen edges.
          Measured both ways in the simulator (V9): unbounded, the rows ran on one endless line; bounded
          to the window, text touched the sheet's right edge. The system sheet keeps its own bottom
          clearance, so only our 16pt rhythm is added. */}
      <RNHostView matchContents={{ vertical: true }}>
        <View className="gap-4 px-5 pb-4 pt-4" accessibilityViewIsModal>
          {children}
        </View>
      </RNHostView>
    </BottomSheet>
  );
}

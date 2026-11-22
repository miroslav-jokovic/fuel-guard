import type { ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { BottomSheet, RNHostView } from '@expo/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { themeKey } = useTheme();
  return (
    <BottomSheet
      isPresented={visible}
      onDismiss={onDismiss}
      containerColor={roleColors[themeKey].surfaceRaised}
      contentPadding={0}
    >
      {/* Height follows the content; width is the sheet's. Measured unbounded, React Native laid the
          rows out on one endless line and the sheet clipped both edges (V9, seen in the simulator). */}
      <RNHostView matchContents={{ vertical: true }}>
        <View className="gap-4 px-5 pt-4" style={{ width, paddingBottom: insets.bottom + 16 }} accessibilityViewIsModal>
          {children}
        </View>
      </RNHostView>
    </BottomSheet>
  );
}

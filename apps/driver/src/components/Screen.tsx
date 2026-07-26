import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Safe-area + canvas background wrapper (plan §11.6). Scrolls by default; `scroll={false}` gives
// a fixed flex column (map/nav screens). Consistent 16pt gutters + 4-unit vertical rhythm.
export function Screen({
  children,
  scroll = true,
  padTop = true,
}: {
  children: ReactNode;
  scroll?: boolean;
  padTop?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const top = padTop ? insets.top + 16 : 16;

  if (!scroll) {
    return (
      <View
        className="flex-1 gap-4 bg-canvas px-4"
        style={{ paddingTop: top, paddingBottom: insets.bottom + 16 }}
      >
        {children}
      </View>
    );
  }
  return (
    <View className="flex-1 bg-canvas">
      <ScrollView
        contentContainerClassName="p-4 gap-4"
        contentContainerStyle={{ paddingTop: top, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

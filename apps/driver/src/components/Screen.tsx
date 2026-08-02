import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { layout } from '@/theme/tokens';
import { ui } from '@/theme/classes';

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
  const top = padTop ? insets.top + layout.screenInset : layout.screenInset;

  if (!scroll) {
    return (
      <View
        className={ui.fixedContent}
        style={{ paddingTop: top, paddingBottom: insets.bottom + layout.screenInset }}
      >
        {children}
      </View>
    );
  }
  return (
    <View className={ui.screen}>
      <ScrollView
        contentContainerClassName={ui.scrollContent}
        contentContainerStyle={{ paddingTop: top, paddingBottom: insets.bottom + layout.scrollBottomInset }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

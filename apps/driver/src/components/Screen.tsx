import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { layout } from '@/theme/tokens';
import { screenTopPadding } from '@/theme/safeArea';
import { ui } from '@/theme/classes';

// Safe-area + canvas background wrapper (plan §11.6). Scrolls by default; `scroll={false}` gives
// a fixed flex column (map/nav screens). Consistent 16pt gutters + 4-unit vertical rhythm.
// `footer` renders OUTSIDE the scroll area, pinned above the home indicator — task screens put
// their ActionBar here so the primary action is always reachable without scrolling (DESIGN.md:
// "keep primary actions reachable"), instead of sitting below the fold at the end of the content.
export function Screen({
  children,
  scroll = true,
  padTop = true,
  footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  /** Adds the 16pt visual gutter above the content. The SAFE-AREA inset is applied either way. */
  padTop?: boolean;
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const top = screenTopPadding(insets.top, padTop);

  const footerNode = footer ? (
    <View
      style={{
        paddingHorizontal: layout.screenInset,
        paddingBottom: insets.bottom + 8,
      }}
    >
      {footer}
    </View>
  ) : null;

  if (!scroll) {
    return (
      <View className={ui.screen}>
        <View
          className={ui.fixedContent}
          style={{
            paddingTop: top,
            paddingBottom: footer ? layout.screenInset : insets.bottom + layout.screenInset,
          }}
        >
          {children}
        </View>
        {footerNode}
      </View>
    );
  }
  return (
    <View className={ui.screen}>
      <ScrollView
        contentContainerClassName={ui.scrollContent}
        contentContainerStyle={{
          paddingTop: top,
          paddingBottom: footer ? layout.screenInset : insets.bottom + layout.scrollBottomInset,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
      {footerNode}
    </View>
  );
}

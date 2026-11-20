import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { AppText } from './AppText';
import { layout } from '@/theme/tokens';

/**
 * A titled region and the rhythm around it. Section spacing used to be a `gap-4` on the scroll
 * container plus a `mt-2 -mb-2` correction inside the label — two mechanisms fighting, and neither
 * visible at the call site. Here the section owns its own space: 24pt above the heading, 12pt below
 * it, nothing implicit.
 *
 * `first` drops the top gap for the section that opens a sheet, which already has its own padding.
 *
 * The heading is the mock's section label (Visual 2026): 13pt semibold in the muted ink, sentence case,
 * so a group is named without competing with the rows under it. The action beside it is amber, because
 * it is something the driver does.
 */
export function Section({
  title,
  action,
  first = false,
  children,
}: {
  title?: string;
  action?: { label: string; onPress: () => void };
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={{ paddingTop: first ? 0 : layout.sectionGap }}>
      {title ? (
        <View
          className="min-h-11 flex-row items-center justify-between gap-3"
          style={{ paddingBottom: 4 }}
        >
          <AppText variant="label" tone="muted" accessibilityRole="header">{title}</AppText>
          {action ? (
            <Pressable
              accessibilityRole="button"
              onPress={action.onPress}
              className="min-h-11 justify-center"
              hitSlop={8}
            >
              <AppText weight="medium" variant="supporting" tone="action" >{action.label}</AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View className="gap-3">{children}</View>
    </View>
  );
}

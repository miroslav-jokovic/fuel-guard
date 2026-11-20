import { Children, isValidElement, type ReactNode } from 'react';
import { View } from 'react-native';

/**
 * Where a separator starts, from what the row LEADS with — the row inset (`ui.listRow` px-4) plus
 * the leading element and its 12pt gap.
 *
 * Prop-shaped because `AttentionQueue` once drew its own separators inside a `Card` with a hardcoded
 * `ml-18`, correct only while every row carried both a disc and a glyph. Since V5 it renders through
 * `GroupedList` like every other group, so this rule has one caller and one place to be wrong.
 */
function separatorInsetFor(row: { disc?: unknown; icon?: unknown }): string {
  // Since V4 a `disc` row leads with the same 24pt glyph box as an `icon` row (no 44pt circle).
  if (row.icon) return 'ml-13'; // 16 + 24 glyph box + 12 gap
  return 'ml-4';
}

/** The same rule, asked of a rendered child. */
function separatorInset(row: ReactNode): string {
  if (!isValidElement<{ disc?: unknown; icon?: unknown }>(row)) return 'ml-4';
  return separatorInsetFor(row.props);
}

/**
 * One information group: rows on the canvas, with no card around them (Visual 2026 D-DV7). Separation
 * comes from the section label above and the space around the group. A hairline between rows starts
 * where the row's TEXT starts, so it reads as a divider between two labels and not a line through the
 * icon column.
 *
 * `-mx-4` cancels the row's own 16pt inset, so a row's text aligns with the screen inset (20pt) and
 * its pressed highlight runs into the gutter, the way the system's grouped lists behave. Until V4 the
 * group was a white rounded card, which is the "stack of white cards" look on D-DV14's banned list.
 */
export function GroupedList({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children);
  if (rows.length === 0) return null;

  return (
    <View className="-mx-4">
      {rows.map((row, index) => (
        <View key={index}>
          {row}
          {index < rows.length - 1 ? (
            <View className={`${separatorInset(row)} mr-4 h-px bg-edge-subtle`} />
          ) : null}
        </View>
      ))}
    </View>
  );
}

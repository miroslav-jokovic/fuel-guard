import { Children, isValidElement, type ReactNode } from 'react';
import { View } from 'react-native';

/**
 * Where a separator starts, from what the row LEADS with — the row inset (`ui.listRow` px-4) plus
 * the leading element and its 12pt gap.
 *
 * Exported and prop-shaped rather than element-shaped because `AttentionQueue` draws its own
 * separators inside a `Card` rather than a `GroupedList`, and had hardcoded `ml-18`. That constant
 * is correct only while every row carries both a disc and a glyph — true today, and silently wrong
 * the first time one does not, in the one list a driver reads when something has already gone wrong.
 * One rule, two callers.
 */
export function separatorInsetFor(row: { disc?: unknown; icon?: unknown }): string {
  if (row.disc && row.icon) return 'ml-18'; // 16 + 44 disc + 12 gap
  if (row.icon) return 'ml-13'; //             16 + 24 glyph box + 12 gap
  return 'ml-4';
}

/** The same rule, asked of a rendered child. */
function separatorInset(row: ReactNode): string {
  if (!isValidElement<{ disc?: unknown; icon?: unknown }>(row)) return 'ml-4';
  return separatorInsetFor(row.props);
}

/**
 * One contained information group with internal separators. This replaces the generic pattern of
 * rendering every setting, notification, or metadata row as its own floating card.
 *
 * The separator starts where the row's TEXT starts, so it reads as a divider between two labels
 * rather than a line drawn through the icon column. That inset is derived from each row's own props
 * because a group mixes disc rows, glyph rows and bare rows — a single constant is wrong for two of
 * the three, and the wrongness only shows up on a device.
 */
export function GroupedList({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children);
  if (rows.length === 0) return null;

  return (
    <View className="overflow-hidden rounded-xl bg-surface">
      {rows.map((row, index) => (
        <View key={index}>
          {row}
          {index < rows.length - 1 ? (
            <View className={`${separatorInset(row)} h-px bg-edge-subtle`} />
          ) : null}
        </View>
      ))}
    </View>
  );
}

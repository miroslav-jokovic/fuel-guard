import type { ComponentProps, ReactNode } from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { AppText, GroupedList, ListRow } from '@/components';
import type { DayRow } from './todayStatusModel';

const WORD_TONE = { live: 'accent', act: 'action', secondary: 'secondary' } as const;

/**
 * Today's time blocks ("Rest of the day", "Done today") as rows on the canvas (D-DV7, the mock's
 * Things-style list). What each row says is `todayStatusModel`; this only draws it.
 *
 * The trailing figure is the platform face with tabular digits (`numericInline`, D-DV15), so the
 * times in a column line up. A row with a word instead says it in its state colour, never as a pill.
 *
 * `children` are appended to the same group, for a row that is an action rather than a record
 * ("End shift").
 */
export function DayRows({ rows, children }: { rows: readonly DayRow[]; children?: ReactNode }) {
  const router = useRouter();
  return (
    <GroupedList>
      {rows.map((row) => <ListRow key={row.key} {...dayRowProps(row, (href) => router.push(href as Href))} />)}
      {children}
    </GroupedList>
  );
}

/**
 * One `DayRow` as `ListRow` props, for a group that is not a `DayRows` (the pre-shift rig row joins
 * the attention queue's group). A plain `ListRow` keeps `GroupedList`'s separator inset reading the
 * row's own `icon`, which a wrapper component would hide.
 */
export function dayRowProps(row: DayRow, push: (href: string) => void): ComponentProps<typeof ListRow> {
  const href = row.href;
  return {
    icon: row.icon,
    disc: row.tone,
    title: row.title,
    subtitle: row.subtitle,
    right: <Trailing row={row} />,
    onPress: href ? () => push(href) : undefined,
  };
}

function Trailing({ row }: { row: DayRow }) {
  if (row.word) {
    return <AppText variant="supporting" weight="semibold" tone={WORD_TONE[row.word.tone]}>{row.word.text}</AppText>;
  }
  if (!row.figure) return null;
  return (
    <View className="items-end">
      <AppText variant="numericInline">{row.figure}</AppText>
      {row.figureNote ? <AppText variant="caption" tone="muted" tabular>{row.figureNote}</AppText> : null}
    </View>
  );
}

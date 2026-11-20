import { View } from 'react-native';
import { AppText, GroupedList, ListRow, type Tone } from '@/components';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';
import type { LoadRowView } from './loadsListModel';

const GLYPH: Record<LoadRowView['state'], { icon: MaterialSymbolName; disc?: Tone }> = {
  live: { icon: 'local_shipping', disc: 'info' },
  ahead: { icon: 'schedule' },
  done: { icon: 'check_circle', disc: 'success' },
  off: { icon: 'cancel' },
};

/**
 * One time group of the Loads tab as rows on the canvas (Visual 2026 V6, DESIGN.md "Time groups").
 * The appointment is the trailing figure, in tabular digits so a column of times lines up, and only
 * the load being driven is cyan (D-DV5). The words are `loadsListModel`; this draws them.
 */
export function LoadRows({ rows, onOpen }: { rows: readonly LoadRowView[]; onOpen: (loadId: string) => void }) {
  return (
    <GroupedList>
      {rows.map((row) => (
        <ListRow
          key={row.key}
          icon={GLYPH[row.state].icon}
          disc={GLYPH[row.state].disc}
          title={row.title}
          subtitle={row.subtitle}
          onPress={() => onOpen(row.loadId)}
          right={
            row.figure ? (
              <View className="items-end">
                <AppText variant="numericInline" tone={row.state === 'live' ? 'accent' : 'primary'}>{row.figure}</AppText>
                {row.figureNote ? <AppText variant="caption" tone="muted" tabular>{row.figureNote}</AppText> : null}
              </View>
            ) : undefined
          }
        />
      ))}
    </GroupedList>
  );
}

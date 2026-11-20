import { AppText, GroupedList, ListRow } from '@/components';
import type { HazmatRowView, MissingPhotoRow } from './documentsModel';

const VERDICT_TONE = { done: 'success', stop: 'danger', act: 'action', live: 'accent', neutral: 'muted' } as const;
const VERDICT_DISC = { done: 'success', stop: 'danger', act: 'caution', live: 'info', neutral: undefined } as const;

/**
 * The missing photos (Visual 2026 V7, mock screen 7): what the driver can take now says "Take" in
 * amber (D-DV5: act); a later stop's photo says "Later"; a finished stop's gap is a record in amber
 * with no action (Q-DV7). The words are `documentsModel`.
 */
export function MissingPhotoRows({ rows, onTake }: { rows: readonly MissingPhotoRow[]; onTake: (row: MissingPhotoRow) => void }) {
  return (
    <GroupedList>
      {rows.map((row) => (
        <ListRow
          key={row.key}
          icon={row.when === 'record' ? 'warning' : 'photo_camera'}
          disc={row.when === 'later' ? undefined : 'caution'}
          title={row.title}
          subtitle={row.subtitle}
          onPress={row.when === 'take' ? () => onTake(row) : undefined}
          right={
            row.when === 'record' ? undefined : (
              <AppText variant="supporting" weight="semibold" tone={row.when === 'take' ? 'action' : 'muted'}>
                {row.when === 'take' ? 'Take' : 'Later'}
              </AppText>
            )
          }
        />
      ))}
    </GroupedList>
  );
}

/** Hazmat checks with each verdict as a word in its colour, never a pill (D-DV14). */
export function HazmatRows({ rows, onOpen }: { rows: readonly HazmatRowView[]; onOpen: (id: string) => void }) {
  return (
    <GroupedList>
      {rows.map((row) => (
        <ListRow
          key={row.key}
          icon={row.verdict.tone === 'done' ? 'check_circle' : row.verdict.tone === 'stop' ? 'error' : 'local_fire_department'}
          disc={VERDICT_DISC[row.verdict.tone]}
          title={row.title}
          subtitle={row.subtitle}
          onPress={() => onOpen(row.id)}
          right={<AppText variant="supporting" weight="semibold" tone={VERDICT_TONE[row.verdict.tone]}>{row.verdict.text}</AppText>}
        />
      ))}
    </GroupedList>
  );
}

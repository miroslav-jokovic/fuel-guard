import type { ReactNode } from 'react';
import { useRouter, type Href } from 'expo-router';
import { AppText, GroupedList, ListRow } from '@/components';
import type { AttentionRow } from './todayModel';

/**
 * The four things standing between the driver and their next action, or nothing at all.
 *
 * The 2026-09-07 critique found Today had no such module: a failed sync, a missing trailer, a
 * canceled load and an unread dispatch question each lived on a different screen, so the one screen
 * a driver actually opens could be entirely calm while three things were wrong. Ordering and caps
 * are `todayModel.attentionRows`, which is tested; this only draws them, as rows on the canvas
 * (D-DV7) since V5 rather than inside a card.
 */
export function AttentionQueue({
  rows,
  onOpen,
  children,
}: {
  rows: readonly AttentionRow[];
  onOpen?: (row: AttentionRow) => void;
  /** Rows appended to the same group (the pre-shift rig row, V5). */
  children?: ReactNode;
}) {
  const router = useRouter();
  if (rows.length === 0 && !children) return null;

  return (
    <GroupedList>
      {rows.map((row) => (
        <ListRow
          key={row.key}
          title={row.title}
          subtitle={row.subtitle}
          icon={row.icon}
          disc={row.tone}
          right={row.time ? <AppText variant="caption" tone="subtle" tabular>{row.time}</AppText> : undefined}
          onPress={
            row.href
              ? () => {
                  onOpen?.(row);
                  router.push(row.href as Href);
                }
              : undefined
          }
        />
      ))}
      {children}
    </GroupedList>
  );
}

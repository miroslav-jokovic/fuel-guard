import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { AppText, Card, ListRow } from '@/components';
import type { AttentionRow } from './todayModel';

/**
 * The four things standing between the driver and their next action, or nothing at all.
 *
 * The 2026-09-07 critique found Today had no such module: a failed sync, a missing trailer, a
 * canceled load and an unread dispatch question each lived on a different screen, so the one screen
 * a driver actually opens could be entirely calm while three things were wrong. Ordering and caps
 * are `todayModel.attentionRows`, which is tested; this only draws them.
 */
export function AttentionQueue({
  rows,
  onOpen,
}: {
  rows: readonly AttentionRow[];
  onOpen?: (row: AttentionRow) => void;
}) {
  const router = useRouter();
  if (rows.length === 0) return null;

  return (
    <Card variant="flat" padded={false}>
      {rows.map((row, index) => (
        <View key={row.key}>
          <ListRow
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
          {index < rows.length - 1 ? <View className="ml-18 h-px bg-edge-subtle" /> : null}
        </View>
      ))}
    </Card>
  );
}

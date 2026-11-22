import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import type { NotificationEvent } from '@silvicom/shared';
import {
  AppText,
  Banner,
  GroupedList,
  EmptyState,
  IconButton,
  ListRow,
  OfflineBanner,
  Screen,
  ScreenHeader,
  Section,
  Skeleton,
  SkeletonRows,
  type Tone,
} from '@/components';
import { useMarkRead, useNotifications } from '@/features/notifications/useNotifications';
import { resolveDeepLink } from '@/features/notifications/deepLink';
import { CATEGORY_ICON } from '@/features/notifications/categoryIcon';
import { useFeatures } from '@/session/useFeatures';

/**
 * The notification centre (Phase 6 / D53) — the honest fallback behind the push fast path: a driver
 * who denied the OS permission still sees everything here. Tapping a row marks it read and opens
 * the thing it's about (deep link translated to an app route — never trusted raw).
 *
 * This screen is the inbox ONLY. The category switches moved to `notification-settings.tsx`
 * (More › Settings) on 2026-11-23, when the owner read inbox + switches + the Messages row as one
 * page (Q-DF-7; the "split later" Direction B's Q-DB4 left open). That file says why.
 */

const SEVERITY_TONE: Record<string, Tone> = { info: 'info', warning: 'warning', critical: 'danger' };

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function NotificationsCentre() {
  const router = useRouter();
  const features = useFeatures();
  const q = useNotifications(features.isLoaded && features.enabled('notifications'));
  const markRead = useMarkRead();

  if (features.isLoaded && !features.enabled('notifications')) return <Redirect href="/home" />;
  if (!features.isLoaded) {
    return (
      <Screen padTop={false}>
        <ScreenHeader title="Notifications" onClose={() => router.back()} />
        <Skeleton className="h-15 w-full rounded-xl" />
      </Screen>
    );
  }

  const rows = q.data?.notifications ?? [];
  const unread = q.data?.unread ?? 0;
  const showSkeletons = q.isPending && !q.data;

  const openRow = (n: NotificationEvent) => {
    if (n.read_at === null) markRead.mutate([n.id]);
    router.push(resolveDeepLink(n.deep_link));
  };

  return (
    <Screen padTop={false} flow="sections">
      <ScreenHeader
        display
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : undefined}
        onClose={() => router.back()}
        right={
          unread > 0 ? (
            <IconButton
              name="done"
              label={markRead.isPending ? 'Marking notifications read' : 'Mark all notifications read'}
              variant="tonal"
              disabled={markRead.isPending}
              onPress={() => markRead.mutate(undefined)}
            />
          ) : undefined
        }
      />
      <OfflineBanner />

      {q.isError && !q.data ? (
        <Section>
          <Banner
            tone="danger"
            message={q.error.message || 'Could not load notifications.'}
            actionLabel="Retry"
            onAction={() => void q.refetch()}
          />
        </Section>
      ) : null}
      {markRead.isError ? (
        <Section>
          <Banner tone="danger" message={markRead.error.message || 'Could not mark notifications read.'} />
        </Section>
      ) : null}

      <Section title="Recent">
        {showSkeletons ? (
          <SkeletonRows count={3} />
        ) : rows.length === 0 && !(q.isError && !q.data) ? (
          <EmptyState
              icon="notifications"
              title="Nothing yet"
              subtitle="Fleet alerts, assignments, and shift updates land here."
            />
          
        ) : (
          <GroupedList>
            {rows.map((n) => (
                <ListRow
                  key={n.id}
                  icon={CATEGORY_ICON[n.category] ?? 'info'}
                  iconFill={n.read_at === null}
                  // Severity is the disc's tone, so an unread critical alert and an unread
                  // reminder are not the same object at a glance (D-DB6).
                  disc={SEVERITY_TONE[n.severity] ?? 'info'}
                  title={n.title}
                  subtitle={n.body ?? undefined}
                  onPress={() => openRow(n)}
                  // Swipe-to-act (V8 plan): the one action a notification already has, on an unread row.
                  swipeAction={n.read_at === null ? { label: 'Mark read', icon: 'done', onAction: () => markRead.mutate([n.id]) } : undefined}
                  right={
                    <View className="items-end gap-1">
                      <AppText variant="caption" tone="subtle" tabular>{timeLabel(n.created_at)}</AppText>
                      {/* A word in the live cyan, never a pill (Visual 2026 D-DV14). */}
                      {n.read_at === null ? <AppText variant="caption" weight="semibold" tone="accent">New</AppText> : null}
                    </View>
                  }
                />
            ))}
          </GroupedList>
        )}
      </Section>

    </Screen>
  );
}

import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
  isMutable,
  type NotificationCategory,
  type NotificationEvent,
} from '@fuelguard/shared';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  Icon,
  ListRow,
  OfflineBanner,
  Screen,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  type Tone,
} from '@/components';
import { useMarkRead, useNotifications, useUpdatePreferences } from '@/features/notifications/useNotifications';
import { resolveDeepLink } from '@/features/notifications/deepLink';
import { useFeatures } from '@/session/useFeatures';
import { haptics } from '@/lib/haptics';

/**
 * The notification centre (Phase 6 / D53) — the honest fallback behind the push fast path: a driver
 * who denied the OS permission still sees everything here. Tapping a row marks it read and opens
 * the thing it's about (deep link translated to an app route — never trusted raw). Preferences
 * live at the bottom: category mutes (minus the NON_MUTABLE set — a canceled load is not a
 * preference) — enforced server-side, recorded here.
 */

const SEVERITY_TONE: Record<string, Tone> = { info: 'info', warning: 'warning', critical: 'danger' };

const CATEGORY_ICON: Record<string, string> = {
  load_offered: 'local_shipping',
  load_changed: 'local_shipping',
  load_canceled: 'warning',
  message_received: 'mail',
  duty_auto_closed: 'schedule',
  performance_week: 'speed',
  training_due: 'school',
  hazmat_review: 'local_fire_department',
  hazmat_cleared: 'local_fire_department',
  hazmat_rejected: 'local_fire_department',
  system: 'info',
};

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
  const updatePrefs = useUpdatePreferences();
  const [prefsError, setPrefsError] = useState<string | null>(null);

  const muted = useMemo(
    () => new Set(q.data?.preferences.muted_categories ?? []),
    [q.data?.preferences.muted_categories],
  );

  if (features.isLoaded && !features.enabled('notifications')) return <Redirect href="/home" />;

  const rows = q.data?.notifications ?? [];
  const unread = q.data?.unread ?? 0;
  const showSkeletons = q.isPending && !q.data;

  const openRow = (n: NotificationEvent) => {
    if (n.read_at === null) markRead.mutate([n.id]);
    router.push(resolveDeepLink(n.deep_link) as never);
  };

  const toggleMute = async (category: NotificationCategory) => {
    setPrefsError(null);
    const next = new Set(muted);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    try {
      await updatePrefs.mutateAsync({
        muted_categories: [...next].filter((c): c is NotificationCategory =>
          (NOTIFICATION_CATEGORIES as readonly string[]).includes(c),
        ),
      });
      haptics.select();
    } catch (e) {
      setPrefsError(e instanceof Error ? e.message : 'Could not save your notification settings.');
    }
  };

  return (
    <Screen padTop={false}>
      <ScreenHeader
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : undefined}
        onClose={() => router.back()}
        right={
          unread > 0 ? (
            <Button label="Mark all read" variant="secondary" size="sm" onPress={() => markRead.mutate(undefined)} />
          ) : undefined
        }
      />
      <OfflineBanner />

      {q.isError && !q.data ? (
        <Banner
          tone="danger"
          message={q.error.message || 'Could not load notifications.'}
          actionLabel="Retry"
          onAction={() => void q.refetch()}
        />
      ) : null}

      {showSkeletons ? (
        <>
          <Skeleton className="h-[60px] w-full rounded-xl" />
          <Skeleton className="h-[60px] w-full rounded-xl" />
          <Skeleton className="h-[60px] w-full rounded-xl" />
        </>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="notifications"
          title="Nothing yet"
          subtitle="New loads, hazmat verdicts, shift events and your weekly score land here."
        />
      ) : (
        rows.map((n) => (
          <ListRow
            key={n.id}
            icon={(CATEGORY_ICON[n.category] ?? 'info') as never}
            iconFill={n.read_at === null}
            title={n.title}
            subtitle={n.body ?? undefined}
            onPress={() => openRow(n)}
            right={
              <View className="items-end gap-1">
                <Text className="text-xs text-ink-subtle" style={{ fontVariant: ['tabular-nums'] }}>
                  {timeLabel(n.created_at)}
                </Text>
                {n.read_at === null ? (
                  <Badge label="New" tone={SEVERITY_TONE[n.severity] ?? 'info'} />
                ) : null}
              </View>
            }
          />
        ))
      )}

      <SectionLabel>What you get told about</SectionLabel>
      {prefsError ? <Banner tone="danger" message={prefsError} /> : null}
      <Card>
        {NOTIFICATION_CATEGORIES.map((category) => (
          <ListRow
            key={category}
            title={NOTIFICATION_CATEGORY_LABELS[category]}
            subtitle={isMutable(category) ? undefined : 'Always on — safety-critical'}
            onPress={isMutable(category) ? () => void toggleMute(category) : undefined}
            right={
              isMutable(category) ? (
                <Icon
                  name={muted.has(category) ? 'visibility_off' : 'check_circle'}
                  size={22}
                  className={muted.has(category) ? 'text-ink-subtle' : 'text-brand'}
                />
              ) : (
                <Icon name="lock" size={18} className="text-ink-subtle" />
              )
            }
          />
        ))}
      </Card>
      <Text className="pb-2 text-center text-xs text-ink-subtle">
        Muting is enforced by the server, so a muted category stays quiet on every device.
      </Text>
    </Screen>
  );
}

import { useMemo, useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
  isMutable,
  type NotificationCategory,
} from '@silvicom/shared';
import {
  AppText,
  Banner,
  GroupedList,
  Icon,
  ListRow,
  OfflineBanner,
  Screen,
  ScreenHeader,
  Section,
  Skeleton,
  ToggleRow,
} from '@/components';
import { useNotifications, useUpdatePreferences } from '@/features/notifications/useNotifications';
import { useFeatures } from '@/session/useFeatures';
import { haptics } from '@/lib/haptics';

/**
 * Notification settings: which categories may reach this driver. These are category mutes, minus
 * the NON_MUTABLE set (a canceled load is not a preference). The server enforces them, so a muted
 * category stays quiet on every device.
 *
 * WHY THIS IS ITS OWN SCREEN (owner, 2026-11-23, Q-DF-7 in
 * docs/plans/drivers-app/redesign-2026/DRIVER-APP-FEATURE-LIST-FOR-RULING.md). Direction B's Q-DB4
 * kept these switches at the bottom of the notification inbox, with "split later" as the fallback.
 * The owner read that screen, beside the Messages row on More, as messages and notification
 * settings sharing one page, partly because one switch is the `message_received` category. The
 * three jobs now live in three places:
 *   - talking is Messages;
 *   - what arrived is the inbox, opened from the Today bell;
 *   - what may arrive is here, under More › Settings.
 *
 * It reads the same ['me','notifications'] query as the inbox and the bell. The preferences travel
 * on that response, so there is no second request and no second cache for one fact.
 */
export default function NotificationSettings() {
  const router = useRouter();
  const features = useFeatures();
  const q = useNotifications(features.isLoaded && features.enabled('notifications'));
  const updatePrefs = useUpdatePreferences();
  const [prefsError, setPrefsError] = useState<string | null>(null);

  const muted = useMemo(
    () => new Set(q.data?.preferences.muted_categories ?? []),
    [q.data?.preferences.muted_categories],
  );

  if (features.isLoaded && !features.enabled('notifications')) return <Redirect href="/more" />;

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
    <Screen padTop={false} flow="sections">
      <ScreenHeader display title="Notification settings" subtitle="What may alert you" onClose={() => router.back()} />
      <OfflineBanner />

      {q.isError && !q.data ? (
        <Section>
          <Banner
            tone="danger"
            message={q.error.message || 'Could not load your notification settings.'}
            actionLabel="Retry"
            onAction={() => void q.refetch()}
          />
        </Section>
      ) : null}

      <Section title="Alert me about">
        {prefsError ? <Banner tone="danger" message={prefsError} /> : null}
        {!q.data ? (
          // A switch drawn before the preferences load would show every category ON, which is a
          // false statement about a driver who muted one. Draw nothing until we know.
          q.isError ? null : <Skeleton className="w-full rounded-xl" style={{ height: 192 }} />
        ) : (
          <GroupedList>
            {NOTIFICATION_CATEGORIES.map((category) => (
              isMutable(category) ? (
                <ToggleRow
                  key={category}
                  title={NOTIFICATION_CATEGORY_LABELS[category]}
                  value={!muted.has(category)}
                  disabled={updatePrefs.isPending}
                  onValueChange={() => { void toggleMute(category); }}
                />
              ) : (
                <ListRow
                  key={category}
                  title={NOTIFICATION_CATEGORY_LABELS[category]}
                  subtitle="Always on · safety-critical"
                  right={<Icon name="lock" size={18} className="text-ink-subtle" />}
                />
              )
            ))}
          </GroupedList>
        )}
        <AppText variant="caption" tone="subtle" className="pb-2 text-center">
          Your fleet&apos;s server applies these, so a muted alert stays quiet on every phone you use.
        </AppText>
      </Section>
    </Screen>
  );
}

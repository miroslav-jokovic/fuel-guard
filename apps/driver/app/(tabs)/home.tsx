import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  AppText,
  Avatar,
  Banner,
  EmptyState,
  NeedsAttentionNote,
  OfflineBanner,
  Screen,
  SectionLabel,
  Skeleton,
} from '@/components';
import { CurrentLoadCard } from '@/features/loads/CurrentLoadCard';
import { LoadCard } from '@/features/loads/LoadCard';
import { bucketLoads, toActive, toSummary } from '@/features/loads/loadViewModel';
import { useLoads } from '@/features/loads/useLoads';
import { DutyCard } from '@/features/duty/DutyCard';
import { dutyView, useShift } from '@/features/duty/useDuty';
import { firstName, useDriverContext } from '@/session/useDriverContext';
import { useFeatures } from '@/session/useFeatures';
import { useNotifications } from '@/features/notifications/useNotifications';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { useThreads } from '@/features/messages/useMessages';
import { MessagesButton } from '@/features/messages/MessagesButton';
import { homeScoreSummary } from '@/features/score/scoreModel';
import { useDriverScore } from '@/features/score/useDriverScore';
import { UpdateReadyBanner } from '@/features/updates/UpdateReadyBanner';

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export default function Home() {
  const router = useRouter();
  const driver = useDriverContext();
  const shift = useShift();
  const loads = useLoads();
  const score = useDriverScore();
  const { enabled } = useFeatures();
  const loadsEnabled = enabled('tab.loads');
  const scoreEnabled = enabled('tab.score');
  const notificationsEnabled = enabled('notifications');
  const notifs = useNotifications(notificationsEnabled);
  const messagesEnabled = enabled('messages');
  const threads = useThreads(messagesEnabled);

  const duty = dutyView(shift.data);
  const buckets = bucketLoads(loads.data?.loads ?? []);
  const current = buckets.current[0] ?? null;
  const nextUp = buckets.upcoming[0] ?? null;
  const weekScore = homeScoreSummary(score.data);
  const driverName = firstName(driver.data?.driver.full_name);
  const showSkeletons = driver.isPending && !driver.data;

  const dutyModule = (
    <DutyCard
      duty={duty}
      loading={shift.isPending && !shift.data}
      onStart={() => router.push('/duty/check-in')}
      onChange={() => router.push('/duty/check-in?mode=swap')}
      onEnd={() => router.push('/duty/end-shift')}
    />
  );

  const loadModule = loadsEnabled ? (
    loads.isPending && !loads.data ? (
      <Skeleton className="h-44 w-full rounded-2xl" />
    ) : current ? (
      <CurrentLoadCard
        load={toActive(current)}
        onNavigate={() => router.push(`/loads/${current.id}` as never)}
        onOpen={() => router.push(`/loads/${current.id}` as never)}
      />
    ) : nextUp ? (
      <LoadCard load={toSummary(nextUp)} onPress={() => router.push(`/loads/${nextUp.id}` as never)} />
    ) : (
      <EmptyState title="Nothing assigned yet" subtitle="Released loads from dispatch will appear here." />
    )
  ) : null;

  return (
    <Screen>
      <UpdateReadyBanner />
      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          {showSkeletons ? (
            <View className="gap-1">
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-4 w-40" />
            </View>
          ) : (
            <>
              <AppText variant="screenTitle" accessibilityRole="header">Today</AppText>
              <AppText variant="supporting" tone="muted">{driverName} · {todayLabel()}</AppText>
            </>
          )}
        </View>
        {messagesEnabled ? (
          <MessagesButton unread={threads.data?.unread_total ?? 0} onPress={() => router.push('/messages')} />
        ) : null}
        {notificationsEnabled ? (
          <NotificationBell unread={notifs.data?.unread ?? 0} onPress={() => router.push('/notifications')} />
        ) : null}
        {showSkeletons ? (
          <Skeleton className="h-10 w-10 rounded-full" />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open settings"
            onPress={() => router.push('/settings')}
            className="rounded-full active:opacity-70"
          >
            <Avatar name={driver.data?.driver.full_name ?? driverName} size={40} />
          </Pressable>
        )}
      </View>

      <OfflineBanner />
      <NeedsAttentionNote />

      {driver.isError && !driver.data ? (
        <Banner
          tone="danger"
          message={driver.error.message || 'Could not load your profile.'}
          actionLabel="Retry"
          onAction={() => void driver.refetch()}
        />
      ) : null}

      {current && loadModule ? (
        <>
          <SectionLabel>Current work</SectionLabel>
          {loadModule}
          <SectionLabel>Duty</SectionLabel>
          {dutyModule}
        </>
      ) : (
        <>
          <SectionLabel>Duty</SectionLabel>
          {dutyModule}
          {loadModule ? <SectionLabel>Next load</SectionLabel> : null}
          {loadModule}
        </>
      )}

      {scoreEnabled && weekScore ? (
        <>
          <SectionLabel>This week</SectionLabel>
          <View className="flex-row items-center rounded-xl bg-surface-muted px-4 py-3">
            <View className="flex-1 gap-0.5">
              <AppText variant="caption" tone="muted">Driver score</AppText>
              <AppText variant="numericCompact" tabular>{weekScore.scoreValue}</AppText>
            </View>
            <View className="h-10 w-px bg-edge" />
            <View className="flex-1 items-end gap-0.5">
              <AppText variant="caption" tone="muted">Fleet rank</AppText>
              <View className="flex-row items-baseline gap-1">
                <AppText variant="numericCompact" tabular>{weekScore.rankValue}</AppText>
                {weekScore.rankUnit ? <AppText variant="caption" tone="muted">{weekScore.rankUnit}</AppText> : null}
              </View>
            </View>
          </View>
        </>
      ) : null}
    </Screen>
  );
}

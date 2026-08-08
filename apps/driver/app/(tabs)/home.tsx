import { Pressable, View, useWindowDimensions } from 'react-native';
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
import { layout } from '@/theme/tokens';

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export default function Home() {
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= layout.largeTextBreakpoint;
  const driver = useDriverContext();
  const shift = useShift();
  const { enabled } = useFeatures();
  const loadsEnabled = enabled('tab.loads');
  const scoreEnabled = enabled('tab.score');
  const loads = useLoads(loadsEnabled);
  const score = useDriverScore(scoreEnabled);
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

  const dutyModule = shift.isError && !shift.data ? (
    <Banner
      tone="danger"
      message="Could not verify your duty status. Retry before claiming different equipment."
      actionLabel="Retry"
      onAction={() => void shift.refetch()}
    />
  ) : (
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
      <View className={largeText ? 'gap-2' : 'flex-row items-center gap-2'}>
        <View className={largeText ? '' : 'flex-1'}>
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
        <View className={`flex-row items-center gap-2 ${largeText ? 'self-end' : ''}`}>
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
              className="h-11 w-11 items-center justify-center rounded-full active:bg-surface-selected"
            >
              <Avatar name={driver.data?.driver.full_name ?? driverName} size={40} />
            </Pressable>
          )}
        </View>
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
          <View className={`${largeText ? 'gap-2' : 'flex-row items-center'} rounded-xl bg-surface-muted px-4 py-3`}>
            <View className={`${largeText ? '' : 'flex-1'} gap-0.5`}>
              <AppText variant="caption" tone="muted">Driver score</AppText>
              <AppText variant="numericCompact" tabular>{weekScore.scoreValue}</AppText>
            </View>
            <View className={largeText ? 'h-px w-full bg-edge' : 'h-10 w-px bg-edge'} />
            <View className={`${largeText ? 'items-start' : 'flex-1 items-end'} gap-0.5`}>
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

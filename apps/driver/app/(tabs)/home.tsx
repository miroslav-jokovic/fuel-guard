import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Avatar,
  Banner,
  EmptyState,
  NeedsAttentionNote,
  OfflineBanner,
  Screen,
  SectionLabel,
  Skeleton,
  StatTile,
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

function timeGreeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Home (plan §13.5, reframed by D41 and D51): what the driver needs in a two-second glance —
 * who they are, what they are driving, and what they are working. Cached-first, so a cold start in
 * airplane mode renders real data; skeletons appear only when there is genuinely nothing cached.
 */
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

  return (
    <Screen>
      <View className="flex-row items-center gap-3">
        <View className="flex-1 gap-0.5">
          {showSkeletons ? (
            <>
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="mt-1 h-4 w-1/3" />
            </>
          ) : (
            <>
              <Text className="text-2xl font-sans-bold text-ink">
                {timeGreeting()}, {driverName}
              </Text>
              <Text className="text-sm text-ink-muted">{todayLabel()}</Text>
            </>
          )}
        </View>
        {messagesEnabled ? (
          <MessagesButton
            unread={threads.data?.unread_total ?? 0}
            onPress={() => router.push('/messages')}
          />
        ) : null}
        {notificationsEnabled ? (
          <NotificationBell
            unread={notifs.data?.unread ?? 0}
            onPress={() => router.push('/notifications')}
          />
        ) : null}
        {showSkeletons ? (
          <Skeleton className="h-11 w-11 rounded-full" />
        ) : (
          <Avatar name={driver.data?.driver.full_name ?? driverName} size={44} />
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

      <SectionLabel>Today</SectionLabel>
      <DutyCard
        duty={duty}
        loading={shift.isPending && !shift.data}
        onStart={() => router.push('/duty/check-in')}
        onChange={() => router.push('/duty/check-in?mode=swap')}
        onEnd={() => router.push('/duty/end-shift')}
      />

      {/* Load sections hide WITH the Loads tab (D-PM1) — a block is all-on or all-off. */}
      {loadsEnabled ? (
        <>
          <SectionLabel>{current ? 'Active work' : 'Next assignment'}</SectionLabel>
          {loads.isPending && !loads.data ? (
            <Skeleton className="h-[220px] w-full rounded-xl" />
          ) : current ? (
            <CurrentLoadCard
              load={toActive(current)}
              onNavigate={() => router.push(`/loads/${current.id}` as never)}
              onOpen={() => router.push(`/loads/${current.id}` as never)}
            />
          ) : nextUp ? (
            <LoadCard load={toSummary(nextUp)} onPress={() => router.push(`/loads/${nextUp.id}` as never)} />
          ) : (
            <EmptyState
              icon="local_shipping"
              title="Nothing assigned yet"
              subtitle="New loads from dispatch appear here as soon as they're released."
            />
          )}
        </>
      ) : null}

      {scoreEnabled && weekScore ? (
        <>
          <SectionLabel>This week</SectionLabel>
          <View className="flex-row gap-3">
            <StatTile
              label="Score"
              value={weekScore.scoreValue}
              spark={weekScore.scoreSpark}
              trend={weekScore.scoreTrend}
            />
            <StatTile
              label="Rank"
              value={weekScore.rankValue}
              unit={weekScore.rankUnit}
              icon="military_tech"
            />
          </View>
        </>
      ) : null}
    </Screen>
  );
}

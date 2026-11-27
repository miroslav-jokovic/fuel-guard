import { useEffect, useMemo, useState } from 'react';
import { Pressable } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { AppText, Banner, ListRow, OfflineBanner, Screen, Section, Skeleton } from '@/components';
import { bucketLoads } from '@/features/loads/loadViewModel';
import { useLoads } from '@/features/loads/useLoads';
import { dutyView, useShift } from '@/features/duty/useDuty';
import { shiftDurationLabel } from '@/features/duty/dutyFormat';
import { useHazmatChecks } from '@/features/hazmat/useHazmatChecks';
import { useThreads } from '@/features/messages/useMessages';
import { useMarkRead, useNotifications } from '@/features/notifications/useNotifications';
import { homeScoreSummary } from '@/features/score/scoreModel';
import { useDriverScore, useLeaderboard } from '@/features/score/useDriverScore';
import { buildLeaderboardView } from '@/features/score/leaderboardModel';
import { AttentionQueue } from '@/screens/today/AttentionQueue';
import { dayRowProps, DayRows } from '@/screens/today/DayRows';
import { Leaderboard } from '@/screens/today/Leaderboard';
import { ScoreRows } from '@/screens/today/ScoreRows';
import { StartShiftBar, useStartShortcut } from '@/screens/today/StartShift';
import { TodayHeader } from '@/screens/today/TodayHeader';
import { TodayStatus } from '@/screens/today/TodayStatus';
import { attentionRows, shouldSkeletonHero, SKELETON_HEIGHTS, todayAlerts, todayState, upNextLoads } from '@/screens/today/todayModel';
import {
  activeLoadStatus,
  activeNextStep,
  betweenLoadsNextStep,
  betweenLoadsStatus,
  doneTodayRows,
  preShiftStatus,
  remainingStopRows,
  rigRow,
  startRigRow,
  upcomingLoadRows,
} from '@/screens/today/todayStatusModel';
import { UpdateReadyBanner } from '@/features/updates/UpdateReadyBanner';
import { useDriverContext } from '@/session/useDriverContext';
import { useFeatures } from '@/session/useFeatures';
import { useSyncState } from '@/data/sync';
import { useIsOnline } from '@/lib/connectivity';
import { haptics } from '@/lib/haptics';
import { useAppUpdate } from '@/features/updates/useAppUpdate';

/**
 * Today (Visual 2026 V5, the V1 mock's screens 1, 3 and 9): the title, the status block, ONE next
 * step, then the day as rows on the canvas. Four states, not one template (D-DB7, `todayState`).
 *
 * This file is composition ONLY. What the block, the next step and every row say is
 * `todayStatusModel.ts`; the attention queue's order and caps, the alert order and the skeleton rule
 * are `todayModel.ts`. Both are tested, because getting any of them wrong is invisible on a simulator
 * with three fixtures and obvious to a driver with a real day.
 */
export default function Home() {
  const router = useRouter();
  const driver = useDriverContext();
  const shift = useShift();
  const { enabled, scoreLeaderboard } = useFeatures();
  const loadsEnabled = enabled('tab.loads');
  const scoreEnabled = enabled('tab.score');
  const leaderboardEnabled = scoreEnabled && scoreLeaderboard;
  const notificationsEnabled = enabled('notifications');
  const messagesEnabled = enabled('messages');
  const hazmatEnabled = enabled('hazmat.capture');

  const loads = useLoads(loadsEnabled);
  const score = useDriverScore(scoreEnabled);
  const leaderboard = useLeaderboard(leaderboardEnabled);
  const notifs = useNotifications(notificationsEnabled);
  const threads = useThreads(messagesEnabled);
  const hazmat = useHazmatChecks(hazmatEnabled);
  const sync = useSyncState();
  const markRead = useMarkRead();

  // The countdown and the on-duty time are minutes; the screen re-reads the clock once a minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const duty = dutyView(shift.data);
  const buckets = bucketLoads(loads.data?.loads ?? []);
  const current = buckets.current[0] ?? null;
  const weekScore = homeScoreSummary(score.data);
  const board = buildLeaderboardView(leaderboard.data);
  const viewerId = driver.data?.driver.id ?? '';
  const elapsed = shiftDurationLabel(duty.startedAt, now);

  const state = todayState({
    duty,
    currentLoad: current,
    shiftFailed: shift.isError && !shift.data,
    driverFailed: driver.isError && !driver.data,
  });
  const recovery = state === 'recovery';
  const shortcut = useStartShortcut(state === 'preShift');

  const rows = useMemo(
    () => attentionRows({
      sync,
      duty,
      currentLoad: current,
      notifications: notifs.data?.notifications ?? [],
      threads: threads.data?.threads ?? [],
      hazmat: hazmat.data?.loads ?? [],
      viewerId,
    }),
    [sync, duty, current, notifs.data, threads.data, hazmat.data, viewerId],
  );

  const online = useIsOnline();
  const { ready: updateReady } = useAppUpdate();
  const [alertsExpanded, setAlertsExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const alerts = todayAlerts({ recovery, offline: !online, pendingSync: sync.pending, updateReady });

  // Between loads and before the shift the first upcoming load IS the status block, so the rows
  // start after it; mid-run the block is the current stop and the next load is a row.
  const upNext = upNextLoads(buckets.upcoming, state === 'activeLoad' ? 1 : 3);
  const blockLoad = state === 'activeLoad' ? null : (upNext[0] ?? null);
  const laterLoads = state === 'activeLoad' ? upNext : upNext.slice(1);

  const status =
    state === 'activeLoad' && current ? activeLoadStatus(current, now)
    : state === 'preShift' ? preShiftStatus({ unit: shortcut?.vehicle.unit_number ?? null, firstLoad: blockLoad, loadsEnabled, now })
    : betweenLoadsStatus({ elapsed, unit: duty.vehicleUnit, nextLoad: blockLoad, loadsEnabled, now });
  // Before the shift the one action is Start shift, pinned in the footer, so there is no next step.
  const next =
    state === 'activeLoad' && current ? activeNextStep(current)
    : state === 'betweenLoads' ? betweenLoadsNextStep(blockLoad)
    : null;

  const restOfDay = [
    ...(current ? remainingStopRows(current) : []),
    ...upcomingLoadRows(laterLoads, now),
    ...(duty.onDuty ? [rigRow({ vehicleUnit: duty.vehicleUnit, trailerUnit: duty.trailerUnit, elapsed })] : []),
  ];
  const doneToday = doneTodayRows({ current, previous: buckets.previous, now });

  return (
    <Screen
      flow="sections"
      footer={state === 'preShift' ? <StartShiftBar shortcut={shortcut} /> : undefined}
      // Six independent queries; a driver whose data went stale in a dead zone re-asks all of them.
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void Promise.allSettled([
          shift.refetch(),
          driver.refetch(),
          loads.refetch(),
          notifs.refetch(),
          threads.refetch(),
          leaderboard.refetch(),
        ]).finally(() => setRefreshing(false));
      }}
    >
      <TodayHeader
        messages={messagesEnabled ? { unread: threads.data?.unread_total ?? 0, onPress: () => router.push('/messages') } : undefined}
        notifications={notificationsEnabled ? { unread: notifs.data?.unread ?? 0, onPress: () => router.push('/notifications') } : undefined}
      />

      {/* ONE alert leads; the rest collapse behind "+n more". Order is `todayAlerts`. */}
      {alerts.length > 1 && !alertsExpanded ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Show ${alerts.length - 1} more alert${alerts.length - 1 === 1 ? '' : 's'}`}
          onPress={() => {
            haptics.select();
            setAlertsExpanded(true);
          }}
          className="min-h-11 justify-center"
        >
          <AppText variant="caption" tone="muted">{`+${alerts.length - 1} more · tap to show`}</AppText>
        </Pressable>
      ) : null}
      {alertsExpanded || alerts[0] === 'update' ? <UpdateReadyBanner /> : null}
      {alertsExpanded || alerts[0] === 'offline' ? <OfflineBanner /> : null}

      {/*
        * RECOVERY SHOWS THE ERROR AND NOTHING ELSE. With the duty or profile query failed the app does
        * not know whether the driver is on duty, so a block saying "Off duty" would be a claim a driver
        * is legally accountable for, and every row under it a guess.
        */}
      {recovery ? (
        <Section>
          <Banner
            tone="danger"
            message={
              shift.isError && !shift.data
                ? 'Could not verify your duty status. Retry before claiming different equipment.'
                : (driver.error?.message ?? 'Could not load your profile.')
            }
            actionLabel="Retry"
            onAction={() => {
              void shift.refetch();
              void driver.refetch();
            }}
          />
        </Section>
      ) : (
        <Section>
          {shouldSkeletonHero({ loadsEnabled, loadsLoading: loads.isLoading, state }) ? (
            <Skeleton className="w-full rounded-xl" style={{ height: SKELETON_HEIGHTS.heroCard }} />
          ) : (
            <TodayStatus status={status} next={next} openLoadId={current?.id ?? blockLoad?.id} />
          )}
        </Section>
      )}

      {!recovery && (rows.length > 0 || (state === 'preShift' && shortcut)) ? (
        <Section title={state === 'preShift' ? 'Before you start' : 'Needs your attention'}>
          <AttentionQueue rows={rows} onOpen={(row) => (row.marksRead?.length ? markRead.mutate(row.marksRead) : undefined)}>
            {state === 'preShift' && shortcut ? (
              <ListRow {...dayRowProps(startRigRow(shortcut.vehicle.unit_number, shortcut.trailer?.unit_number ?? null), (href) => router.push(href as Href))} />
            ) : null}
          </AttentionQueue>
        </Section>
      ) : null}

      {!recovery && (restOfDay.length > 0 || duty.onDuty) ? (
        <Section title={state === 'preShift' ? 'Later' : 'Rest of the day'}>
          <DayRows rows={restOfDay}>
            {/* Duty lives on Today (D-DB17), so ending the shift is a row here, never in More. */}
            {duty.onDuty ? <ListRow icon="logout" title="End shift" onPress={() => router.push('/duty/end-shift')} /> : null}
          </DayRows>
        </Section>
      ) : null}

      {!recovery && doneToday.length > 0 ? (
        <Section title="Done today">
          <DayRows rows={doneToday} />
        </Section>
      ) : null}

      {!recovery && scoreEnabled && weekScore ? (
        <Section title={weekScore.recentWeeks[0] ? `Your score · ${weekScore.recentWeeks[0].label}` : 'Your score'}>
          <ScoreRows score={weekScore} onOpen={() => router.push('/score')} />
        </Section>
      ) : null}

      {/* The fleet, after the driver's own week (D-DB18). Absent, not empty, when the org opted out;
          a failed fetch shows nothing rather than a board that might be stale. */}
      {!recovery && leaderboardEnabled && weekScore && (leaderboard.data || leaderboard.isLoading) ? (
        <Section title={board.weekLabel ? `Fleet leaderboard · ${board.weekLabel}` : 'Fleet leaderboard'}>
          <Leaderboard view={board} loading={leaderboard.isLoading && !leaderboard.data} />
        </Section>
      ) : null}
    </Screen>
  );
}

import { useMemo } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner, Card, EmptyState, OfflineBanner, Screen, Section, Skeleton, useToast } from '@/components';
import { bucketLoads } from '@/features/loads/loadViewModel';
import { useLoads } from '@/features/loads/useLoads';
import { dutyView, useShift, useStartShift } from '@/features/duty/useDuty';
import { useHazmatChecks } from '@/features/hazmat/useHazmatChecks';
import { useThreads } from '@/features/messages/useMessages';
import { useMarkRead, useNotifications } from '@/features/notifications/useNotifications';
import { homeScoreSummary } from '@/features/score/scoreModel';
import { useDriverScore } from '@/features/score/useDriverScore';
import { CurrentLoadHero, DutyStrip } from '@/screens/today/TodayHero';
import { AttentionQueue } from '@/screens/today/AttentionQueue';
import { UpNextRow } from '@/screens/today/UpNext';
import { WeekStrip } from '@/screens/today/WeekStrip';
import { StartDayCard } from '@/screens/today/StartDayCard';
import { attentionRows, shouldSkeletonHero, SKELETON_HEIGHTS, todayState, upNextLoads } from '@/screens/today/todayModel';
import { UpdateReadyBanner } from '@/features/updates/UpdateReadyBanner';
import { firstName, useDriverContext } from '@/session/useDriverContext';
import { useFeatures } from '@/session/useFeatures';
import { useSyncState } from '@/data/sync';
import { writeLastEquipment } from '@/lib/lastEquipment';

/**
 * Today, as four screens rather than one template (D-DB7, `todayModel.todayState`).
 *
 * This file is composition ONLY: which modules appear, in which order, per state. Every rule that
 * decides what those modules contain lives in `todayModel.ts`, where it can be tested — the
 * ordering of the attention queue and the "+n more" collapse in particular, because getting either
 * wrong is invisible on a simulator with three fixtures and obvious to a driver with a real day.
 */
export default function Home() {
  const router = useRouter();
  const driver = useDriverContext();
  const shift = useShift();
  const { enabled } = useFeatures();
  const loadsEnabled = enabled('tab.loads');
  const scoreEnabled = enabled('tab.score');
  const notificationsEnabled = enabled('notifications');
  const messagesEnabled = enabled('messages');
  const hazmatEnabled = enabled('hazmat.capture');

  const loads = useLoads(loadsEnabled);
  const score = useDriverScore(scoreEnabled);
  const notifs = useNotifications(notificationsEnabled);
  const threads = useThreads(messagesEnabled);
  const hazmat = useHazmatChecks(hazmatEnabled);
  const sync = useSyncState();
  const markRead = useMarkRead();
  const startShift = useStartShift();
  const toast = useToast();

  const duty = dutyView(shift.data);
  const buckets = bucketLoads(loads.data?.loads ?? []);
  const current = buckets.current[0] ?? null;
  const weekScore = homeScoreSummary(score.data);
  // `full_name ?? firstName(full_name)` was always the first operand when a name existed, so the
  // duty strip greeted a driver with their full legal name and `firstName` only ever produced its
  // own fallback. A driver is greeted by their first name or not at all.
  const driverName = firstName(driver.data?.driver.full_name);
  const viewerId = driver.data?.driver.id ?? '';

  const state = todayState({
    duty,
    currentLoad: current,
    shiftFailed: shift.isError && !shift.data,
    driverFailed: driver.isError && !driver.data,
  });

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

  const loadingShell = driver.isPending && !driver.data;
  // Between loads a driver is choosing what is next, so they get two; mid-run they get one, because
  // the load in front of them is the answer to "what now".
  const upNext = upNextLoads(buckets.upcoming, state === 'activeLoad' ? 1 : 2);

  const hero = (
    <View className="gap-4">
      <DutyStrip
        duty={duty}
        name={driverName}
        loading={loadingShell}
        // `dutyView(undefined).onDuty` is `false`, so a FAILED shift query rendered as the positive
        // claim "Off duty" — in navigationTitle weight, at the top of the screen, while the banner
        // below said the app could not verify it. A driver is legally accountable for that line.
        // Absence is now its own state (DESIGN.md: "a screen built on data that failed to load says
        // so first").
        dutyKnown={state !== 'recovery' || Boolean(shift.data)}
        messages={messagesEnabled ? { unread: threads.data?.unread_total ?? 0, onPress: () => router.push('/messages') } : undefined}
        notifications={notificationsEnabled ? { unread: notifs.data?.unread ?? 0, onPress: () => router.push('/notifications') } : undefined}
      />
      {/*
        * The skeleton stands in for a LOAD, so it may only appear when a load is what this card is
        * waiting for. Two bugs lived in the old condition (`loads.isPending && !loads.data`):
        *
        * 1. A DISABLED query is `isPending` forever. `useLoads(loadsEnabled)` passes `enabled:false`
        *    when an org has the Loads tab off, and TanStack v5 reports that as pending with no data
        *    — so those fleets saw a 332pt grey rectangle where the start-shift card belongs, on
        *    every launch, permanently. `isLoading` (pending AND fetching) is false for a disabled
        *    query, which is the distinction the old condition could not make. The Up next section
        *    below already guarded on `loadsEnabled`; the hero did not.
        * 2. `StartDayCard` reads duty and equipment, never `loads`. Blocking it on a loads request
        *    made a driver at 05:40 wait on an answer that cannot change what the card says
        *    (DESIGN.md: "Every vertical region must answer a driver question… If it does none of
        *    these, remove it").
        *
        * So: only skeleton when a load decides the card, and never before the shift has started.
        */}
      {shouldSkeletonHero({ loadsEnabled, loadsLoading: loads.isLoading, state }) ? (
        <Skeleton className="w-full rounded-xl" style={{ height: SKELETON_HEIGHTS.heroCard }} />
      ) : current ? (
        <CurrentLoadHero
          load={current}
          onWorkStop={(stopId) => router.push(`/loads/${current.id}/stop/${stopId}` as never)}
          onOpenLoad={() => router.push(`/loads/${current.id}` as never)}
        />
      ) : (
        <StartDayCard
          dutyKnown={state !== 'recovery' || Boolean(shift.data)}
          onDuty={duty.onDuty}
          starting={startShift.isPending}
          onStart={() => router.push('/duty/check-in')}
          onChange={() => router.push('/duty/check-in?mode=swap')}
          onQuickStart={(shortcut) => {
            void startShift
              .mutateAsync({
                vehicleId: shortcut.vehicle.id,
                vehicleUnit: shortcut.vehicle.unit_number,
                ...(shortcut.trailer
                  ? { trailerId: shortcut.trailer.id, trailerUnit: shortcut.trailer.unit_number }
                  : {}),
                takeOver: false,
              })
              .then(() => {
                // Remember what actually started the day, so tomorrow's shortcut is right even when
                // today's differed from yesterday's.
                void writeLastEquipment({
                  vehicleId: shortcut.vehicle.id,
                  trailerId: shortcut.trailer?.id ?? null,
                });
                toast.show(`On duty · Unit ${shortcut.vehicle.unit_number}`);
              });
          }}
        />
      )}
    </View>
  );

  return (
    <Screen hero={hero} flow="sections">
      <UpdateReadyBanner />
      <OfflineBanner />

      {state === 'recovery' ? (
        <Section first>
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
      ) : null}

      {rows.length > 0 ? (
        <Section title={state === 'preShift' ? 'Before you roll' : 'Needs your attention'} first={state !== 'recovery'}>
          <AttentionQueue
            rows={rows}
            onOpen={(row) => {
              if (row.marksRead?.length) markRead.mutate(row.marksRead);
            }}
          />
        </Section>
      ) : null}

      {/* Recovery collapses the rest: with the duty or profile query failed, "up next" is a guess. */}
      {state !== 'recovery' && loadsEnabled ? (
        <Section title={state === 'preShift' ? 'Your day' : 'Up next'} first={rows.length === 0}>
          {loads.isPending && !loads.data ? (
            <Skeleton className="w-full rounded-xl" style={{ height: SKELETON_HEIGHTS.upNextRow }} />
          ) : upNext.length > 0 ? (
            upNext.map((load) => (
              <UpNextRow key={load.id} load={load} onPress={() => router.push(`/loads/${load.id}` as never)} />
            ))
          ) : (
            <Card variant="flat" padded={false}>
              <EmptyState
                title="Nothing assigned yet"
                subtitle="Released loads from dispatch will appear here."
              />
            </Card>
          )}
        </Section>
      ) : null}

      {state !== 'recovery' && scoreEnabled && weekScore ? (
        <Section title="This week">
          <WeekStrip score={weekScore} />
        </Section>
      ) : null}
    </Screen>
  );
}

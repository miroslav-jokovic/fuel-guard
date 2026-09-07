import { useEffect, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { nextStop, photoSlotLabel, stopProgress, missingPhotoSlots, type Load } from '@silvicom/shared';
import { AppText, Avatar, Badge, Button, Card, Icon, IconButton, Skeleton } from '@/components';
import { MessagesButton } from '@/features/messages/MessagesButton';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { placeLabel } from '@/features/loads/loadViewModel';
import { shiftDurationLabel } from '@/features/duty/dutyFormat';
import type { DutyView } from '@/features/duty/useDuty';
import { countdownLabel, SKELETON_HEIGHTS } from './todayModel';
import { layout } from '@/theme/tokens';

function dayLabel(now = new Date()): string {
  return now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/**
 * Who the driver is and what state their day is in, in one 44pt-tall strip at the top of the navy.
 * It replaces a "Today · <name> · <date>" title block that told the driver three things they already
 * knew and nothing about their shift.
 */
export function DutyStrip({
  duty,
  name,
  loading,
  messages,
  notifications,
}: {
  duty: DutyView;
  name: string;
  loading: boolean;
  messages?: { unread: number; onPress: () => void };
  notifications?: { unread: number; onPress: () => void };
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!duty.onDuty) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [duty.onDuty]);
  void tick; // the interval exists to re-render the elapsed label, not to hold a value

  if (loading) {
    return <Skeleton className="w-full rounded-xl" style={{ height: SKELETON_HEIGHTS.dutyStrip }} />;
  }

  const elapsed = shiftDurationLabel(duty.startedAt);
  const equipment = duty.equipmentLabel;
  return (
    <View className="flex-row items-center gap-3" style={{ minHeight: 44 }}>
      <Avatar name={name} size={44} />
      <View className="flex-1 gap-0.5">
        <AppText variant="navigationTitle" tone="onHero" numberOfLines={1}>
          {duty.onDuty ? `On duty${elapsed ? ` ${elapsed}` : ''}` : 'Off duty'}
        </AppText>
        <AppText variant="supporting" tone="onHeroSecondary" numberOfLines={1}>
          {[dayLabel(), duty.onDuty ? equipment : null].filter(Boolean).join(' · ')}
        </AppText>
      </View>
      {messages ? (
        <MessagesButton unread={messages.unread} onPress={messages.onPress} onHero />
      ) : null}
      {notifications ? (
        <NotificationBell unread={notifications.unread} onPress={notifications.onPress} onHero />
      ) : null}
    </View>
  );
}

/**
 * The load being worked, as the screen's one signature moment (D-DB7).
 *
 * What it shows is bounded by what exists: `Stop n of m`, the appointment window, the photos the
 * next stop needs, and how long until that window opens. There is deliberately no ETA and no
 * remaining distance — `total_miles` is the whole load and no routing service is reachable from this
 * app, so either figure would be invented (D-DB8 / Q-DB3).
 */
export function CurrentLoadHero({
  load,
  onWorkStop,
  onOpenLoad,
}: {
  load: Load;
  onWorkStop: (stopId: string) => void;
  onOpenLoad: () => void;
}) {
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= layout.largeTextBreakpoint;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const next = nextStop(load);
  const progress = stopProgress(load);
  const countdown = next ? countdownLabel(next, now) : null;
  const missing = next ? missingPhotoSlots(next) : [];
  const action = next?.kind === 'pickup' ? 'Pick up' : 'Deliver';

  return (
    <Card variant="hero">
      <View className="flex-row items-center gap-2">
        <Badge label="In transit" tone="action" />
        <AppText variant="caption" tone="onHeroMuted" className="flex-1" numberOfLines={1}>{load.ref}</AppText>
        <AppText variant="caption" tone="onHeroSecondary" tabular>
          Stop {progress.current} of {progress.total}
        </AppText>
      </View>

      <View className="gap-1 pt-1">
        <AppText variant="label" tone="onHeroSecondary">NEXT · {action.toUpperCase()}</AppText>
        <AppText variant="screenTitle" tone="onHero" numberOfLines={2}>{next?.name ?? 'Run complete'}</AppText>
        {next ? (
          <AppText variant="supporting" tone="onHeroSecondary" numberOfLines={2}>
            {[placeLabel(next), next.address_line].filter(Boolean).join(' · ')}
          </AppText>
        ) : null}
      </View>

      {next ? (
        <View className={`gap-3 pt-2 ${largeText ? '' : 'flex-row'}`}>
          <View className="flex-1 gap-1 rounded-lg bg-hero-tile p-3">
            <AppText variant="caption" tone="onHeroMuted">Appointment</AppText>
            <View className="flex-row items-baseline gap-1">
              <AppText variant="numericInline" tone="onHero">{clock(next.appointment_start)}</AppText>
              {next.appointment_end ? (
                <AppText variant="supporting" tone="onHeroSecondary">–{clock(next.appointment_end)}</AppText>
              ) : null}
            </View>
            {countdown ? (
              <View className="flex-row items-center gap-1">
                <Icon name="schedule" size={14} className={countdown.tone === 'warning' ? 'text-warning' : 'text-action'} />
                <AppText
                  variant="caption"
                  tone={countdown.tone === 'warning' ? 'warning' : 'onHeroSecondary'}
                  numberOfLines={1}
                >
                  {countdown.text}
                </AppText>
              </View>
            ) : null}
          </View>
          <View className="flex-1 gap-1 rounded-lg bg-hero-tile p-3">
            <AppText variant="caption" tone="onHeroMuted">Required here</AppText>
            <View className="flex-row items-baseline gap-1">
              <AppText variant="numericInline" tone="onHero">{next.required_photos.length}</AppText>
              <AppText variant="supporting" tone="onHeroSecondary">
                {next.required_photos.length === 1 ? 'photo' : 'photos'}
              </AppText>
            </View>
            <AppText variant="caption" tone="onHeroSecondary" numberOfLines={1}>
              {next.required_photos.length === 0
                ? 'None'
                : missing.length === 0
                  ? 'All captured'
                  : missing.map(photoSlotLabel).join(' · ')}
            </AppText>
          </View>
        </View>
      ) : null}

      <StopRail load={load} />

      <View className={`gap-3 pt-1 ${largeText ? '' : 'flex-row items-center'}`}>
        {next ? (
          <View className={largeText ? '' : 'flex-1'}>
            <Button
              label={`${action} at ${next.name}`}
              variant="hero"
              size="lg"
              onPress={() => onWorkStop(next.id)}
            />
          </View>
        ) : null}
        <IconButton name="task_alt" label="Open load details" variant="glass" onPress={onOpenLoad} />
      </View>
    </Card>
  );
}

/** Every stop as a dot: done, being worked, still ahead. The run at a glance, in one line. */
function StopRail({ load }: { load: Load }) {
  const ordered = [...load.stops].sort((a, b) => a.seq - b.seq);
  const next = nextStop(load);
  if (ordered.length < 2) return null;

  return (
    <View className="flex-row pt-2" accessibilityLabel={`${ordered.length} stops on this load`}>
      {ordered.map((s, index) => {
        const done = s.status === 'completed' || s.status === 'skipped';
        const current = next?.id === s.id;
        const fill = done ? 'bg-success' : current ? 'bg-action' : 'bg-hero-edge';
        return (
          <View key={s.id} className="flex-1 gap-1">
            <View className="flex-row items-center">
              {/* The stop being worked carries a halo, so the rail reads at a glance without
                  relying on the amber alone (DESIGN.md: never colour by itself). */}
              <View className={`items-center justify-center rounded-full ${current ? 'bg-action/25 p-1' : ''}`}>
                <View className={`h-2 w-2 rounded-full ${fill}`} />
              </View>
              {index < ordered.length - 1 ? (
                <View className={`h-0.5 flex-1 ${done ? 'bg-success' : 'bg-hero-edge'}`} />
              ) : null}
            </View>
            <AppText variant="caption" tone="onHeroMuted" numberOfLines={1}>
              {s.city ?? s.name}
            </AppText>
            <AppText variant="caption" tone="onHeroMuted" numberOfLines={1} tabular>
              {clock(s.appointment_start)}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

/** The time alone: `stopTime` prefixes a day word, which the rail and the tiles already carry. */
function clock(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export { dayLabel, clock };

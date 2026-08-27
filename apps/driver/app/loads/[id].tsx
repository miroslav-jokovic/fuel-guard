import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  DECLINE_REASON_LABELS,
  equipmentRequiresTrailer,
  missingPhotoSlots,
  nextStop,
  stopProgress,
  type DeclineReason,
  type LoadStop,
} from '@silvicom/shared';
import {
  ActionBar,
  AppText,
  Badge,
  Banner,
  Button,
  ConfirmSheet,
  GroupedList,
  Icon,
  ListRow,
  Screen,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  TaskStepper,
  type TaskStep,
} from '@/components';
import { appointmentLabel, placeLabel, stopTime } from '@/features/loads/loadViewModel';
import {
  useAcceptLoad,
  useAcceptance,
  useDeclineLoad,
  useLoad,
  useStartLoad,
} from '@/features/loads/useLoads';
import { dutyView, useShift } from '@/features/duty/useDuty';
import { useFeatures } from '@/session/useFeatures';

const STOP_STATE = {
  pending: { label: 'Pending', text: 'text-ink-muted', icon: 'schedule' },
  arrived: { label: 'Arrived', text: 'text-info', icon: 'pin_drop' },
  completed: { label: 'Complete', text: 'text-operation-complete', icon: 'check_circle' },
  skipped: { label: 'Skipped', text: 'text-warning', icon: 'warning' },
} as const;

function StopRow({ stop, isNext, onPress }: { stop: LoadStop; isNext: boolean; onPress?: () => void }) {
  const missing = missingPhotoSlots(stop);
  const completedPhotos = stop.required_photos.length - missing.length;
  const state = STOP_STATE[stop.status];

  const content = (
    <>
      <View
        className={`mt-0.5 h-7 w-7 items-center justify-center rounded-full border ${
          stop.status === 'completed'
            ? 'border-operation-complete bg-success/10'
            : isNext
              ? 'border-operation-current bg-brand-subtle'
              : 'border-edge bg-surface-muted'
        }`}
      >
        {stop.status === 'completed' ? (
          <Icon name="check" size={15} className="text-operation-complete" />
        ) : (
          <AppText variant="caption" tone={isNext ? 'brand' : 'muted'} tabular className="font-semibold">
            {stop.seq}
          </AppText>
        )}
      </View>
      <View className="flex-1 gap-0.5">
        <View className="flex-row flex-wrap items-start gap-2">
          <AppText variant="rowTitle" className="flex-1">{stop.name}</AppText>
          <View className="flex-row items-center gap-1">
            <Icon name={state.icon} size={14} className={state.text} />
            <AppText variant="caption" className={`font-medium ${state.text}`}>{state.label}</AppText>
          </View>
        </View>
        <AppText variant="supporting" tone="muted">{placeLabel(stop)}</AppText>
        <AppText variant="caption" tone="muted" tabular>
          {stop.kind === 'pickup' ? 'Pick up' : 'Deliver'} · {appointmentLabel(stop)} · {stopTime(stop.appointment_start)}
        </AppText>
        {stop.required_photos.length > 0 ? (
          <View className="mt-1 flex-row items-center gap-2">
            <Icon name="photo_camera" size={14} className={missing.length > 0 ? 'text-ink-muted' : 'text-operation-complete'} />
            <AppText variant="caption" tone={missing.length > 0 ? 'muted' : 'success'}>
              {completedPhotos} of {stop.required_photos.length} required photos
            </AppText>
          </View>
        ) : null}
      </View>
      {onPress ? <Icon name="chevron_right" size={19} className="mt-1 text-ink-subtle" /> : null}
    </>
  );

  const className = 'min-h-[76px] flex-row items-start gap-3 bg-surface px-4 py-3';
  if (!onPress) return <View accessible className={className}>{content}</View>;

  return (
    <Pressable accessibilityRole="button" onPress={onPress} className={`${className} active:bg-surface-selected`}>
      {content}
    </Pressable>
  );
}

export default function LoadDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const features = useFeatures();
  const loadsEnabled = features.enabled('tab.loads');
  const load = useLoad(id, loadsEnabled);
  const shift = useShift();
  const duty = dutyView(shift.data);
  const { copy } = useAcceptance(loadsEnabled);
  const accept = useAcceptLoad();
  const decline = useDeclineLoad(loadsEnabled);
  const start = useStartLoad();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<DeclineReason | null>(null);

  if (features.isLoaded && !loadsEnabled) return <Redirect href="/home" />;
  if (!features.isLoaded) {
    return (
      <Screen padTop={false}>
        <ScreenHeader title="Load" onBack={() => router.back()} />
        <Skeleton className="h-44 w-full rounded-2xl" />
      </Screen>
    );
  }

  if (!load) {
    return (
      <Screen padTop={false}>
        <ScreenHeader title="Load" onBack={() => router.back()} />
        <Banner tone="info" message="This load is no longer available. Return to Loads and refresh your assignments." />
      </Screen>
    );
  }

  const stops = [...load.stops].sort((a, b) => a.seq - b.seq);
  const next = nextStop(load);
  const progress = stopProgress(load);
  const needsTrailer = equipmentRequiresTrailer(load.equipment);
  const trailerGap = duty.onDuty && needsTrailer && !duty.hasTrailer;
  const equipmentDiffers =
    duty.onDuty && load.vehicle_unit !== null && duty.equipmentLabel !== null
      ? !duty.equipmentLabel.includes(load.vehicle_unit)
      : false;
  const working = load.status === 'in_transit';
  const taskIndex = load.status === 'offered' ? 1 : load.status === 'accepted' ? 2 : working ? 3 : load.status === 'delivered' ? 4 : 0;
  const taskSteps: TaskStep[] = ['Assigned', 'Accepted', 'In transit', 'Stops', 'Complete'].map((label, index) => ({
    label,
    state: load.status === 'delivered' || index < taskIndex ? 'complete' : index === taskIndex ? 'current' : 'upcoming',
  }));
  const openStop = (stopId: string) => router.push(`/loads/${load.id}/stop/${stopId}` as never);

  const attention = !duty.onDuty
    ? {
        tone: 'caution' as const,
        icon: 'local_shipping' as const,
        message: 'Confirm your truck before starting this load.',
        label: 'Confirm',
        action: () => router.push('/duty/check-in'),
      }
    : trailerGap
      ? {
          tone: 'caution' as const,
          icon: 'route' as const,
          message: `${load.equipment} requires a trailer. Add the one you’re pulling.`,
          label: 'Add trailer',
          action: () => router.push('/duty/check-in?mode=swap'),
        }
      : equipmentDiffers
        ? {
            tone: 'info' as const,
            icon: 'info' as const,
            message: `Dispatch planned Unit ${load.vehicle_unit}; current equipment is ${duty.equipmentLabel}. Dispatch has been notified.`,
          }
        : null;

  let footer: ReactNode;
  if (load.status === 'offered') {
    footer = (
      <ActionBar>
        <Button
          label={copy.primary}
          size="lg"
          icon="check_circle"
          haptic="success"
          loading={accept.isPending}
          onPress={() => void accept.mutateAsync(load.id)}
        />
        <Button label={copy.secondary} variant="secondary" onPress={() => setDeclining(true)} />
      </ActionBar>
    );
  } else if (load.status === 'accepted') {
    footer = (
      <ActionBar>
        <Button
          label="Start this trip"
          size="lg"
          icon="play_arrow"
          haptic="success"
          loading={start.isPending}
          onPress={() => void start.mutateAsync(load.id)}
        />
      </ActionBar>
    );
  } else if (working && next) {
    footer = (
      <ActionBar>
        <Button
          label={`${next.kind === 'dropoff' ? 'Deliver' : 'Pick up'} · ${placeLabel(next)}`}
          size="lg"
          icon="arrow_forward"
          haptic="success"
          onPress={() => openStop(next.id)}
        />
      </ActionBar>
    );
  }

  return (
    <Screen padTop={false} footer={footer}>
      <ScreenHeader
        title={load.ref}
        subtitle={`${stops.length} stops · ${load.equipment ?? 'Load'}`}
        onBack={() => router.back()}
        right={load.hazmat ? <Badge label="Hazmat" tone="warning" icon="warning" /> : undefined}
      />

      {attention ? (
        <Banner
          tone={attention.tone}
          icon={attention.icon}
          message={attention.message}
          actionLabel={'label' in attention ? attention.label : undefined}
          onAction={'action' in attention ? attention.action : undefined}
        />
      ) : null}

      <TaskStepper steps={taskSteps} />
      {working ? (
        <AppText variant="caption" tone="muted">
          {progress.current} of {progress.total} stops complete
          {next ? ` · Next: ${placeLabel(next)}` : ''}
        </AppText>
      ) : null}

      <SectionLabel>Itinerary</SectionLabel>
      <GroupedList>
        {stops.map((stop) => (
          <StopRow
            key={stop.id}
            stop={stop}
            isNext={next?.id === stop.id}
            onPress={working && stop.status !== 'completed' && stop.status !== 'skipped' ? () => openStop(stop.id) : undefined}
          />
        ))}
      </GroupedList>

      {load.commodity || load.notes ? (
        <>
          <SectionLabel>Load details</SectionLabel>
          <GroupedList>
            {load.commodity ? <ListRow icon="route" title="Commodity" subtitle={load.commodity} /> : null}
            {load.notes ? <ListRow icon="info" title="Notes" subtitle={load.notes} /> : null}
          </GroupedList>
        </>
      ) : null}

      {declining && reason === null ? (
        <>
          <SectionLabel>Why can’t you take it?</SectionLabel>
          <GroupedList>
            {copy.reasons.map((declineReason) => (
              <ListRow
                key={declineReason}
                title={DECLINE_REASON_LABELS[declineReason]}
                onPress={() => setReason(declineReason)}
              />
            ))}
          </GroupedList>
          <Button label="Never mind" variant="ghost" size="sm" onPress={() => setDeclining(false)} />
        </>
      ) : null}

      <ConfirmSheet
        visible={reason !== null}
        tone="danger"
        icon="warning"
        title={copy.secondary}
        message={copy.unassignsOnDecline
          ? 'This load goes back to dispatch and leaves your list.'
          : 'Dispatch will be told you cannot take this one. It stays on your list until they decide.'}
        confirmLabel={copy.secondary}
        loading={decline.isPending}
        onConfirm={() => {
          const picked = reason;
          setReason(null);
          setDeclining(false);
          if (picked) void decline.mutateAsync({ loadId: load.id, reason: picked });
        }}
        onCancel={() => setReason(null)}
      />
    </Screen>
  );
}

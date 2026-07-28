import { useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  DECLINE_REASON_LABELS,
  equipmentRequiresTrailer,
  missingPhotoSlots,
  nextStop,
  photoSlotLabel,
  stopProgress,
  type DeclineReason,
  type LoadStop,
} from '@fuelguard/shared';
import {
  Badge,
  Banner,
  Button,
  Card,
  ConfirmSheet,
  Icon,
  ListRow,
  Screen,
  ScreenHeader,
  SectionLabel,
  type Tone,
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

const STOP_TONE: Record<LoadStop['status'], Tone> = {
  pending: 'neutral',
  arrived: 'info',
  completed: 'success',
  skipped: 'caution',
};

/** Ordered stops with their photo checklist — the itinerary a driver actually works. */
function StopRow({ stop, isNext, onPress }: { stop: LoadStop; isNext: boolean; onPress?: () => void }) {
  const missing = missingPhotoSlots(stop);
  return (
    <Card onPress={onPress}>
      <View className="flex-row items-center gap-2 pb-1">
        <View
          className={`h-6 w-6 items-center justify-center rounded-full ${
            stop.status === 'completed' ? 'bg-success/10' : isNext ? 'bg-brand/10' : 'bg-surface-muted'
          }`}
        >
          {stop.status === 'completed' ? (
            <Icon name="check" size={14} className="text-success" />
          ) : (
            <Text
              className={`text-xs font-sans-sb ${isNext ? 'text-brand' : 'text-ink-muted'}`}
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {stop.seq}
            </Text>
          )}
        </View>
        <Text className="flex-1 text-base font-sans-sb text-ink" numberOfLines={1}>
          {stop.name}
        </Text>
        <Badge
          label={stop.kind === 'pickup' ? 'Pick up' : 'Deliver'}
          tone={stop.kind === 'pickup' ? 'info' : 'brand'}
        />
        {stop.status !== 'pending' ? (
          <Badge label={stop.status} tone={STOP_TONE[stop.status]} />
        ) : null}
        {onPress ? <Icon name="chevron_right" size={18} className="text-ink-subtle" /> : null}
      </View>

      <View className="gap-1 pl-8">
        <Text className="text-sm text-ink-muted">{placeLabel(stop)}</Text>
        <View className="flex-row items-center gap-1.5">
          <Icon name="schedule" size={13} className="text-ink-subtle" />
          <Text className="text-xs text-ink-muted" style={{ fontVariant: ['tabular-nums'] }}>
            {appointmentLabel(stop)} · {stopTime(stop.appointment_start)}
          </Text>
        </View>
        {stop.required_photos.length > 0 ? (
          <View className="mt-1 flex-row flex-wrap items-center gap-1.5">
            <Icon name="photo_camera" size={13} className="text-ink-subtle" />
            {stop.required_photos.map((slot) => (
              <Badge
                key={slot}
                label={photoSlotLabel(slot)}
                tone={missing.includes(slot) ? 'neutral' : 'success'}
                icon={missing.includes(slot) ? undefined : 'check'}
              />
            ))}
          </View>
        ) : null}
      </View>
    </Card>
  );
}

/**
 * Load detail — the itinerary, plus the one decision this screen exists for. The accept/decline copy
 * comes from the server-resolved driver type (D46): a company driver sees "I'm ready", an
 * owner-operator sees "Accept", and only the owner-operator's decline returns the load to dispatch.
 * Once the load is in transit, each open stop opens its capture flow.
 */
export default function LoadDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useLoad(id);
  const shift = useShift();
  const duty = dutyView(shift.data);
  const { copy } = useAcceptance();

  const accept = useAcceptLoad();
  const decline = useDeclineLoad();
  const start = useStartLoad();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<DeclineReason | null>(null);

  if (!load) {
    return (
      <Screen>
        <ScreenHeader title="Load" onBack={() => router.back()} />
        <Banner tone="info" message="This load is no longer available. Pull to refresh your list." />
      </Screen>
    );
  }

  const stops = [...load.stops].sort((a, b) => a.seq - b.seq);
  const next = nextStop(load);
  const progress = stopProgress(load);
  const needsTrailer = equipmentRequiresTrailer(load.equipment);
  // D44.3 — the trailer gate is a prompt at the moment it matters, never a wall on arrival.
  const trailerGap = duty.onDuty && needsTrailer && !duty.hasTrailer;
  // D47 — dispatch's plan vs what the driver is actually in. Flagged, never blocking.
  const equipmentDiffers =
    duty.onDuty && load.vehicle_unit !== null && duty.equipmentLabel !== null
      ? !duty.equipmentLabel.includes(load.vehicle_unit)
      : false;
  const working = load.status === 'in_transit';
  const openStop = (stopId: string) => router.push(`/loads/${load.id}/stop/${stopId}` as never);

  return (
    <Screen>
      <ScreenHeader
        title={load.ref}
        subtitle={`${stops.length} stops · ${load.equipment ?? 'Load'}`}
        onBack={() => router.back()}
        right={load.hazmat ? <Badge label="Hazmat" tone="warning" icon="warning" /> : undefined}
      />

      {!duty.onDuty ? (
        <Banner
          tone="caution"
          icon="local_shipping"
          message="Confirm your truck before you start this load."
          actionLabel="Confirm"
          onAction={() => router.push('/duty/check-in')}
        />
      ) : null}

      {trailerGap ? (
        <Banner
          tone="caution"
          icon="route"
          message={`${load.equipment} needs a trailer — add the one you're pulling.`}
          actionLabel="Add"
          onAction={() => router.push('/duty/check-in?mode=swap')}
        />
      ) : null}

      {equipmentDiffers ? (
        <Banner
          tone="info"
          icon="info"
          message={`Dispatch planned Unit ${load.vehicle_unit}. You're in ${duty.equipmentLabel}. Dispatch has been told.`}
        />
      ) : null}

      {working ? (
        <View className="gap-1.5">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-sans-md text-ink-secondary">
              Stop {progress.current} of {progress.total}
            </Text>
            {next ? (
              <Text className="text-sm text-ink-muted">
                Next: {next.kind === 'dropoff' ? 'Deliver' : 'Pick up'} — {placeLabel(next)}
              </Text>
            ) : null}
          </View>
          <View className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
            <View
              className="h-full rounded-full bg-brand"
              style={{
                width: `${Math.round((progress.current / Math.max(progress.total, 1)) * 100)}%`,
              }}
            />
          </View>
        </View>
      ) : null}

      <SectionLabel>Itinerary</SectionLabel>
      {stops.map((stop) => (
        <StopRow
          key={stop.id}
          stop={stop}
          isNext={next?.id === stop.id}
          onPress={
            working && stop.status !== 'completed' && stop.status !== 'skipped'
              ? () => openStop(stop.id)
              : undefined
          }
        />
      ))}

      {load.commodity || load.notes ? (
        <>
          <SectionLabel>Details</SectionLabel>
          {load.commodity ? (
            <ListRow icon="route" title="Commodity" subtitle={load.commodity} />
          ) : null}
          {load.notes ? <ListRow icon="info" title="Notes" subtitle={load.notes} /> : null}
        </>
      ) : null}

      {load.status === 'offered' ? (
        <View className="gap-2 pt-1">
          <Button
            label={copy.primary}
            size="lg"
            icon="check_circle"
            haptic="success"
            loading={accept.isPending}
            onPress={() => void accept.mutateAsync(load.id)}
          />
          <Button
            label={copy.secondary}
            variant="secondary"
            size="md"
            onPress={() => setDeclining(true)}
          />
        </View>
      ) : null}

      {load.status === 'accepted' ? (
        <Button
          label="Start this trip"
          size="lg"
          icon="play_arrow"
          haptic="success"
          loading={start.isPending}
          onPress={() => void start.mutateAsync(load.id)}
        />
      ) : null}

      {working && next ? (
        <Button
          label={`Work next stop — ${next.kind === 'dropoff' ? 'Deliver' : 'Pick up'}`}
          size="lg"
          icon="photo_camera"
          haptic="success"
          onPress={() => openStop(next.id)}
        />
      ) : null}

      {/* Reason first, then confirm — a decline that dispatch cannot explain is worse than none. */}
      {declining && reason === null ? (
        <Card>
          <SectionLabel>Why can&apos;t you take it?</SectionLabel>
          {copy.reasons.map((r) => (
            <ListRow
              key={r}
              title={DECLINE_REASON_LABELS[r]}
              onPress={() => setReason(r)}
            />
          ))}
          <Button label="Never mind" variant="ghost" size="sm" onPress={() => setDeclining(false)} />
        </Card>
      ) : null}

      <ConfirmSheet
        visible={reason !== null}
        tone="danger"
        icon="warning"
        title={copy.secondary}
        message={
          copy.unassignsOnDecline
            ? 'This load goes back to dispatch and leaves your list.'
            : 'Dispatch will be told you cannot take this one. It stays on your list until they decide.'
        }
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

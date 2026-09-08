import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  equipmentRequiresTrailer,
  nextStop,
  stopProgress,
  type DeclineReason,
} from '@silvicom/shared';
import {
  ActionBar,
  AppText,
  Badge,
  Banner,
  Button,
  Card,
  ChoiceSheet,
  ConfirmSheet,
  ListRow,
  Progress,
  Screen,
  ScreenHeader,
  Section,
  Skeleton,
} from '@/components';
import { Itinerary } from '@/features/loads/Itinerary';
import { declineChoices } from '@/features/loads/OfferDeck';
import { LOAD_STATUS, driverLoadStatus } from '@/features/loads/loadStatus';
import {
  useAcceptLoad,
  useAcceptance,
  useDeclineLoad,
  useLoad,
  useStartLoad,
} from '@/features/loads/useLoads';
import { dutyView, useShift } from '@/features/duty/useDuty';
import { useFeatures } from '@/session/useFeatures';

/**
 * One load, end to end. The screen is sheet-only: it is reached FROM a hero screen, and stacking a
 * second navy region under the first reads as a new app rather than a deeper level.
 *
 * The lifecycle `TaskStepper` ("Assigned · Accepted · In transit · Stops · Complete") is gone
 * (critique defect 21). It was a second progress indicator beside the itinerary, and it tracked the
 * wrong thing — a driver looking at a load they are driving does not need to be told it has been
 * accepted. What remains is stop progress, which is the run.
 */
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
        <Skeleton className="w-full rounded-xl" style={{ height: 176 }} />
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

  const next = nextStop(load);
  const progress = stopProgress(load);
  const status = LOAD_STATUS[driverLoadStatus(load.status)];
  const working = load.status === 'in_transit';
  const trailerGap = duty.onDuty && equipmentRequiresTrailer(load.equipment) && !duty.hasTrailer;
  const equipmentDiffers =
    duty.onDuty && load.vehicle_unit !== null && duty.equipmentLabel !== null
      ? !duty.equipmentLabel.includes(load.vehicle_unit)
      : false;
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
          variant="primary"
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
          variant="primary"
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
          label={`${next.kind === 'dropoff' ? 'Deliver' : 'Pick up'} · ${next.name}`}
          size="lg"
          icon="arrow_forward"
          variant="primary"
          haptic="success"
          onPress={() => openStop(next.id)}
        />
      </ActionBar>
    );
  }

  return (
    <Screen padTop={false} flow="sections" footer={footer}>
      <ScreenHeader
        title={load.ref}
        subtitle={[
          load.equipment,
          load.total_miles == null ? null : `${Math.round(load.total_miles).toLocaleString()} mi`,
          load.vehicle_unit ? `Unit ${load.vehicle_unit}` : null,
        ].filter(Boolean).join(' · ')}
        onBack={() => router.back()}
        right={<Badge label={status.label} tone={status.tone} />}
      />

      <Section first>
        {attention ? (
          <Banner
            tone={attention.tone}
            icon={attention.icon}
            message={attention.message}
            actionLabel={'label' in attention ? attention.label : undefined}
            onAction={'action' in attention ? attention.action : undefined}
          />
        ) : null}
        <View className="flex-row items-baseline gap-2">
          <AppText variant="numericInline">{progress.current}</AppText>
          <AppText variant="supporting" tone="muted" className="flex-1">of {progress.total} stops</AppText>
        </View>
        <Progress value={progress.total > 0 ? (progress.current - 1) / progress.total : 0} tone="action" />
      </Section>

      <Section title="Itinerary">
        <Itinerary load={load} onOpenStop={openStop} />
      </Section>

      <Section title="This load">
        <Card variant="flat">
          <View className="flex-row gap-4">
            <Fact label="Commodity" value={load.commodity ?? '—'} />
            <Fact label="Trailer" value={load.trailer_unit ?? '—'} />
            <Fact label="Stops" value={String(load.stops.length)} />
          </View>
          {load.notes ? (
            <>
              <View className="h-px bg-edge-subtle" />
              <ListRow icon="info" disc="neutral" title="Notes from dispatch" subtitle={load.notes} />
            </>
          ) : null}
          {load.hazmat ? (
            <>
              <View className="h-px bg-edge-subtle" />
              <ListRow
                icon="local_fire_department"
                disc="danger"
                title="Hazmat load"
                subtitle="Placarding and the BOL check apply to this run."
                onPress={() => router.push('/documents')}
              />
            </>
          ) : null}
        </Card>
      </Section>

      <ChoiceSheet<DeclineReason>
        visible={declining && reason === null}
        title={copy.secondary}
        message="Dispatch sees the reason you pick."
        choices={declineChoices(copy)}
        onChoose={setReason}
        onCancel={() => setDeclining(false)}
      />

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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 gap-0.5">
      <AppText variant="caption" tone="muted">{label}</AppText>
      <AppText variant="supporting" className="font-ui-md" numberOfLines={2}>{value}</AppText>
    </View>
  );
}

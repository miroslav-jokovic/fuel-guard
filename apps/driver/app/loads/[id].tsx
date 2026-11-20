import { useState, type ReactNode } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  equipmentRequiresTrailer,
  nextStop,
  type DeclineReason,
} from '@silvicom/shared';
import {
  ActionBar,
  AppText,
  Banner,
  Button,
  ChoiceSheet,
  ConfirmSheet,
  GroupedList,
  ListRow,
  Screen,
  ScreenHeader,
  Section,
  Skeleton,
} from '@/components';
import { Timeline } from '@/features/loads/Timeline';
import { routeLine } from '@/features/loads/loadsListModel';
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
      {/* Visual 2026 V6 (mock screen 5): the load's number is the title, in the display face, and the
          status is a word at the head of the line under it rather than a pill (D-DV14). */}
      <ScreenHeader
        display
        title={`Load ${load.ref}`}
        subtitle={[
          status.label,
          load.equipment,
          load.trailer_unit ? `trailer ${load.trailer_unit}` : null,
          load.total_miles == null ? null : `${Math.round(load.total_miles).toLocaleString()} mi`,
          load.commodity,
        ].filter(Boolean).join(' · ')}
        onBack={() => router.back()}
        right={load.vehicle_unit ? <AppText variant="supporting" tone="secondary">{`Unit ${load.vehicle_unit}`}</AppText> : undefined}
      />

      {attention ? (
        <Section>
          <Banner
            tone={attention.tone}
            icon={attention.icon}
            message={attention.message}
            actionLabel={'label' in attention ? attention.label : undefined}
            onAction={'action' in attention ? attention.action : undefined}
          />
        </Section>
      ) : null}

      <Section title={routeLine(load, false) || 'Stops'}>
        <Timeline load={load} onOpenStop={openStop} />
      </Section>

      {load.notes ? (
        <Section title="Notes from dispatch">
          <AppText variant="body" tone="secondary">{load.notes}</AppText>
        </Section>
      ) : null}

      {load.hazmat ? (
        <Section title="Hazmat">
          <GroupedList>
            <ListRow
              icon="local_fire_department"
              disc="danger"
              title="Hazmat load"
              subtitle="Placarding and the BOL check apply to this run."
              onPress={() => router.push('/documents')}
            />
          </GroupedList>
        </Section>
      ) : null}

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

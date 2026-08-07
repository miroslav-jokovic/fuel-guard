import { useState } from 'react';
import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import {
  ActionBar,
  Banner,
  Button,
  Field,
  ListRow,
  NumericField,
  Screen,
  ScreenHeader,
  SectionLabel,
} from '@/components';
import { dutyView, useEndShift, useShift } from '@/features/duty/useDuty';
import { shiftDurationLabel } from '@/features/duty/dutyFormat';

/**
 * End your day (D44.5). A modal route over the shell — the same pattern as check-in, for the same
 * kind of action. Signing off releases the truck for the next driver (the reason the stale-session
 * sweeper exists), so it is an explicit screen, never a stray tap. The end odometer is optional and
 * closes out the shift's MPG/idle numbers. Like every duty write it queues through the outbox, so it
 * works with no signal.
 */
export default function EndShift() {
  const router = useRouter();
  const shift = useShift();
  const duty = dutyView(shift.data);
  const endShift = useEndShift();
  const [odometer, setOdometer] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const odo = Number.parseFloat(odometer);
    try {
      await endShift.mutateAsync(Number.isFinite(odo) && odo > 0 ? { endOdometer: odo } : {});
      router.back();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not end your shift. It is queued and will retry.',
      );
    }
  };

  if (!duty.onDuty) {
    return (
      <Screen>
        <ScreenHeader title="End your day" onClose={() => router.back()} />
        <Banner tone="info" message="You're not on duty right now — nothing to end." />
      </Screen>
    );
  }

  const duration = shiftDurationLabel(duty.startedAt);
  const startOdo = duty.session?.start_odometer ?? null;

  return (
    <Screen
      padTop={false}
      // Primary action pinned in the footer (Phase 8.5 — same contract as check-in): reachable
      // without scrolling, in gloves, with the keyboard up.
      footer={
        <ActionBar>
          <Button
            label="End shift"
            variant="danger"
            size="lg"
            icon="logout"
            loading={endShift.isPending}
            haptic="warning"
            onPress={() => void submit()}
          />
          <Text className="pb-1 text-center text-xs text-ink-subtle">
            This releases your truck for the next driver. Works offline — it syncs when you get signal.
          </Text>
        </ActionBar>
      }
    >
      <ScreenHeader
        title="End your day"
        subtitle={duty.equipmentLabel ?? 'Sign off'}
        onClose={() => router.back()}
      />

      {error ? <Banner tone="danger" icon="warning" message={error} /> : null}

      <SectionLabel>Your shift</SectionLabel>
      <ListRow
        icon="local_shipping"
        iconFill
        title={duty.equipmentLabel ?? 'On duty'}
        subtitle={duration ? `On duty ${duration}` : duty.hasTrailer ? 'Truck and trailer' : 'Bobtail'}
      />

      <SectionLabel>Odometer (optional)</SectionLabel>
      <Field
        label="Ending odometer"
        hint={
          startOdo != null
            ? `Started at ${Math.round(startOdo).toLocaleString()} mi — closes out your MPG for the shift`
            : 'Closes out your MPG and idle numbers for the shift'
        }
      >
        <NumericField value={odometer} onChangeText={setOdometer} unit="mi" placeholder="412450" />
      </Field>

    </Screen>
  );
}

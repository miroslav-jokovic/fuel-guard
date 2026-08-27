import { useState } from 'react';
import { Image, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { photoSlotLabel } from '@silvicom/shared';
import {
  ActionBar,
  AppText,
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  GroupedList,
  Icon,
  Input,
  Progress,
  Screen,
  ScreenHeader,
  SectionLabel,
  Skeleton,
} from '@/components';
import { appointmentLabel, placeLabel } from '@/features/loads/loadViewModel';
import { useCompleteStop, useLoad } from '@/features/loads/useLoads';
import { capturePhotoForSlot } from '@/features/loads/stopCapture';
import {
  outstandingSlots,
  reasonRequiredToComplete,
  satisfiedSlots,
  type SessionCapture,
} from '@/features/loads/stopCaptureModel';
import { haptics } from '@/lib/haptics';
import { useFeatures } from '@/session/useFeatures';

/**
 * Stop capture (Phase 3C, D21). The driver works one stop: photograph each required slot, then
 * complete — or skip with a reason. A missing required photo never blocks; it just demands a reason,
 * which the server records. Everything queues through the outbox, so it all works with no signal.
 */
export default function StopCapture() {
  const router = useRouter();
  const { id, stopId } = useLocalSearchParams<{ id: string; stopId: string }>();
  const features = useFeatures();
  const loadsEnabled = features.enabled('tab.loads');
  const load = useLoad(id, loadsEnabled);
  const stop = load?.stops.find((s) => s.id === stopId) ?? null;
  const complete = useCompleteStop();

  const [captures, setCaptures] = useState<SessionCapture[]>([]);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasonMode, setReasonMode] = useState<'completed' | 'skipped' | null>(null);
  const [reason, setReason] = useState('');

  if (features.isLoaded && !loadsEnabled) return <Redirect href="/home" />;
  if (!features.isLoaded) {
    return (
      <Screen>
        <ScreenHeader title="Stop" onBack={() => router.back()} />
        <Skeleton className="h-44 w-full rounded-2xl" />
      </Screen>
    );
  }

  if (!load || !stop) {
    return (
      <Screen>
        <ScreenHeader title="Stop" onBack={() => router.back()} />
        <Banner tone="info" message="This stop is no longer available. Return to Loads and refresh your assignments." />
      </Screen>
    );
  }

  const requiredSlots = stop.required_photos;
  const satisfied = satisfiedSlots(stop, captures);
  const outstanding = outstandingSlots(stop, captures);
  const capturedFor = (slot: string) => captures.find((c) => c.slot === slot) ?? null;

  // Arrow consts (not hoisted `function`s) so TS keeps the non-null narrowing of `load`/`stop` from
  // the guard above inside these closures.
  const takePhoto = async (slot: string) => {
    setError(null);
    setBusySlot(slot);
    try {
      const result = await capturePhotoForSlot(slot);
      if (result.ok) {
        setCaptures((prev) => [...prev.filter((c) => c.slot !== slot), result.capture]);
        haptics.success();
      } else if (result.reason === 'permission') {
        setError('Camera access is off. Enable it for FuelGuard Driver in Settings to add photos.');
      } else if (result.reason === 'error') {
        setError(result.message ?? 'That photo could not be processed. Try again.');
      }
      // 'cancelled' → the driver backed out; nothing to say.
    } finally {
      setBusySlot(null);
    }
  };

  const submit = async (status: 'arrived' | 'completed' | 'skipped', withReason?: string) => {
    setError(null);
    try {
      await complete.mutateAsync({
        loadId: load.id,
        stopId: stop.id,
        status,
        captures,
        ...(withReason ? { skipReason: withReason } : {}),
      });
      haptics.success();
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Your work is queued and will retry.');
    }
  };

  const onComplete = () => {
    // D21: completing with an outstanding required photo is allowed, but needs a reason first.
    if (reasonRequiredToComplete(stop, captures)) {
      setReasonMode('completed');
      return;
    }
    void submit('completed');
  };

  const reasonTitle =
    reasonMode === 'skipped'
      ? "Why are you skipping this stop?"
      : `Missing ${outstanding.map(photoSlotLabel).join(', ')} — why?`;

  return (
    <Screen
      padTop={false}
      // Primary actions pinned in the footer (Phase 8.5 — same contract as check-in/end-shift):
      // "Complete stop" is reachable without scrolling past the photo checklist. Hidden while the
      // reason card is up, where the card's own confirm is the one decision on screen.
      footer={
        reasonMode ? undefined : (
          <ActionBar>
            <Button
              label="Complete stop"
              size="lg"
              icon="check_circle"
              haptic="success"
              loading={complete.isPending}
              onPress={onComplete}
            />
            <View className="flex-row gap-2">
              {stop.status === 'pending' ? (
                <View className="flex-1">
                  <Button
                    label="Mark arrived"
                    variant="secondary"
                    size="sm"
                    icon="pin_drop"
                    loading={complete.isPending}
                    onPress={() => void submit('arrived')}
                  />
                </View>
              ) : null}
              <View className="flex-1">
                <Button
                  label="Skip stop"
                  variant="ghost"
                  size="sm"
                  onPress={() => {
                    setReason('');
                    setReasonMode('skipped');
                  }}
                />
              </View>
            </View>
            <AppText variant="caption" tone="subtle" className="pb-1 text-center">
              Saved locally first · syncs automatically
            </AppText>
          </ActionBar>
        )
      }
    >
      <ScreenHeader
        title={stop.name}
        subtitle={`${placeLabel(stop)} · ${appointmentLabel(stop)}`}
        onBack={() => router.back()}
        right={
          <Badge
            label={stop.kind === 'pickup' ? 'Pick up' : 'Deliver'}
            tone={stop.kind === 'pickup' ? 'info' : 'brand'}
          />
        }
      />

      {error ? <Banner tone="danger" icon="warning" message={error} /> : null}

      {reasonMode ? (
        <Card>
          <AppText variant="navigationTitle">{reasonTitle}</AppText>
          <AppText variant="supporting" tone="muted">Dispatch will see this note with the stop record.</AppText>
          <ReasonInput value={reason} onChange={setReason} />
          <View className="gap-2 pt-1">
            <Button
              label={reasonMode === 'skipped' ? 'Skip this stop' : 'Complete anyway'}
              variant={reasonMode === 'skipped' ? 'danger' : 'primary'}
              icon={reasonMode === 'skipped' ? 'do_not_disturb_on' : 'check_circle'}
              disabled={reason.trim().length === 0}
              loading={complete.isPending}
              onPress={() => void submit(reasonMode, reason.trim())}
            />
            <Button
              label="Back"
              variant="ghost"
              size="sm"
              onPress={() => {
                setReasonMode(null);
                setReason('');
              }}
            />
          </View>
        </Card>
      ) : (
        <>
          <SectionLabel>Required photos</SectionLabel>
          {requiredSlots.length > 0 ? (
            <Progress
              label="Required photos"
              detail={`${requiredSlots.length - outstanding.length} of ${requiredSlots.length}`}
              value={(requiredSlots.length - outstanding.length) / requiredSlots.length}
            />
          ) : null}

          {requiredSlots.length === 0 ? (
            <EmptyState
              icon="task_alt"
              title="No photos required"
              subtitle="Mark this stop complete when you're done here."
            />
          ) : (
            <GroupedList>
              {requiredSlots.map((slot) => {
                const shot = capturedFor(slot);
                const done = satisfied.has(slot);
                return (
                  <View key={slot} className="min-h-[76px] flex-row items-center gap-3 bg-surface px-4 py-3">
                    {shot ? (
                      <Image source={{ uri: shot.localUri }} className="h-14 w-14 rounded-lg" />
                    ) : (
                      <View className={`h-12 w-12 items-center justify-center rounded-lg ${done ? 'bg-success/10' : 'bg-surface-muted'}`}>
                        <Icon
                          name={done ? 'check_circle' : 'add_a_photo'}
                          fill={done}
                          size={21}
                          className={done ? 'text-operation-complete' : 'text-ink-muted'}
                        />
                      </View>
                    )}
                    <View className="flex-1 gap-0.5">
                      <AppText variant="rowTitle">{photoSlotLabel(slot)}</AppText>
                      <AppText variant="caption" tone={done ? 'success' : 'muted'}>
                        {done ? (shot ? 'Captured locally' : 'Already added') : 'Required'}
                      </AppText>
                    </View>
                    <Button
                      label={shot ? 'Retake' : done ? 'Replace' : 'Capture'}
                      variant={shot || done ? 'secondary' : 'primary'}
                      size="sm"
                      icon="photo_camera"
                      loading={busySlot === slot}
                      onPress={() => void takePhoto(slot)}
                    />
                  </View>
                );
              })}
            </GroupedList>
          )}

        </>
      )}
    </Screen>
  );
}

/** Multi-line reason field — kept tiny and local; the only free-text entry on this screen. */
function ReasonInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Input
      accessibilityLabel="Reason for this stop update"
      value={value}
      onChangeText={onChange}
      placeholder="A short note dispatch will see"
      multiline
      numberOfLines={3}
      style={{ minHeight: 72, paddingTop: 8 }}
      maxLength={500}
    />
  );
}

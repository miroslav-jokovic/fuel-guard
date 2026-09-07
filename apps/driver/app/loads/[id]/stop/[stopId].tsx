import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { photoSlotLabel } from '@silvicom/shared';
import {
  ActionBar,
  AppText,
  Banner,
  Button,
  Card,
  Icon,
  Input,
  ListRow,
  Screen,
  ScreenHeader,
  Section,
  Skeleton,
  useToast,
} from '@/components';
import { StopHero } from '@/features/loads/StopHero';
import { PhotoGrid } from '@/features/loads/PhotoGrid';
import { photoCount, windowVerdict } from '@/features/loads/itineraryModel';
import { useCompleteStop, useLoad } from '@/features/loads/useLoads';
import { capturePhotoForSlot } from '@/features/loads/stopCapture';
import {
  outstandingSlots,
  reasonRequiredToComplete,
  type SessionCapture,
} from '@/features/loads/stopCaptureModel';
import { messagePreview, sortThreads } from '@silvicom/shared';
import { useThreads } from '@/features/messages/useMessages';
import { haptics } from '@/lib/haptics';
import { useFeatures } from '@/session/useFeatures';

/**
 * Stop capture (Phase 3C, D21). The driver works one stop: photograph each required slot, then
 * complete — or skip with a reason. A missing required photo never blocks; it just demands a reason,
 * which the server records. Everything queues through the outbox, so it all works with no signal.
 */
export default function StopCapture() {
  const router = useRouter();
  const toast = useToast();
  const { id, stopId } = useLocalSearchParams<{ id: string; stopId: string }>();
  const features = useFeatures();
  const loadsEnabled = features.enabled('tab.loads');
  const messagesEnabled = features.enabled('messages');
  const load = useLoad(id, loadsEnabled);
  const stop = load?.stops.find((s) => s.id === stopId) ?? null;
  const complete = useCompleteStop();
  // The thread lookup lives HERE rather than inside a `features/loads` component: a route may
  // compose across features, a feature may not reach into a sibling (`lint:boundaries`).
  const threads = useThreads(messagesEnabled);

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
        <Skeleton className="w-full rounded-xl" style={{ height: 176 }} />
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

  const outstanding = outstandingSlots(stop, captures);
  const photos = photoCount(stop, captures);
  const verdict = windowVerdict(stop);
  // Q-DB5: a thread belongs to this stop only by the load it references. There is no stop-level
  // linkage in the contract, so no row appears when nothing carries the ref.
  const thread = sortThreads(threads.data?.threads ?? []).find((t) => t.load_ref === load.ref) ?? null;

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
        setError('Camera access is off. Enable it for Silvicom 360 Driver in Settings to add photos.');
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
    const queued = captures.length;
    try {
      await complete.mutateAsync({
        loadId: load.id,
        stopId: stop.id,
        status,
        captures,
        ...(withReason ? { skipReason: withReason } : {}),
      });
      haptics.success();
      // The receipt outlives this screen: the toast host is in the root layout, so the driver still
      // sees what happened after the router.back() below (B1.12).
      toast.show(
        `${stop.name} ${status === 'skipped' ? 'skipped' : status === 'arrived' ? 'marked arrived' : 'completed'}`
        + (queued > 0 ? ` · ${queued} ${queued === 1 ? 'photo' : 'photos'} queued` : ''),
      );
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
      ? 'Why are you skipping this stop?'
      : `Missing ${outstanding.map(photoSlotLabel).join(', ')} — why?`;

  return (
    <Screen
      padTop={false}
      flow="sections"
      hero={<StopHero load={load} stop={stop} onBack={() => router.back()} />}
      // The primary action is pinned so "Complete stop" is reachable without scrolling past the
      // photo grid. Hidden while the reason card is up, where its own confirm is the one decision.
      footer={
        reasonMode ? undefined : (
          <ActionBar>
            <Button
              label={outstanding.length === 0
                ? 'Complete stop'
                : `Complete stop · ${outstanding.length} ${outstanding.length === 1 ? 'photo' : 'photos'} missing`}
              size="lg"
              variant="primary"
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
            <View className="flex-row items-center justify-center gap-1 pb-1">
              <Icon name="cloud_sync" size={14} className="text-ink-subtle" />
              <AppText variant="caption" tone="subtle">Saved on this phone first · syncs when you have signal</AppText>
            </View>
          </ActionBar>
        )
      }
    >
      {error ? (
        <Section first>
          <Banner tone="danger" icon="warning" message={error} />
        </Section>
      ) : null}

      {reasonMode ? (
        <Section first={!error}>
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
        </Section>
      ) : (
        <>
          {verdict ? (
            <Section first={!error}>
              <Card variant="flat" padded={false}>
                <ListRow
                  icon="schedule"
                  disc={verdict.tone === 'warning' ? 'caution' : verdict.tone === 'success' ? 'success' : 'neutral'}
                  title={verdict.title}
                  subtitle={verdict.detail}
                />
              </Card>
            </Section>
          ) : null}

          {stop.required_photos.length > 0 ? (
            <Section title="Photos for this stop">
              <View className="flex-row items-center justify-between">
                <AppText variant="caption" tone="muted">Tap a tile to capture it</AppText>
                <AppText variant="caption" tone={photos.have === photos.total ? 'success' : 'muted'} tabular>
                  {photos.have} of {photos.total}
                </AppText>
              </View>
              <PhotoGrid stop={stop} captures={captures} busySlot={busySlot} onCapture={(slot) => void takePhoto(slot)} />
            </Section>
          ) : (
            <Section title="Photos for this stop">
              <Card variant="flat">
                <AppText variant="rowTitle">No photos required</AppText>
                <AppText variant="supporting" tone="muted">Mark this stop complete when you are done here.</AppText>
              </Card>
            </Section>
          )}

          {stop.notes || thread ? (
            <Section title="At this stop">
              <Card variant="flat" padded={false}>
                {stop.notes ? (
                  <ListRow icon="info" disc="neutral" title="Notes from dispatch" subtitle={stop.notes} />
                ) : null}
                {thread ? (
                  <ListRow
                    icon="mail"
                    disc="info"
                    title={[thread.last_message?.sender_name, clockOf(thread.last_message_at)].filter(Boolean).join(', ')}
                    subtitle={messagePreview(thread.last_message)}
                    onPress={() => router.push(`/messages/${thread.id}` as never)}
                  />
                ) : null}
              </Card>
            </Section>
          ) : null}
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

function clockOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

import { useState } from 'react';
import { Linking, Platform, View, useWindowDimensions } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { photoSlotLabel } from '@silvicom/shared';
import {
  ActionBar,
  AppText,
  Banner,
  Button,
  Card,
  GroupedList,
  Icon,
  Input,
  ListRow,
  Screen,
  ScreenHeader,
  Section,
  Skeleton,
  useToast,
} from '@/components';
import { MapStrip } from '@/features/loads/MapStrip';
import { PhotoRows } from '@/features/loads/PhotoRows';
import { mapsUrl, verdictTone, windowText, windowVerdict } from '@/features/loads/itineraryModel';
import { layout } from '@/theme/tokens';
import { useAddStopPhotos, useCompleteStop, useLoad } from '@/features/loads/useLoads';
import { capturePhotoForSlot } from '@/features/loads/stopCapture';
import {
  outstandingSlots,
  reasonRequiredToComplete,
  stopFooter,
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
  const addLate = useAddStopPhotos();
  // The thread lookup lives HERE rather than inside a `features/loads` component: a route may
  // compose across features, a feature may not reach into a sibling (`lint:boundaries`).
  const threads = useThreads(messagesEnabled);

  const [captures, setCaptures] = useState<SessionCapture[]>([]);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasonMode, setReasonMode] = useState<'completed' | 'skipped' | null>(null);
  const [reason, setReason] = useState('');
  const { fontScale } = useWindowDimensions();

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
  const verdict = windowVerdict(stop);
  const window = windowText(stop);
  // The stop's OWN place in the run. `stopProgress` counts finished stops, so it said "stop 1 of 2"
  // on a delivery opened before its pickup was done.
  const position = [...load.stops].sort((x, y) => x.seq - y.seq).findIndex((x) => x.id === stop.id) + 1;
  const navigateTo = mapsUrl(stop, Platform.OS === 'ios' ? 'ios' : 'android');
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
        setError('Camera access is off. Enable it for Silvicom 360 in Settings to add photos.');
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

  // ONE amber action, one thing at a time (D-DV5, D-DV27): arrive, then take what is missing, then
  // complete. What it says is `stopFooter`, which is tested; completing anyway stays a quiet button.
  const footer = stopFooter(stop, captures);
  const primary = footer.primary;
  // A late photo for a finished stop (D-DV30): queued like any capture, and the stop is not moved.
  const sendLate = async () => {
    setError(null);
    const queued = captures.length;
    try {
      await addLate.mutateAsync({ loadId: load.id, stopId: stop.id, captures });
      haptics.success();
      toast.show(`${queued === 1 ? 'Photo' : `${queued} photos`} for ${stop.name} queued · the office sees ${queued === 1 ? 'it' : 'them'} once sent`);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Your photo is on this phone and will retry.');
    }
  };
  const onPrimary = () => {
    if (!primary) return;
    if (primary.kind === 'arrive') void submit('arrived');
    else if (primary.kind === 'take') void takePhoto(primary.slot);
    else if (primary.kind === 'send') void sendLate();
    else onComplete();
  };
  const onQuiet = (kind: 'complete' | 'skip' | 'send') => {
    if (kind === 'send') {
      void sendLate();
      return;
    }
    if (kind === 'complete') {
      onComplete();
      return;
    }
    setReason('');
    setReasonMode('skipped');
  };

  return (
    <Screen
      flow="sections"
      media={<MapStrip stop={stop} onBack={() => router.back()} />}
      // Pinned, so the primary action is under the thumb without scrolling past the photos (D-DV10).
      // Hidden while the reason card is up, where its own confirm is the one decision.
      footer={
        reasonMode ? undefined : (
          <ActionBar>
            <View className={fontScale >= layout.largeTextBreakpoint ? 'gap-2' : 'flex-row gap-2'}>
              {navigateTo ? (
                <View className={fontScale >= layout.largeTextBreakpoint ? '' : 'flex-1'}>
                  {/* No icon: at a third of the width an icon pushed the word onto two lines. */}
                  <Button
                    label="Navigate"
                    variant="secondary"
                    size="lg"
                    onPress={() => void Linking.openURL(navigateTo)}
                  />
                </View>
              ) : null}
              {primary ? (
                <View className={fontScale >= layout.largeTextBreakpoint ? '' : 'flex-[1.4]'}>
                  <Button
                    label={primary.label}
                    size="lg"
                    variant="primary"
                    icon={primary.kind === 'take' ? 'photo_camera' : primary.kind === 'complete' ? 'check_circle' : primary.kind === 'send' ? 'cloud_sync' : undefined}
                    haptic={primary.kind === 'take' ? undefined : 'success'}
                    loading={primary.kind === 'take' ? busySlot === primary.slot : primary.kind === 'send' ? addLate.isPending : complete.isPending}
                    onPress={onPrimary}
                  />
                </View>
              ) : null}
            </View>
            <View className={fontScale >= layout.largeTextBreakpoint ? 'gap-1' : 'flex-row gap-2'}>
              {footer.quiet.map((action) => (
                <View key={action.kind} className={fontScale >= layout.largeTextBreakpoint ? '' : 'flex-1'}>
                  <Button label={action.label} variant="ghost" size="sm" onPress={() => onQuiet(action.kind)} />
                </View>
              ))}
            </View>
            <View className="flex-row items-center justify-center gap-1 pb-1">
              <Icon name="cloud_sync" size={14} className="text-ink-subtle" />
              <AppText variant="caption" tone="subtle">Saved on this phone first · syncs when you have signal</AppText>
            </View>
          </ActionBar>
        )
      }
    >
      {/* Visual 2026 V6 (mock screen 6): what the stop is, its name in the display face, where it is,
          and the window as the figure, with its verdict in its state colour. No ETA (D-DV13). */}
      <View className="gap-1">
        <AppText variant="label" tone="muted">
          {`${stop.kind === 'pickup' ? 'Pickup' : 'Delivery'} · stop ${position} of ${load.stops.length} · Load ${load.ref}`}
        </AppText>
        <AppText variant="screenTitle" accessibilityRole="header">{stop.name}</AppText>
        {stop.address_line || stop.city ? (
          <AppText variant="supporting" tone="secondary">
            {[stop.address_line, [stop.city, stop.state].filter(Boolean).join(', ')].filter(Boolean).join(', ')}
          </AppText>
        ) : null}
        {window ? (
          <View className="flex-row flex-wrap items-baseline pt-2" style={{ columnGap: 8 }}>
            <AppText variant="numericCompact">{window}</AppText>
            {verdict ? (
              <AppText variant="supporting" weight="semibold" tone={VERDICT_TONE[verdictTone(verdict)]}>
                {verdict.title}
              </AppText>
            ) : null}
          </View>
        ) : null}
        {stop.arrived_at ? (
          <AppText variant="supporting" tone="success">{`Arrived ${clockOf(stop.arrived_at)}`}</AppText>
        ) : null}
      </View>

      {error ? (
        <Section>
          <Banner tone="danger" icon="warning" message={error} />
        </Section>
      ) : null}

      {reasonMode ? (
        <Section>
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
          <Section title="Photos for this stop">
            {stop.required_photos.length > 0 ? (
              <PhotoRows stop={stop} captures={captures} busySlot={busySlot} onCapture={(slot) => void takePhoto(slot)} />
            ) : (
              <AppText variant="supporting" tone="secondary">No photos are needed here. Complete the stop when you are done.</AppText>
            )}
          </Section>

          {stop.notes || thread ? (
            <Section title="At this stop">
              <GroupedList>
                {stop.notes ? (
                  <ListRow icon="info" title="Notes from dispatch" subtitle={stop.notes} />
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
              </GroupedList>
            </Section>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const VERDICT_TONE = { live: 'accent', act: 'action', done: 'success' } as const;

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

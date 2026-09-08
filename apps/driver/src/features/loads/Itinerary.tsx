import { Pressable, View } from 'react-native';
import type { Load, LoadStop } from '@silvicom/shared';
import { AppText, Card, Icon, TONE_SOFT } from '@/components';
import { itineraryRows, photoCount, windowVerdict, NODE_LABEL, NODE_TONE, type NodeState } from './itineraryModel';
import { placeLabel } from './loadViewModel';
import { haptics } from '@/lib/haptics';

/**
 * The run as one vertical timeline.
 *
 * It replaces a `TaskStepper` reading "Assigned · Accepted · In transit · Stops · Complete" plus a
 * list of stop cards — two progress indicators for one run, neither of which was the run. The
 * lifecycle stepper is deleted outright (critique defect 21): a driver does not need to be told
 * that a load they are driving has been accepted.
 */
export function Itinerary({ load, onOpenStop }: { load: Load; onOpenStop: (stopId: string) => void }) {
  const rows = itineraryRows(load);

  return (
    <Card padded={false}>
      <View className="px-4 py-2">
        {rows.map(({ stop, state, connectorDone }, index) => (
          <StopLine
            key={stop.id}
            stop={stop}
            state={state}
            connectorAboveDone={connectorDone}
            first={index === 0}
            last={index === rows.length - 1}
            onPress={state === 'next' ? () => onOpenStop(stop.id) : undefined}
          />
        ))}
      </View>
    </Card>
  );
}

function StopLine({
  stop,
  state,
  connectorAboveDone,
  first,
  last,
  onPress,
}: {
  stop: LoadStop;
  state: NodeState;
  connectorAboveDone: boolean;
  first: boolean;
  last: boolean;
  onPress?: () => void;
}) {
  const photos = photoCount(stop);
  const verdict = state === 'next' ? windowVerdict(stop) : null;
  const tone = TONE_SOFT[NODE_TONE[state]];

  const body = (
    <View className="flex-row gap-3 py-2">
      <View className="w-7 items-center">
        {!first ? (
          <View className={`absolute top-0 h-3 w-0.5 ${connectorAboveDone ? 'bg-success' : 'bg-edge'}`} />
        ) : null}
        <View className={`h-7 w-7 items-center justify-center rounded-full ${nodeFill(state)}`}>
          {state === 'complete' ? (
            <Icon name="check" size={15} className="text-brand-fg" />
          ) : state === 'skipped' ? (
            <Icon name="do_not_disturb_on" size={15} className="text-warning" />
          ) : (
            <AppText
              variant="caption"
              tone={state === 'next' ? 'onBrand' : 'muted'}
              className="font-ui-sb"
              tabular
            >
              {stop.seq}
            </AppText>
          )}
        </View>
        {!last ? <View className={`w-0.5 flex-1 ${stop.status === 'completed' ? 'bg-success' : 'bg-edge'}`} /> : null}
      </View>

      <View className="flex-1 gap-0.5 pb-3">
        <View className="flex-row items-center gap-2">
          <AppText variant="rowTitle" className="flex-1" numberOfLines={1}>{stop.name}</AppText>
          <AppText variant="caption" tone={tone.textTone} className="font-ui-md">{NODE_LABEL[state]}</AppText>
        </View>
        <AppText variant="supporting" tone="muted" numberOfLines={1}>
          {stop.address_line ?? placeLabel(stop)} · {stop.kind === 'pickup' ? 'Pick up' : 'Deliver'}
        </AppText>

        {verdict ? (
          <View className="flex-row items-baseline gap-2 pt-1">
            <AppText variant="numericInline">{clock(stop.appointment_start)}</AppText>
            <AppText variant="supporting" tone={verdict.tone === 'warning' ? 'warning' : 'muted'} className="flex-1">
              {verdict.title}
            </AppText>
          </View>
        ) : null}

        {photos.total > 0 ? (
          <View className="flex-row items-center gap-2 pt-1">
            <Icon
              name="photo_camera"
              size={14}
              className={photos.have === photos.total ? 'text-success' : 'text-ink-secondary'}
            />
            <AppText variant="caption" tone={photos.have === photos.total ? 'success' : 'secondary'} numberOfLines={1}>
              {photos.have} of {photos.total} photos
            </AppText>
          </View>
        ) : null}

        {state === 'next' && stop.notes ? (
          <View className="flex-row items-start gap-2 pt-1">
            <Icon name="info" size={14} className="mt-0.5 text-ink-secondary" />
            <AppText variant="caption" tone="secondary" className="flex-1">{stop.notes}</AppText>
          </View>
        ) : null}
      </View>

      {onPress ? <Icon name="chevron_right" size={20} className="self-center text-ink-subtle" /> : null}
    </View>
  );

  if (!onPress) return <View accessible>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        haptics.select();
        onPress();
      }}
      className="-mx-4 rounded-xl px-4 active:bg-surface-selected"
    >
      {body}
    </Pressable>
  );
}

function nodeFill(state: NodeState): string {
  if (state === 'complete') return 'bg-success';
  if (state === 'next') return 'bg-brand';
  if (state === 'skipped') return 'border border-warning bg-warning/12';
  return 'border border-edge bg-surface-muted';
}

function clock(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

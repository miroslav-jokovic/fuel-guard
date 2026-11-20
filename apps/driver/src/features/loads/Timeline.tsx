import { Pressable, View } from 'react-native';
import type { Load } from '@silvicom/shared';
import { AppText, Icon } from '@/components';
import { haptics } from '@/lib/haptics';
import { timelineStops, type NodeState, type TimelineStopView } from './itineraryModel';

const LIVE_TONE = { live: 'accent', act: 'action', done: 'success' } as const;
const NEEDS_TONE = { secondary: 'secondary', done: 'success', act: 'action' } as const;

/**
 * The run as stops on a 2pt rail, with no cards (Visual 2026 V6, the V1 mock's screen 5; DESIGN.md
 * "Timeline"). The dot says where each stop stands: cyan with a halo for the one being worked, green
 * done, hollow ahead, amber hollow for one that was skipped. The window is the largest line in each
 * stop, and the photos a stop needs are words. What each line says is `timelineStops`, which is tested.
 *
 * It replaces the Direction B itinerary card with numbered discs and a "2 of 3 photos" counter.
 */
export function Timeline({ load, onOpenStop, now }: { load: Load; onOpenStop: (stopId: string) => void; now?: number }) {
  const stops = timelineStops(load, now);
  return (
    <View>
      {stops.map((stop, index) => (
        <TimelineStop
          key={stop.id}
          stop={stop}
          last={index === stops.length - 1}
          onPress={stop.tappable ? () => onOpenStop(stop.id) : undefined}
        />
      ))}
    </View>
  );
}

function TimelineStop({ stop, last, onPress }: { stop: TimelineStopView; last: boolean; onPress?: () => void }) {
  const body = (
    <View className="flex-row gap-4">
      <View className="w-5 items-center">
        <View className="h-6 items-center justify-center">
          <Dot state={stop.state} />
        </View>
        {!last ? <View className="w-0.5 flex-1 bg-edge" /> : null}
      </View>
      <View className="flex-1 gap-0.5" style={{ paddingBottom: last ? 4 : 24 }}>
        <AppText variant="label" tone="muted">{stop.kind}</AppText>
        <AppText variant="rowTitle">{stop.name}</AppText>
        {stop.address ? <AppText variant="supporting" tone="secondary">{stop.address}</AppText> : null}
        {stop.window ? (
          <View className="flex-row flex-wrap items-baseline pt-1" style={{ columnGap: 8 }}>
            <AppText variant="numericInline" tone={stop.state === 'complete' || stop.state === 'skipped' ? 'secondary' : 'primary'}>
              {stop.window}
            </AppText>
            {stop.live ? (
              <AppText variant="supporting" weight="semibold" tone={LIVE_TONE[stop.live.tone]}>{stop.live.text}</AppText>
            ) : null}
          </View>
        ) : null}
        {stop.needs ? (
          <AppText variant="supporting" tone={NEEDS_TONE[stop.needs.tone]} className="pt-1">{stop.needs.text}</AppText>
        ) : null}
      </View>
      {onPress ? <Icon name="chevron_right" size={20} className="self-center text-ink-subtle" /> : null}
    </View>
  );

  if (!onPress) return <View accessible className="-mx-3 px-3">{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[stop.kind, stop.name, stop.window, stop.live?.text, stop.needs?.text].filter(Boolean).join(', ')}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      className="-mx-3 rounded-xl px-3 active:bg-surface-selected"
    >
      {body}
    </Pressable>
  );
}

function Dot({ state }: { state: NodeState }) {
  if (state === 'next') {
    return (
      <View className="h-5 w-5 items-center justify-center rounded-full bg-accent/25">
        <View className="h-3 w-3 rounded-full bg-accent" />
      </View>
    );
  }
  if (state === 'complete') return <View className="h-3.5 w-3.5 rounded-full bg-success" />;
  return <View className={`h-3.5 w-3.5 rounded-full border-2 bg-canvas ${state === 'skipped' ? 'border-warning' : 'border-ink-muted'}`} />;
}

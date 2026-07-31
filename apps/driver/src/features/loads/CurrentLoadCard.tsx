import { Text, View } from 'react-native';
import { Badge, Button, Card, Icon, Progress } from '@/components';
import { LOAD_STATUS, RouteRail, type LoadSummary } from './LoadCard';

export interface ActiveLoad extends LoadSummary {
  progress: { current: number; total: number };
  nextStop: string;
  nextAction: string; // "Deliver" | "Pick up" …
  appointment: string; // "Appt 14:00 – 16:00"
}

// The Home hero: the driver's active load with next-stop focus, stop progress, and the one
// primary action (Navigate). Everything a driver needs in a 2-second glance.
export function CurrentLoadCard({
  load,
  onNavigate,
  onOpen,
}: {
  load: ActiveLoad;
  onNavigate: () => void;
  onOpen?: () => void;
}) {
  const s = LOAD_STATUS[load.status];
  const pct = load.progress.total > 0 ? load.progress.current / load.progress.total : 0;

  return (
    <Card onPress={onOpen}>
      <View className="flex-row items-center gap-2 pb-2">
        <Badge label={s.label} tone={s.tone} dot />
        <Text className="flex-1 text-xs font-sans-sb uppercase tracking-wider text-ink-muted">
          {load.ref}
        </Text>
        <Text className="text-xs font-sans-md text-ink-muted" style={{ fontVariant: ['tabular-nums'] }}>
          Stop {load.progress.current} of {load.progress.total}
        </Text>
      </View>

      <RouteRail
        origin={load.origin}
        originTime={load.originTime}
        destination={load.destination}
        destTime={load.destTime}
      />

      <View className="mt-3">
        <Progress label="Route progress" detail={`${load.progress.current} of ${load.progress.total} stops`} value={pct} />
      </View>

      {/* Next stop focus */}
      <View className="mt-3 flex-row items-center gap-2.5 rounded-lg bg-surface-muted px-3 py-2.5">
        <Icon name="pin_drop" size={18} className="text-brand" />
        <View className="flex-1 gap-0.5">
          <Text className="text-sm font-sans-sb text-ink">
            Next: {load.nextAction} — {load.nextStop}
          </Text>
          <View className="flex-row items-center gap-1">
            <Icon name="schedule" size={13} className="text-ink-muted" />
            <Text className="text-xs text-ink-muted" style={{ fontVariant: ['tabular-nums'] }}>
              {load.appointment}
            </Text>
          </View>
        </View>
      </View>

      <View className="pt-3">
        <Button label="Navigate" icon="navigation" iconFill variant="primary" size="lg" onPress={onNavigate} />
      </View>
    </Card>
  );
}

import { View } from 'react-native';
import { AppText, Badge, Button, Card, Icon, IconButton, Progress } from '@/components';
import { LOAD_STATUS, RouteRail, type LoadSummary } from './LoadCard';

export interface ActiveLoad extends LoadSummary {
  progress: { current: number; total: number };
  nextStop: string;
  nextAction: string;
  appointment: string;
}

export function CurrentLoadCard({
  load,
  onNavigate,
  onOpen,
}: {
  load: ActiveLoad;
  onNavigate: () => void;
  onOpen?: () => void;
}) {
  const status = LOAD_STATUS[load.status];
  const progress = load.progress.total > 0 ? load.progress.current / load.progress.total : 0;

  return (
    <Card variant="operational">
      <View className="flex-row items-center gap-2">
        <View className="flex-1 gap-0.5">
          <View className="flex-row flex-wrap items-center gap-2">
            <AppText variant="caption" tone="muted" className="font-semibold uppercase tracking-wider">{load.ref}</AppText>
            {load.hazmat ? <Badge label="Hazmat" tone="warning" icon="warning" /> : null}
          </View>
          <View className="flex-row items-center gap-1">
            <Icon name={status.icon} size={14} className={status.text} />
            <AppText variant="caption" className={`font-medium ${status.text}`}>{status.label}</AppText>
          </View>
        </View>
        {onOpen ? <IconButton name="chevron_right" label="Open load details" onPress={onOpen} /> : null}
      </View>

      <RouteRail
        origin={load.origin}
        originTime={load.originTime}
        destination={load.destination}
        destTime={load.destTime}
      />

      <Progress
        label={`Stop ${load.progress.current} of ${load.progress.total}`}
        value={progress}
      />

      <View className="flex-row items-start gap-3 border-t border-edge-subtle pt-3">
        <Icon name="pin_drop" size={19} className="mt-0.5 text-operation-current" />
        <View className="flex-1 gap-0.5">
          <AppText variant="sectionTitle">Next · {load.nextAction}</AppText>
          <AppText variant="body">{load.nextStop}</AppText>
          <AppText variant="caption" tone="muted" tabular>{load.appointment}</AppText>
        </View>
      </View>

      <Button label="Continue load" icon="route" variant="primary" size="lg" onPress={onNavigate} />
    </Card>
  );
}

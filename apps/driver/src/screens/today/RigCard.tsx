import { View } from 'react-native';
import { AppText, Button, Card, Icon } from '@/components';
import type { DutyView } from '@/features/duty/useDuty';

/**
 * The truck and trailer a driver is on, and the two things they can do about it (D-DB17).
 *
 * It sits at the FOOT of Home, after the work, on purpose: B2 removed the duty card from the top of
 * the screen because during a run it was the second-largest thing on it and answered nothing a
 * driver was asking. Here it is a compact record — which rig, since when — with the swap and the
 * end-of-shift a tap away, so the More tab and the check-in flow are not the only places a driver
 * can see what they signed on to. Everything on it is the current duty segment; nothing is guessed.
 */
export function RigCard({
  duty,
  onChange,
  onEndShift,
}: {
  duty: DutyView;
  onChange: () => void;
  onEndShift: () => void;
}) {
  if (!duty.onDuty) return null;
  return (
    <Card>
      <View className="gap-2">
        <RigRow icon="local_shipping" label="Truck" value={duty.vehicleUnit ? `Unit ${duty.vehicleUnit}` : 'Not recorded'} />
        <RigRow icon="route" label="Trailer" value={duty.trailerUnit ? `Trailer ${duty.trailerUnit}` : 'Bobtail — no trailer'} />
      </View>
      <View className="flex-row gap-2 pt-2">
        <View className="flex-1">
          <Button label="Change rig" icon="route" variant="secondary" size="sm" onPress={onChange} />
        </View>
        <View className="flex-1">
          <Button label="End shift" icon="logout" variant="ghost" size="sm" onPress={onEndShift} />
        </View>
      </View>
    </Card>
  );
}

function RigRow({ icon, label, value }: { icon: 'local_shipping' | 'route'; label: string; value: string }) {
  return (
    <View className="flex-row items-center gap-3">
      <View className="h-11 w-11 items-center justify-center rounded-full bg-surface-muted">
        <Icon name={icon} size={20} className="text-ink-secondary" />
      </View>
      <View className="flex-1 gap-0.5">
        <AppText variant="caption" tone="muted">{label}</AppText>
        <AppText variant="rowTitle" numberOfLines={1}>{value}</AppText>
      </View>
    </View>
  );
}

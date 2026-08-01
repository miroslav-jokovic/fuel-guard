import { Text, View } from 'react-native';
import { Icon } from './Icon';
import { Sparkline } from './Sparkline';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';
import { type as typeScale } from '@/theme/tokens';

// Glanceable metric: the big tabular numeral is the app's visual signature (plan §22.8).
// `trend` gives the number meaning at a glance — direction + whether that direction is GOOD
// (idling going down is positive), never color alone (arrow icon + text).
export function StatTile({
  label,
  value,
  unit,
  icon,
  trend,
  spark,
}: {
  label: string;
  value: string;
  unit?: string;
  icon?: MaterialSymbolName;
  trend?: { label: string; direction: 'up' | 'down'; positive: boolean };
  spark?: number[];
}) {
  return (
    <View className="flex-1 gap-1.5 rounded-xl border border-edge bg-surface p-4">
      <View className="flex-row items-center gap-1.5">
        {icon ? <Icon name={icon} size={14} className="text-ink" /> : null}
        <Text className="text-micro font-sans-sb uppercase tracking-wider text-ink-muted">
          {label}
        </Text>
      </View>
      <View className="flex-row items-baseline gap-1">
        <Text
          className="font-sans-bold text-ink"
          style={{
            fontSize: typeScale.size.stat,
            lineHeight: typeScale.line.stat,
            fontVariant: ['tabular-nums'],
            includeFontPadding: false,
          }}
        >
          {value}
        </Text>
        {unit ? <Text className="text-base text-ink-muted">{unit}</Text> : null}
      </View>
      {spark ? <Sparkline data={spark} /> : null}
      {trend ? (
        <View className="flex-row items-center gap-1">
          <Icon
            name={trend.direction === 'up' ? 'trending_up' : 'trending_down'}
            size={14}
            className={trend.positive ? 'text-success' : 'text-danger'}
          />
          <Text className={`text-xs font-sans-md ${trend.positive ? 'text-success' : 'text-danger'}`}>
            {trend.label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

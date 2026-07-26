import { Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { roleColors } from '@/theme/colors';
import { useTheme } from '@/theme/ThemeProvider';

// Stylized route sketch for the Drive shell: corridor + route line + origin/destination + planned
// fuel stops, on a faint map grid. Honest by design — it reads as a schematic preview, not a fake
// map. Phase 4 replaces this panel with the live MapLibre view over the server's HERE route (§8).
const ROUTE_D = 'M 24 122 C 90 118, 120 96, 156 78 S 250 44, 296 30';
const GRID_X = [64, 128, 192, 256];
const GRID_Y = [30, 60, 90, 120];
const FUEL_STOPS = [
  { x: 120, y: 96 },
  { x: 232, y: 52 },
];

export function RoutePreview() {
  const { isDark } = useTheme();
  const rc = roleColors[isDark ? 'dark' : 'light'];

  return (
    <View className="overflow-hidden rounded-xl border border-edge bg-surface">
      <Svg width="100%" height={150} viewBox="0 0 320 150">
        {GRID_X.map((x) => (
          <Line key={`x${x}`} x1={x} y1={8} x2={x} y2={142} stroke={rc.edge} strokeWidth={1} strokeDasharray="2 6" />
        ))}
        {GRID_Y.map((y) => (
          <Line key={`y${y}`} x1={12} y1={y} x2={308} y2={y} stroke={rc.edge} strokeWidth={1} strokeDasharray="2 6" />
        ))}
        {/* corridor halo, then the route */}
        <Path d={ROUTE_D} stroke={rc.brand} strokeOpacity={0.12} strokeWidth={14} strokeLinecap="round" fill="none" />
        <Path d={ROUTE_D} stroke={rc.brand} strokeWidth={3.5} strokeLinecap="round" fill="none" />
        {/* planned fuel stops */}
        {FUEL_STOPS.map((p) => (
          <Circle key={`${p.x}`} cx={p.x} cy={p.y} r={6} fill={rc.surface} stroke={rc.warning} strokeWidth={2.5} />
        ))}
        {/* origin & destination */}
        <Circle cx={24} cy={122} r={5.5} fill={rc.surface} stroke={rc.brand} strokeWidth={3} />
        <Circle cx={296} cy={30} r={5.5} fill={rc.brand} />
      </Svg>
      <View className="flex-row items-center gap-4 border-t border-edge-subtle px-4 py-2.5">
        <View className="flex-row items-center gap-1.5">
          <View className="h-2 w-2 rounded-full bg-brand" />
          <Text className="text-xs text-ink-muted">Route</Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <View className="h-3 w-3 rounded-full border-2 border-warning bg-surface" />
          <Text className="text-xs text-ink-muted">Planned fuel stops</Text>
        </View>
        <View className="flex-1" />
        <Text className="text-xs font-sans-md text-ink-subtle">Preview</Text>
      </View>
    </View>
  );
}

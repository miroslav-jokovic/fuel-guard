import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { roleColors } from '@/theme/colors';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Tiny trend line for stat tiles — the shape of the last N periods at a glance; the end-point dot
 * marks "now".
 *
 * The viewBox is the MEASURED width, not a fixed 100 stretched with `preserveAspectRatio="none"`.
 * That stretch scaled the stroke horizontally along with the geometry, so the same 1.75pt line drew
 * at a different weight in a wide tile than in a narrow one.
 */
export function Sparkline({ data, height = 22 }: { data: number[]; height?: number }) {
  const { themeKey } = useTheme();
  const rc = roleColors[themeKey];
  const [width, setWidth] = useState(0);

  if (data.length < 2) return null;
  const W = width;
  const P = 3;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;

  const pts = data.map((v, i) => ({
    x: P + (i * (W - 2 * P)) / (data.length - 1),
    y: P + (1 - (v - min) / span) * (height - 2 * P),
  }));
  const last = pts.at(-1);
  if (!last) return null;

  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ height }}>
      {W > 0 ? (
        <Svg width={W} height={height} viewBox={`0 0 ${W} ${height}`}>
          <Polyline
            points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={rc.action}
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Circle cx={last.x} cy={last.y} r={2.4} fill={rc.action} />
        </Svg>
      ) : null}
    </View>
  );
}

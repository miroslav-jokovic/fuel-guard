import Svg, { Circle, Polyline } from 'react-native-svg';
import { roleColors } from '@/theme/colors';
import { useTheme } from '@/theme/ThemeProvider';

// Tiny trend line for stat tiles — the shape of the last N periods at a glance. Stretches to its
// container width; the end-point dot marks "now".
export function Sparkline({ data, height = 22 }: { data: number[]; height?: number }) {
  const { isDark } = useTheme();
  const rc = roleColors[isDark ? 'dark' : 'light'];

  if (data.length < 2) return null;
  const W = 100;
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
    <Svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none">
      <Polyline
        points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke={rc.brand}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={last.x} cy={last.y} r={2.4} fill={rc.brand} />
    </Svg>
  );
}

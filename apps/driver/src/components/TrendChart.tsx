import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { AppText } from './AppText';
import {
  areaPath,
  calloutAnchor,
  domain,
  gridlines,
  points,
  smoothPath,
} from '@/features/score/trendChartModel';
import { roleColors } from '@/theme/colors';
import { useTheme } from '@/theme/ThemeProvider';

const HEIGHT = 150;
const PAD = { left: 26, right: 10, top: 8, bottom: 18 };

/**
 * Eight weeks of the driver's grade, on the navy (D-DB7 — Score's signature moment).
 *
 * The geometry is `trendChartModel`, tested; this only draws it. Two things are deliberate. The
 * axis labels are SVG text at a fixed 11pt rather than `AppText`: they are decorative furniture, and
 * letting Dynamic Type scale them would overlap the plot at large sizes — the values a driver needs
 * are in the callout and in the chart's accessibility label, both of which DO scale.
 *
 * Below two ranked weeks there is no chart, because a line between one point and nothing is a
 * drawing of a trend that does not exist yet.
 */
export function TrendChart({ values, weekLabel }: { values: readonly number[]; weekLabel?: string }) {
  const { themeKey } = useTheme();
  const rc = roleColors[themeKey];
  const [width, setWidth] = useState(0);

  if (values.length < 2) {
    return (
      <AppText variant="caption" tone="onHeroMuted">
        Your trend appears after two ranked weeks
      </AppText>
    );
  }

  const pts = width > 0 ? points(values, width, HEIGHT, PAD) : [];
  const last = pts[pts.length - 1];
  const callout = calloutAnchor(last, width);
  const { min, max } = domain(values);
  const lines = gridlines(values);

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: HEIGHT }}>
      {width > 0 && last ? (
        <>
          <Svg
            width={width}
            height={HEIGHT}
            accessibilityRole="image"
            accessibilityLabel={`Weekly score, ${values[0]} to ${values[values.length - 1]} over ${values.length} weeks`}
          >
            <Defs>
              <LinearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={rc.action} stopOpacity={0.28} />
                <Stop offset="1" stopColor={rc.action} stopOpacity={0} />
              </LinearGradient>
            </Defs>

            <G>
              {lines.map((value) => {
                const y = PAD.top + (1 - (value - min) / (max - min)) * (HEIGHT - PAD.top - PAD.bottom);
                return (
                  <G key={value}>
                    <Line
                      x1={PAD.left}
                      y1={y}
                      x2={width - PAD.right}
                      y2={y}
                      stroke={rc.onHero}
                      strokeOpacity={0.1}
                      strokeWidth={1}
                    />
                    <SvgText x={0} y={y + 4} fill={rc.onHeroMuted} fontSize={11}>
                      {value}
                    </SvgText>
                  </G>
                );
              })}
            </G>

            <Path d={areaPath(pts, HEIGHT, PAD.bottom)} fill="url(#trendFill)" />
            <Path
              d={smoothPath(pts)}
              fill="none"
              stroke={rc.action}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Line
              x1={last.x}
              y1={last.y}
              x2={last.x}
              y2={HEIGHT - PAD.bottom}
              stroke={rc.onHero}
              strokeOpacity={0.35}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <Circle cx={last.x} cy={last.y} r={5} fill={rc.hero} stroke={rc.action} strokeWidth={2.5} />
          </Svg>

          {callout ? (
            <View
              className="absolute rounded-md bg-surface px-3 py-2"
              style={{ left: callout.x, top: callout.y }}
              pointerEvents="none"
            >
              <AppText variant="supporting" className="font-ui-sb">{last.value}</AppText>
              <AppText variant="caption" tone="muted">{weekLabel ?? 'This week'}</AppText>
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

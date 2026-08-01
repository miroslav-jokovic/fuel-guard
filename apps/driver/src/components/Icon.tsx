import type { ComponentType } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { Circle, Ellipse, Line, Path, Rect, Svg, type SvgProps } from 'react-native-svg';
import type { IconSvgElement } from '@hugeicons/react-native';
import { HUGE_ICONS } from '@/theme/hugeIcons';
import { roleColors } from '@/theme/colors';
import { useTheme } from '@/theme/ThemeProvider';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

export interface IconProps {
  /** Stable FuelGuard semantic icon name; mapped to HugeIcons in one adapter. */
  name: MaterialSymbolName;
  size?: number;
  variant?: 'rounded' | 'outlined';
  /** Kept for screen API compatibility; HugeIcons uses consistent stroked SVG icons. */
  fill?: boolean;
  className?: string;
  color?: string;
  style?: StyleProp<ViewStyle>;
}

function colorFor(className: string | undefined, explicit: string | undefined, isDark: boolean): string {
  if (explicit) return explicit;
  const rc = roleColors[isDark ? 'dark' : 'light'];
  const token = className?.match(/(?:^|\s)text-([a-z-]+)/)?.[1];
  switch (token) {
    case 'brand': return rc.brand;
    case 'brand-fg': return rc.inkInverse;
    case 'danger': return rc.danger;
    case 'warning': return rc.warning;
    case 'caution': return rc.caution;
    case 'success': return rc.success;
    case 'info': return rc.info;
    case 'ink': return rc.ink;
    case 'ink-secondary': return rc.inkSecondary;
    case 'ink-inverse': return rc.inkInverse;
    case 'ink-subtle': return rc.inkSubtle;
    case 'ink-muted':
    case undefined:
    default: return rc.inkMuted;
  }
}

// HugeIcons ships every path with `stroke="currentColor"`, resolved at the native layer by
// react-native-svg walking up to the root <Svg color=...>. On Fabric/iOS that resolution reads
// mutable state on a view-recycling pool (RNSVGSvgView) that isn't reset between recycled
// instances, so icons intermittently render with a stale color from a previous, unrelated icon
// after navigating around — see software-mansion/react-native-svg issue 2566 (fixed upstream by
// PR 2991, not yet in a published release). Rather than depend on an unreleased native patch, we
// render each path/shape ourselves and bake the resolved color in as a literal prop instead of
// "currentColor" — Fabric then diffs it like any other prop, with no per-view color lookup
// involved, so there is nothing left to leak between recycled views.
const SVG_TAGS = { path: Path, circle: Circle, rect: Rect, ellipse: Ellipse, line: Line } as const;

// The source data's own stroke/strokeWidth/fill/key are dropped so our literal, explicit props
// below always win — HugeIcons' stroke-only glyphs rely on fill="none" from the parent <Svg>.
const OMITTED_ATTRS = new Set(['stroke', 'strokeWidth', 'fill', 'key']);

function renderElements(icon: IconSvgElement, color: string, strokeWidth: number) {
  return icon.map(([tag, attrs], index) => {
    const Component = SVG_TAGS[tag as keyof typeof SVG_TAGS] as ComponentType<SvgProps> | undefined;
    if (!Component) return null;
    const rest = Object.fromEntries(
      Object.entries(attrs).filter(([attrKey]) => !OMITTED_ATTRS.has(attrKey))
    );
    return (
      <Component
        key={`${tag}-${index}`}
        {...rest}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  });
}

export function Icon({
  name,
  size = 24,
  variant = 'rounded',
  fill = false,
  className,
  color,
  style,
}: IconProps) {
  const { isDark } = useTheme();
  const resolvedColor = colorFor(className, color, isDark);
  const strokeWidth = fill ? 2.1 : variant === 'outlined' ? 1.5 : 1.8;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={style}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {renderElements(HUGE_ICONS[name], resolvedColor, strokeWidth)}
    </Svg>
  );
}

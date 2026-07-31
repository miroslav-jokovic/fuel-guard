import { HugeiconsIcon } from '@hugeicons/react-native';
import { type StyleProp, type ViewStyle } from 'react-native';
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
    case 'ink-muted':
    case 'ink-subtle':
    case undefined:
    default: return rc.inkMuted;
  }
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
  return (
    <HugeiconsIcon
      icon={HUGE_ICONS[name]}
      size={size}
      color={colorFor(className, color, isDark)}
      strokeWidth={fill ? 2.1 : variant === 'outlined' ? 1.5 : 1.8}
      style={style}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

import { Pressable } from 'react-native';
import { Icon } from './Icon';
import { haptics } from '@/lib/haptics';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

/**
 * A 44pt circular icon target — headers, password toggles, inline actions. Always labeled for
 * screen readers (icon-only buttons are the top mobile a11y failure).
 *
 * `white` is the disc that floats over content (a back button on the stop map); `glass` is its
 * counterpart on the navy, where a white disc would shout and a plain glyph would vanish.
 */
export function IconButton({
  name,
  label,
  onPress,
  size = 22,
  fill: iconFill = false,
  variant = 'plain',
  disabled = false,
}: {
  name: MaterialSymbolName;
  label: string;
  onPress?: () => void;
  size?: number;
  fill?: boolean;
  variant?: 'plain' | 'tonal' | 'white' | 'glass';
  disabled?: boolean;
}) {
  const fill = {
    plain: '',
    tonal: 'bg-accent-soft',
    white: 'bg-surface',
    glass: 'bg-on-hero/10',
  }[variant];
  const glyph = {
    plain: 'text-ink',
    tonal: 'text-accent-ink',
    white: 'text-ink',
    glass: 'text-on-hero',
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={
        onPress
          ? () => {
              haptics.select();
              onPress();
            }
          : undefined
      }
      className={`h-11 w-11 items-center justify-center rounded-full ${fill} ${
        variant === 'glass' ? 'active:bg-on-hero/20' : 'active:bg-surface-selected'
      } ${disabled ? 'opacity-40' : ''}`}
    >
      <Icon name={name} size={size} fill={iconFill} className={glyph} />
    </Pressable>
  );
}

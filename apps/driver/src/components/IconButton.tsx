import { Pressable } from 'react-native';
import { Icon } from './Icon';
import { haptics } from '@/lib/haptics';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

// A 44pt circular icon target — headers, password toggles, inline actions. Always labeled for
// screen readers (icon-only buttons are the top mobile a11y failure).
export function IconButton({
  name,
  label,
  onPress,
  size = 22,
  fill = false,
  variant = 'plain',
  disabled = false,
}: {
  name: MaterialSymbolName;
  label: string;
  onPress?: () => void;
  size?: number;
  fill?: boolean;
  variant?: 'plain' | 'tonal';
  disabled?: boolean;
}) {
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
      className={`h-11 w-11 items-center justify-center rounded-lg active:bg-surface-selected ${
        variant === 'tonal' ? 'bg-brand-subtle' : ''
      } ${disabled ? 'opacity-40' : ''}`}
    >
      <Icon name={name} size={size} fill={fill} className={variant === 'tonal' ? 'text-brand' : 'text-ink'} />
    </Pressable>
  );
}

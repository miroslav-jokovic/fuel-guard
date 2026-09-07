import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { TONE_SOFT, type Tone } from './tone';
import { haptics } from '@/lib/haptics';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';
import { ui } from '@/theme/classes';

/**
 * A row leads with a 44pt circular disc tinted by its MEANING (D-DB6) — lavender for a message,
 * amber for sync or attention, green for complete, red for blocked, tile-grey for neutral. Before
 * this, every row led with the same 21pt grey glyph in a 24pt box, so a blocked stop and a settings
 * link were the same object at a glance.
 *
 * `icon` (the old bare glyph) still works for dense secondary lists; `disc` is the Direction B row.
 * Nothing here uses `self-start`: `right` content centres against the row, whatever its height.
 */
export function ListRow({
  title,
  subtitle,
  icon,
  iconFill,
  disc,
  right,
  onPress,
  disabled = false,
  destructive = false,
}: {
  title: string;
  subtitle?: string;
  icon?: MaterialSymbolName;
  iconFill?: boolean;
  /** Renders the leading icon as a 44pt tinted disc instead of a bare glyph. */
  disc?: Tone;
  right?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const tone = destructive ? 'danger' : disabled ? 'disabled' : 'primary';
  const discAppearance = disc ? TONE_SOFT[disc] : null;
  const content = (
    <>
      {icon && discAppearance ? (
        <View className={`h-11 w-11 items-center justify-center rounded-full ${discAppearance.bg}`}>
          <Icon name={icon} fill={iconFill} size={20} className={discAppearance.text} />
        </View>
      ) : icon ? (
        <View className="w-6 items-center justify-center">
          <Icon
            name={icon}
            fill={iconFill}
            size={21}
            className={destructive ? 'text-danger' : disabled ? 'text-ink-disabled' : 'text-ink-secondary'}
          />
        </View>
      ) : null}
      <View className="flex-1 gap-0.5">
        <AppText variant="rowTitle" tone={tone}>{title}</AppText>
        {subtitle ? <AppText variant="supporting" tone={disabled ? 'disabled' : 'muted'}>{subtitle}</AppText> : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron_right" size={20} className="text-ink-subtle" /> : null)}
    </>
  );

  const className = `${ui.listRow} ${disabled ? 'opacity-60' : ''}`;
  if (!onPress) return <View accessible className={className}>{content}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      className={`${className} active:bg-surface-selected`}
    >
      {content}
    </Pressable>
  );
}

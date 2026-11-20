import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { AppText, TEXT_TONE_CLASS } from './AppText';
import { Icon } from './Icon';
import { TONE_SOFT, type Tone } from './tone';
import { haptics } from '@/lib/haptics';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';
import { ui } from '@/theme/classes';

/**
 * A row on the canvas (Visual 2026 D-DV7, D-DV10): at least 56pt, a leading glyph, a title and an
 * optional second line, and a trailing figure, action word or chevron.
 *
 * `disc={tone}` no longer draws Direction B's 44pt tinted circle (D-DB6). It now tints the bare glyph
 * by the row's STATE: cyan for live, amber for act, red for stop, green for done (D-DV5). The prop
 * keeps its name so the 33 call sites move with no edit. A row with no `disc` keeps the secondary
 * ink, which is the neutral row.
 *
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
  /** Tints the leading glyph by the row's state (D-DV5). */
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
      {icon ? (
        <View className="w-6 items-center justify-center">
          <Icon
            name={icon}
            fill={iconFill}
            size={22}
            className={
              destructive
                ? 'text-danger'
                : disabled
                  ? 'text-ink-disabled'
                  : discAppearance
                    ? TEXT_TONE_CLASS[discAppearance.textTone]
                    : 'text-ink-secondary'
            }
          />
        </View>
      ) : null}
      <View className="flex-1 gap-0.5">
        <AppText variant="rowTitle" tone={tone}>{title}</AppText>
        {subtitle ? <AppText variant="supporting" tone={disabled ? 'disabled' : 'secondary'}>{subtitle}</AppText> : null}
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

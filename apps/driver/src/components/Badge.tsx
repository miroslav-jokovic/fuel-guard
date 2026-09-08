import { View } from 'react-native';
import { AppText, TEXT_TONE_CLASS } from './AppText';
import { Icon } from './Icon';
import { TONE_CHIP, type Tone } from './tone';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

/**
 * Short categorical status only; never a replacement for hierarchy or explanatory copy.
 *
 * The root deliberately does NOT set `self-start`. It did until the 2026-09-07 critique found the
 * consequence on five screens: inside a `ListRow`, a self-starting chip pins itself to the top of a
 * two-line row while everything beside it is centred, so the row reads as broken at a glance. A chip
 * centres in whatever holds it; a parent that wants it hugging the top says so itself.
 */
export function Badge({
  label,
  tone = 'neutral',
  icon,
  size = 'sm',
}: {
  label: string;
  tone?: Tone;
  icon?: MaterialSymbolName;
  size?: 'sm' | 'md';
}) {
  const appearance = TONE_CHIP[tone];
  return (
    <View
      className={`flex-row items-center justify-center gap-1 rounded-full px-3 ${appearance.bg}`}
      style={{ minHeight: size === 'md' ? 32 : 28 }}
    >
      {icon ? <Icon name={icon} size={14} className={TEXT_TONE_CLASS[appearance.textTone]} /> : null}
      <AppText variant="caption" tone={appearance.textTone} className="font-ui-md">{label}</AppText>
    </View>
  );
}

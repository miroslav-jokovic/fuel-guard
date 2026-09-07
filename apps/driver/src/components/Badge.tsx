import { View } from 'react-native';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { TONE_SOFT, type Tone } from './tone';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

/**
 * Chip tones (D-DB2/D-DB6). `brand` is the lavender fill and `action` the amber one; `info` and
 * `success`/`danger` use the soft fills with their strong role as text, which is the same pairing a
 * row disc uses, so a chip and a disc for the same meaning are the same two colours.
 *
 * Text on `accent` and `action` is `action-fg`, never `ink`: both hold the same value in all four
 * appearances, so a theme-relative ink lands on lavender at 1.4:1 in the dark themes.
 */
const TONE: Record<Tone, { bg: string; text: string }> = {
  ...TONE_SOFT,
  // The two SOLID chips: lavender for informational state, amber for time-critical state.
  brand: { bg: 'bg-accent', text: 'text-action-fg' },
  action: { bg: 'bg-action', text: 'text-action-fg' },
};

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
  const appearance = TONE[tone];
  return (
    <View
      className={`flex-row items-center justify-center gap-1 rounded-full px-3 ${appearance.bg}`}
      style={{ minHeight: size === 'md' ? 32 : 28 }}
    >
      {icon ? <Icon name={icon} size={14} className={appearance.text} /> : null}
      <AppText variant="caption" className={`font-ui-md ${appearance.text}`}>{label}</AppText>
    </View>
  );
}

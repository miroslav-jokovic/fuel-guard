import { View } from 'react-native';
import { AppText } from './AppText';

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Initials on a hero-tile disc. It carries no ring: the avatar's home is the navy duty strip, where
 * a grey border reads as a rendering artefact rather than containment.
 *
 * It was `bg-action` until 2026-09-07, and that argued against the decision it cited. D-DB2 is
 * exact: "Safety **amber is the only action colour** on the hero." A non-interactive identity chip
 * is not an action — and on the duty strip it made the loudest object a 44pt amber disc that does
 * nothing, sitting beside the two things that DO (messages, notifications) rendered in translucent
 * white. The affordance was inverted, which is the opposite of "keep primary actions visually
 * dominant" (DESIGN.md). Amber is now spent only where a driver may tap.
 */
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <View
      className="items-center justify-center rounded-full bg-hero-tile"
      style={{ width: size, height: size }}
      accessibilityLabel={name}
    >
      <AppText
        variant="numericCompact"
        className="text-action-fg"
        style={{ fontSize: size * 0.38, includeFontPadding: false }}
      >
        {initials(name)}
      </AppText>
    </View>
  );
}

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
 * Initials on the amber disc. It carries no ring: the avatar's home is the navy duty strip, where a
 * grey border reads as a rendering artefact rather than containment (D-DB2 — amber is the hero's
 * one accent, and a person is the one thing on that strip worth accenting).
 */
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <View
      className="items-center justify-center rounded-full bg-action"
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

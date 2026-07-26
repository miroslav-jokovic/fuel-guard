import { Text, View } from 'react-native';

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

// Initials avatar on the brand fill, with a subtle ring so it holds its shape on any surface.
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <View
      className="items-center justify-center rounded-full border border-edge bg-brand"
      style={{ width: size, height: size }}
      accessibilityLabel={name}
    >
      <Text
        className="font-bold text-brand-fg"
        style={{ fontSize: size * 0.38, includeFontPadding: false }}
      >
        {initials(name)}
      </Text>
    </View>
  );
}

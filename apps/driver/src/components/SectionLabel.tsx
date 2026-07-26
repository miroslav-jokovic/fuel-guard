import { Text } from 'react-native';

// Uppercase micro-label that groups content on a screen (Home, More, Settings). One place,
// one style — instead of each screen re-declaring it.
export function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="px-1 pt-2 text-[11px] font-sans-sb uppercase tracking-wider text-ink-muted">
      {children}
    </Text>
  );
}

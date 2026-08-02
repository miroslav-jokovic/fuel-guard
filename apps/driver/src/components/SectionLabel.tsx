import { Text } from 'react-native';
import { ui } from '@/theme/classes';

// Uppercase micro-label that groups content on a screen (Home, More, Settings). One place,
// one style — instead of each screen re-declaring it.
export function SectionLabel({ children }: { children: string }) {
  return (
    <Text className={ui.sectionLabel}>
      {children}
    </Text>
  );
}

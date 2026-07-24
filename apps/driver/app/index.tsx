import { Text, View } from 'react-native';
import { Link } from 'expo-router';
import { derivePricePerGal, fillUpInputSchema, USER_ROLES } from '@fuelguard/shared';
import { Screen, Card, Button } from '@/components';
import { useTheme } from '@/theme/ThemeProvider';

// Phase-0 spike + entry to the design gallery. Replaced by the tab shell in the next increment.
export default function SpikeScreen() {
  const { isDark, setMode } = useTheme();

  const pricePerGal = derivePricePerGal(40, 120) ?? 0; // 40 gal, $120 → $3.00/gal
  const parsed = fillUpInputSchema.safeParse({
    id: '00000000-0000-4000-8000-000000000000',
    vehicle_id: '00000000-0000-4000-8000-000000000001',
    fueled_at: new Date(0).toISOString(),
    gallons: 40,
  });

  return (
    <Screen>
      <Text className="text-xl font-bold text-ink">FuelGuard Driver — Phase 0</Text>
      <Text className="text-ink-muted">Foundation verified: shared reuse, Zod on Hermes, tokens in light + dark.</Text>

      <Card>
        <Text className="text-sm text-ink-muted">Shared reuse (B2)</Text>
        <Text className="text-ink font-bold" style={{ fontSize: 40, fontVariant: ['tabular-nums'] }}>
          ${pricePerGal.toFixed(2)}/gal
        </Text>
      </Card>

      <Card>
        <Text className="text-sm text-ink-muted">Shared Zod on Hermes (B6)</Text>
        <Text className="text-lg font-semibold text-ink">
          fillUpInputSchema.safeParse → {parsed.success ? 'valid ✓' : 'invalid'}
        </Text>
        <Text className="text-ink-secondary">roles: {USER_ROLES.join(', ')}</Text>
      </Card>

      <Link href="/gallery" asChild>
        <Button label="View design gallery →" variant="primary" />
      </Link>
      <Button
        label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        variant="soft"
        onPress={() => setMode(isDark ? 'light' : 'dark')}
      />
    </Screen>
  );
}

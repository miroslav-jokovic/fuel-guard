import { Text, View } from 'react-native';
import { derivePricePerGal, fillUpInputSchema, USER_ROLES } from '@fuelguard/shared';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeProvider';

// Phase-0 spike: if this renders themed in light + dark on a device, the foundation is proven:
//   B2 — @fuelguard/shared imported through Metro (built dist)
//   B6 — a shared Zod schema parses at runtime on Hermes
//   NativeWind tokens + manual dark override work end to end.
export default function SpikeScreen() {
  const { isDark, setMode } = useTheme();

  // B2: shared pure math (server-parity)
  const pricePerGal = derivePricePerGal(120, 40); // $120 / 40 gal = $3.00

  // B6: shared Zod schema at runtime
  const parsed = fillUpInputSchema.safeParse({
    id: '00000000-0000-4000-8000-000000000000',
    vehicle_id: '00000000-0000-4000-8000-000000000001',
    fueled_at: new Date(0).toISOString(),
    gallons: 40,
  });

  return (
    <Screen>
      <Text className="text-xl font-bold text-ink">FuelGuard Driver — Phase 0 spike</Text>
      <Text className="text-ink-muted">
        Themed in light + dark, importing @fuelguard/shared, validating with Zod.
      </Text>

      <Card>
        <Text className="text-sm text-ink-muted">Shared reuse (B2)</Text>
        <Text className="text-ink font-bold" style={{ fontSize: 40, fontVariant: ['tabular-nums'] }}>
          ${pricePerGal.toFixed(2)}/gal
        </Text>
        <Text className="text-ink-secondary">derivePricePerGal(120, 40)</Text>
      </Card>

      <Card>
        <Text className="text-sm text-ink-muted">Shared Zod on Hermes (B6)</Text>
        <Text className="text-lg font-semibold text-ink">
          fillUpInputSchema.safeParse → {parsed.success ? 'valid ✓' : 'invalid'}
        </Text>
        <Text className="text-ink-secondary">roles: {USER_ROLES.join(', ')}</Text>
      </Card>

      <Card>
        <Text className="text-sm text-ink-muted">Design tokens</Text>
        <View className="gap-2 pt-1">
          <Button label="Primary action" variant="primary" />
          <Button label="Secondary" variant="secondary" />
          <Button label="Danger" variant="danger" />
        </View>
      </Card>

      <Button
        label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        variant="soft"
        onPress={() => setMode(isDark ? 'light' : 'dark')}
      />
    </Screen>
  );
}

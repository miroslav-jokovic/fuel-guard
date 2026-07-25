import { useState } from 'react';
import { Text, View } from 'react-native';
import {
  Avatar, Badge, Banner, Button, Card, EmptyState, Field, Icon, Input, ListRow,
  NumericField, Screen, SegmentedControl, Skeleton, StatTile, Toast, severityTone,
} from '@/components';
import { useTheme } from '@/theme/ThemeProvider';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-3">
      <Text className="text-xs uppercase tracking-wide text-ink-muted">{title}</Text>
      {children}
    </View>
  );
}

const DEMO_ICONS: MaterialSymbolName[] = [
  'local_gas_station', 'local_shipping', 'navigation', 'bolt', 'receipt_long',
  'check_circle', 'warning', 'error', 'sync', 'star', 'school', 'health_and_safety',
];

export default function Gallery() {
  const { isDark, setMode } = useTheme();
  const [gallons, setGallons] = useState('42.3');
  const [seg, setSeg] = useState<'day' | 'week' | 'month'>('week');

  return (
    <Screen>
      <View className="flex-row items-center justify-between">
        <Text className="text-xl font-bold text-ink">Design system</Text>
        <Button label={isDark ? 'Light' : 'Dark'} icon={isDark ? 'light_mode' : 'dark_mode'} size="sm" variant="soft" onPress={() => setMode(isDark ? 'light' : 'dark')} />
      </View>

      <Section title="Material Symbols — rounded · weight 200 · grade 200">
        <Card>
          <View className="flex-row flex-wrap gap-4">
            {DEMO_ICONS.map((n) => (
              <Icon key={n} name={n} size={28} className="text-ink-secondary" />
            ))}
          </View>
          <View className="flex-row items-center gap-4 pt-3">
            <Icon name="local_gas_station" size={28} className="text-brand" />
            <Icon name="local_gas_station" size={28} fill className="text-brand" />
            <Icon name="star" size={28} variant="outlined" className="text-ink-muted" />
            <Icon name="star" size={28} fill className="text-warning" />
          </View>
        </Card>
      </Section>

      <Section title="Buttons">
        <Button label="Log fill-up" icon="local_gas_station" iconFill variant="primary" />
        <Button label="Scan receipt" icon="photo_camera" variant="secondary" />
        <Button label="Delete" icon="delete" variant="danger" />
        <Button label="Syncing…" loading variant="soft" />
        <Button label="Disabled" variant="primary" disabled />
      </Section>

      <Section title="Stat tiles">
        <View className="flex-row gap-3">
          <StatTile label="Fleet MPG" value="6.59" />
          <StatTile label="This week" value="128" unit="gal" />
        </View>
      </Section>

      <Section title="Badges (severity)">
        <View className="flex-row flex-wrap gap-2">
          <Badge label="Critical" tone={severityTone('critical')} />
          <Badge label="High" tone={severityTone('high')} />
          <Badge label="Medium" tone={severityTone('medium')} />
          <Badge label="Clear" tone="success" />
        </View>
      </Section>

      <Section title="Numeric entry">
        <Field label="Gallons" required hint="Native decimal keypad, tabular numerals">
          <NumericField value={gallons} onChangeText={setGallons} unit="gal" />
        </Field>
      </Section>

      <Section title="Inputs">
        <Field label="Location" hint="Optional station or city">
          <Input placeholder="e.g. Pilot Travel Center, Effingham IL" />
        </Field>
        <Field label="Odometer" error="This is below the last recorded reading (48,210).">
          <Input placeholder="48000" invalid keyboardType="number-pad" />
        </Field>
      </Section>

      <Section title="Segmented control">
        <SegmentedControl
          value={seg}
          onChange={setSeg}
          options={[
            { label: 'Day', value: 'day' },
            { label: 'Week', value: 'week' },
            { label: 'Month', value: 'month' },
          ]}
        />
      </Section>

      <Section title="Banners & toast">
        <Banner tone="warning" message="Offline — your entries are saved and will sync." />
        <Banner tone="danger" message="Exceeds tank capacity (150 gal)." />
        <Toast tone="success" message="Fill-up saved" />
      </Section>

      <Section title="List rows">
        <ListRow title="Unit 4471 — Freightliner Cascadia" subtitle="Odometer 438,795 · Diesel" icon="local_shipping" onPress={() => {}} />
        <ListRow title="Fuel Log" subtitle="12 fills this week" icon="receipt_long" right={<Badge label="2 pending" tone="warning" />} onPress={() => {}} />
      </Section>

      <Section title="Card + Avatar">
        <Card>
          <View className="flex-row items-center gap-3">
            <Avatar name="Miki Jokovic" />
            <View>
              <Text className="text-base font-semibold text-ink">Miki Jokovic</Text>
              <Text className="text-sm text-ink-muted">Driver · Silvicom Inc.</Text>
            </View>
          </View>
        </Card>
      </Section>

      <Section title="Skeleton (loading)">
        <View className="gap-2">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-24 w-full" />
        </View>
      </Section>

      <Section title="Empty state">
        <Card>
          <EmptyState icon="receipt_long" title="No fill-ups yet" subtitle="Tap to log your first — about 30 seconds." actionLabel="Log fill-up" actionIcon="local_gas_station" onAction={() => {}} />
        </Card>
      </Section>
    </Screen>
  );
}

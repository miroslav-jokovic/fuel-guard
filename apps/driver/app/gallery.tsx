import { useState } from 'react';
import { Text, View } from 'react-native';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  ListRow,
  NumericField,
  Screen,
  SegmentedControl,
  Skeleton,
  StatTile,
  Toast,
  severityTone,
} from '@/components';
import { useTheme } from '@/theme/ThemeProvider';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-3">
      <Text className="text-xs uppercase tracking-wide text-ink-muted">{title}</Text>
      {children}
    </View>
  );
}

// Phase-0 design gallery: renders every primitive in light + dark for the token + a11y audit.
export default function Gallery() {
  const { isDark, setMode } = useTheme();
  const [gallons, setGallons] = useState('42.3');
  const [seg, setSeg] = useState<'day' | 'week' | 'month'>('week');

  return (
    <Screen>
      <View className="flex-row items-center justify-between">
        <Text className="text-xl font-bold text-ink">Design system</Text>
        <Button label={isDark ? 'Light' : 'Dark'} size="sm" variant="soft" onPress={() => setMode(isDark ? 'light' : 'dark')} />
      </View>

      <Section title="Buttons">
        <Button label="Primary" variant="primary" />
        <Button label="Secondary" variant="secondary" />
        <Button label="Danger" variant="danger" />
        <Button label="Soft" variant="soft" />
        <Button label="Ghost" variant="ghost" />
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
          <Badge label="Info" tone="info" />
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
        <Toast tone="success" message="Fill-up saved ✓" />
      </Section>

      <Section title="List rows">
        <ListRow title="Unit 4471 — Freightliner Cascadia" subtitle="Odometer 438,795 · Diesel" onPress={() => {}} />
        <ListRow title="Fuel Log" subtitle="12 fills this week" right={<Badge label="2 pending" tone="warning" />} onPress={() => {}} />
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
          <EmptyState title="No fill-ups yet" subtitle="Tap the fuel button to log your first — about 30 seconds." actionLabel="Log fill-up" onAction={() => {}} />
        </Card>
      </Section>
    </Screen>
  );
}

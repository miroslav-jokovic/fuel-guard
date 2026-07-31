import { useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Avatar, Badge, Banner, Button, Card, ConfirmSheet, EmptyState, Field, Icon, IconButton, Input,
  ListRow, NumericField, ScoreRing, Screen, ScreenHeader, SectionLabel, SegmentedControl, Skeleton,
  StatTile, Toast, severityTone,
} from '@/components';
import { LoadCard } from '@/features/loads/LoadCard';
import { SAMPLE_UPCOMING } from '@/features/loads/sampleLoads';
import { useTheme } from '@/theme/ThemeProvider';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-3">
      <SectionLabel>{title}</SectionLabel>
      {children}
    </View>
  );
}

const DEMO_ICONS: MaterialSymbolName[] = [
  'local_shipping', 'navigation', 'route', 'pin_drop', 'local_gas_station', 'speed',
  'check_circle', 'warning', 'error', 'sync', 'school', 'health_and_safety',
];

export default function Gallery() {
  const router = useRouter();
  const { isDark, setMode } = useTheme();
  const [gallons, setGallons] = useState('42.3');
  const [seg, setSeg] = useState<'upcoming' | 'current' | 'previous'>('current');
  const [sheetOpen, setSheetOpen] = useState(false);
  const noop = () => undefined; // gallery previews are non-interactive
  const demoLoad = SAMPLE_UPCOMING[0];

  return (
    <Screen padTop={false}>
      <ScreenHeader
        title="Design system"
        subtitle="Every component · light & dark"
        onClose={() => router.back()}
        right={
          <IconButton
            name={isDark ? 'light_mode' : 'dark_mode'}
            label="Toggle theme"
            variant="tonal"
            onPress={() => setMode(isDark ? 'light' : 'dark')}
          />
        }
      />

      <Section title="Icons — Material Symbols · rounded · wght 200 · grade 200">
        <Card>
          <View className="flex-row flex-wrap gap-4">
            {DEMO_ICONS.map((n) => (
              <Icon key={n} name={n} size={26} className="text-ink-secondary" />
            ))}
          </View>
          <View className="flex-row items-center gap-4 pt-3">
            <Icon name="navigation" size={26} className="text-brand" />
            <Icon name="navigation" size={26} fill className="text-brand" />
            <Icon name="star" size={26} variant="outlined" className="text-ink-muted" />
            <Icon name="star" size={26} fill className="text-warning" />
          </View>
        </Card>
      </Section>

      <Section title="Buttons — sm / md / lg · loading keeps width">
        <Button label="Navigate" icon="navigation" iconFill variant="primary" size="lg" onPress={noop} />
        <Button label="Accept load" icon="check" variant="primary" onPress={noop} />
        <Button label="Take photo" icon="photo_camera" variant="secondary" onPress={noop} />
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Button label="Syncing…" loading variant="soft" />
          </View>
          <View className="flex-1">
            <Button label="Remove" icon="delete" variant="danger" size="sm" onPress={noop} />
          </View>
        </View>
        <Button label="Disabled" variant="primary" disabled />
      </Section>

      <Section title="Icon buttons">
        <View className="flex-row gap-2">
          <IconButton name="arrow_back" label="Back" onPress={noop} />
          <IconButton name="close" label="Close" onPress={noop} />
          <IconButton name="refresh" label="Refresh" variant="tonal" onPress={noop} />
          <IconButton name="more_vert" label="More options" variant="tonal" onPress={noop} />
        </View>
      </Section>

      <Section title="Load card (the app's signature)">
        {demoLoad ? <LoadCard load={demoLoad} onPress={noop} /> : null}
      </Section>

      <Section title="Segmented control — sliding thumb">
        <SegmentedControl
          value={seg}
          onChange={setSeg}
          options={[
            { label: 'Upcoming', value: 'upcoming' },
            { label: 'Current', value: 'current' },
            { label: 'Previous', value: 'previous' },
          ]}
        />
      </Section>

      <Section title="Data viz — score ring & sparklines">
        <Card>
          <View className="items-center py-2">
            <ScoreRing score={87} sublabel="/ 100" size={132} />
          </View>
        </Card>
        <View className="flex-row gap-3">
          <StatTile
            label="Score"
            value="87"
            spark={[82, 84, 83, 85, 86, 86, 87]}
            trend={{ label: '+3 vs last wk', direction: 'up', positive: true }}
          />
          <StatTile
            label="Idling"
            value="79"
            icon="schedule"
            spark={[83, 82, 81, 80, 80, 79, 79]}
            trend={{ label: '-2', direction: 'down', positive: false }}
          />
        </View>
      </Section>

      <Section title="Confirm sheet (D19 — never a native Alert)">
        <Button
          label="Delete something…"
          icon="delete"
          variant="danger"
          onPress={() => setSheetOpen(true)}
        />
        <ConfirmSheet
          visible={sheetOpen}
          tone="danger"
          icon="delete"
          title="Delete this item?"
          message="This is the tokenized confirm sheet — grabber, icon badge, stacked actions, warning haptic on present."
          confirmLabel="Delete"
          onConfirm={() => setSheetOpen(false)}
          onCancel={() => setSheetOpen(false)}
        />
      </Section>

      <Section title="Badges">
        <View className="flex-row flex-wrap gap-2">
          <Badge label="In transit" tone="brand" dot />
          <Badge label="Delivered" tone="success" icon="check_circle" />
          <Badge label="Hazmat" tone="warning" icon="warning" />
          <Badge label="Critical" tone={severityTone('critical')} />
          <Badge label="2 pending" tone="info" dot />
        </View>
      </Section>

      <Section title="Inputs — visible focus state">
        <Field label="Location" hint="Tap to see the brand focus ring">
          <Input placeholder="e.g. Pilot Travel Center, Effingham IL" />
        </Field>
        <Field label="Odometer" error="This is below the last recorded reading (48,210).">
          <Input placeholder="48000" invalid keyboardType="number-pad" />
        </Field>
        <Field label="Gallons" required hint="Big tabular numerals, native decimal pad">
          <NumericField value={gallons} onChangeText={setGallons} unit="gal" />
        </Field>
      </Section>

      <Section title="Banners & toast">
        <Banner tone="warning" message="Offline — your work is saved and will sync." actionLabel="Retry" onAction={noop} />
        <Banner tone="danger" message="Couldn't sync 2 photos yet." actionLabel="View" onAction={noop} />
        <Toast tone="success" message="Stop 2 completed — 4 photos queued" />
      </Section>

      <Section title="List rows">
        <ListRow
          title="Unit 4471 — Freightliner Cascadia"
          subtitle="Odometer 438,795 · Diesel"
          icon="local_shipping"
          onPress={noop}
        />
        <ListRow
          title="Training"
          subtitle="Safety courses & quizzes"
          icon="school"
          right={<Badge label="Soon" tone="info" />}
        />
      </Section>

      <Section title="Card + Avatar">
        <Card>
          <View className="flex-row items-center gap-3">
            <Avatar name="Miki Jokovic" size={44} />
            <View className="gap-0.5">
              <Text className="text-base font-sans-sb text-ink">Miki Jokovic</Text>
              <Text className="text-sm text-ink-muted">Driver · Silvicom Inc.</Text>
            </View>
          </View>
        </Card>
      </Section>

      <Section title="Skeletons — pulsing">
        <View className="gap-2">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-24 w-full" />
        </View>
      </Section>

      <Section title="Empty state">
        <Card padded={false}>
          <EmptyState
            icon="event"
            title="No upcoming loads"
            subtitle="New assignments from dispatch will appear here."
            actionLabel="Refresh"
            actionIcon="refresh"
            onAction={noop}
          />
        </Card>
      </Section>
    </Screen>
  );
}

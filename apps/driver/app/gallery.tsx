import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import {
  ActionBar, AppText, Avatar, Badge, Banner, Button, Card, ConfirmSheet, EmptyState, Field,
  GroupedList, Icon, IconButton, Input, ListRow, NumericField, Progress, Screen, ScreenHeader,
  Section, SegmentedControl, Skeleton, Sparkline, TaskStepper, Toast, severityTone, useToast, type Tone,
} from '@/components';
import { LoadCard } from '@/features/loads/LoadCard';
import { AttentionQueue } from '@/screens/today/AttentionQueue';
import type { AttentionRow, TodayState } from '@/screens/today/todayModel';
import { SAMPLE_UPCOMING } from '@/features/loads/sampleLoads';
import { useTheme } from '@/theme/ThemeProvider';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

const CHIP_TONES: Tone[] = ['neutral', 'brand', 'action', 'info', 'success', 'danger', 'warning', 'caution'];

/** Fixture rows only — the ORDERING is `todayModel.attentionRows`, pinned by today-model.test.ts. */
const TODAY_STATES: { state: TodayState; note: string; rows: AttentionRow[] }[] = [
  {
    state: 'preShift',
    note: 'Off duty. The hero asks for equipment; the queue is what to clear before rolling.',
    rows: [
      { key: 'a', tone: 'caution', icon: 'route', title: 'Dry van needs a trailer', subtitle: "Add the one you're pulling before your pickup", href: '/duty/check-in' },
    ],
  },
  {
    state: 'activeLoad',
    note: 'On duty, a load in transit. The hero is the stop; the queue is what could stop it.',
    rows: [
      { key: 'b', tone: 'danger', icon: 'sync_problem', title: "2 items couldn't sync", subtitle: 'Your work is safe · tap to retry', href: '/settings' },
      { key: 'c', tone: 'info', icon: 'mail', title: 'Maria', subtitle: '“Are you loaded yet?”', time: '11:45', href: '/messages' },
      { key: 'd', tone: 'action', icon: 'sync', title: '3 items waiting to sync', subtitle: 'Saved on this phone · sends when you have signal' },
    ],
  },
  {
    state: 'betweenLoads',
    note: 'On duty, nothing in transit. Up next leads and gets two rows instead of one.',
    rows: [],
  },
  {
    state: 'recovery',
    note: 'Duty or profile failed to load. A banner leads, the cached hero stays, up next collapses.',
    rows: [
      { key: 'e', tone: 'danger', icon: 'sync_problem', title: "1 item couldn't sync", subtitle: 'Your work is safe · tap to retry', href: '/settings' },
    ],
  },
];

const DEMO_ICONS: MaterialSymbolName[] = [
  'local_shipping', 'navigation', 'route', 'pin_drop', 'local_gas_station', 'speed',
  'check_circle', 'warning', 'error', 'sync', 'school', 'health_and_safety',
];

export default function Gallery() {
  const router = useRouter();
  const { isDark, setMode } = useTheme();
  const [gallons, setGallons] = useState('42.3');
  const [seg, setSeg] = useState<'upcoming' | 'current' | 'previous'>('current');
  const [chip, setChip] = useState<'offered' | 'current' | 'upcoming' | 'history'>('offered');
  const [sheetOpen, setSheetOpen] = useState(false);
  const toast = useToast();
  const noop = () => undefined; // gallery previews are non-interactive
  const demoLoad = SAMPLE_UPCOMING[0];

  if (!__DEV__) return <Redirect href="/home" />;

  return (
    <Screen padTop={false} flow="sections">
      <ScreenHeader
        title="Design system"
        subtitle="Operational components · adaptive appearance"
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

      {/* Direction B B0.4 done-when: every variant, so a missing Lexend weight is visible rather
          than silently falling back to the platform face. `label` and `numericInline` are the two
          new roles; `numericInline` is the one the 2026-09-07 critique said was missing. */}
      <Section title="Typography — Lexend 400/500/600/700">
        <View className="gap-1 rounded-xl bg-surface-muted p-4">
          <AppText variant="screenTitle">Today</AppText>
          <AppText variant="navigationTitle">Load LD-20481</AppText>
          <AppText variant="label" tone="action">NEXT · DELIVER</AppText>
          <AppText variant="body">One typeface carries the whole app; the variant picks the weight.</AppText>
          <AppText variant="rowTitle">Row title, Lexend Medium</AppText>
          <AppText variant="action">Button label, Lexend SemiBold</AppText>
          <AppText variant="supporting" tone="muted">Supporting information remains readable without competing.</AppText>
          <AppText variant="caption" tone="muted">Caption · 12pt</AppText>
          <AppText variant="numericInline">08:30 – 11:00</AppText>
          <AppText variant="numericCompact">87</AppText>
          <AppText variant="numericHero">438,795</AppText>
        </View>
      </Section>

      <Section title="Icons — HugeIcons · semantic FuelGuard adapter">
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
            <Button label="Syncing…" loading variant="secondary" />
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

      <Section title="Task flow — progress, steps, and next action">
        <TaskStepper
          steps={[
            { label: 'Assigned', state: 'complete' },
            { label: 'In transit', state: 'current' },
            { label: 'Complete', state: 'upcoming' },
          ]}
        />
        <Progress label="Stop progress" detail="2 of 4 stops" value={0.5} />
        <ActionBar>
          <Button label="Work next stop" icon="photo_camera" size="lg" variant="primary" onPress={noop} />
          <AppText variant="caption" tone="muted" className="text-center">Saved locally, syncs automatically.</AppText>
        </ActionBar>
      </Section>

      <Section title="Compact performance summary">
        <View className="gap-3 rounded-2xl border border-edge bg-surface p-4">
          <View className="flex-row items-end justify-between gap-4">
            <View>
              <AppText variant="caption" tone="muted">Weekly score</AppText>
              <AppText variant="numericHero" tabular>87</AppText>
            </View>
            <AppText variant="supporting" tone="success">+3 vs last week</AppText>
          </View>
          <Progress value={0.87} />
        </View>
        <GroupedList>
          <View className="min-h-[60px] flex-row items-center gap-3 bg-surface px-4 py-3">
            <View className="flex-1">
              <AppText variant="rowTitle">Fuel efficiency</AppText>
              <AppText variant="caption" tone="success">Improved this week</AppText>
            </View>
            <View className="w-20"><Sparkline data={[82, 84, 83, 85, 86, 86, 87]} height={18} /></View>
            <AppText variant="numericCompact" tabular>87</AppText>
          </View>
          <View className="min-h-[60px] flex-row items-center gap-3 bg-surface px-4 py-3">
            <View className="flex-1">
              <AppText variant="rowTitle">Idling</AppText>
              <AppText variant="caption" tone="warning">Down 2 points</AppText>
            </View>
            <View className="w-20"><Sparkline data={[83, 82, 81, 80, 80, 79, 79]} height={18} /></View>
            <AppText variant="numericCompact" tabular>79</AppText>
          </View>
        </GroupedList>
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

      <Section title="Chips — every tone, on both grounds">
        <View className="flex-row flex-wrap gap-2">
          {CHIP_TONES.map((tone) => (
            <Badge key={tone} label={tone} tone={tone} />
          ))}
        </View>
        <View className="flex-row flex-wrap gap-2 rounded-xl bg-hero p-4">
          <Badge label="In transit" tone="action" icon="local_shipping" />
          <Badge label="Offered" tone="ghost" />
          <Badge label="Delivered" tone="success" icon="check_circle" />
          <Badge label="Critical" tone={severityTone('critical')} />
        </View>
        <AppText variant="caption" tone="muted">
          A chip carries no `self-start`: it centres in whatever row holds it. Both rows below show a
          chip beside two lines of text — the alignment defect the 2026-09-07 critique found on five
          screens was exactly this.
        </AppText>
        <GroupedList>
          <ListRow
            title="Stop 2 — Effingham, IL"
            subtitle="Deliver by 14:30"
            icon="pin_drop"
            disc="action"
            right={<Badge label="Next" tone="action" />}
          />
          <ListRow
            title="Stop 1 — Joliet, IL"
            subtitle="Delivered 09:12 · 4 photos"
            icon="check_circle"
            disc="success"
            right={<Badge label="Done" tone="success" />}
          />
        </GroupedList>
      </Section>

      <Section title="Hero and sheet — the two registers">
        <View className="gap-3 rounded-xl bg-hero p-4">
          <Card variant="hero">
            <AppText variant="label" tone="onHeroSecondary">NEXT · DELIVER</AppText>
            <AppText variant="screenTitle" tone="onHero">Effingham, IL</AppText>
            <AppText variant="supporting" tone="onHeroSecondary">1204 W Fayette Ave · Stop 2 of 4</AppText>
            <View className="flex-row gap-3 pt-1">
              <View className="flex-1 gap-1 rounded-lg bg-hero-tile p-3">
                <AppText variant="caption" tone="onHeroMuted">Appointment</AppText>
                <AppText variant="numericInline" tone="onHero">14:30</AppText>
              </View>
              <View className="flex-1 gap-1 rounded-lg bg-hero-tile p-3">
                <AppText variant="caption" tone="onHeroMuted">Required here</AppText>
                <AppText variant="numericInline" tone="onHero">3</AppText>
              </View>
            </View>
            <Button label="Deliver at Effingham" variant="hero" size="lg" onPress={noop} />
            <Button label="Choose a different stop" variant="ghost" onHero onPress={noop} />
          </Card>
          <SegmentedControl
            variant="chips"
            onHero
            value={chip}
            onChange={setChip}
            options={[
              { label: 'Offered', value: 'offered', count: 2 },
              { label: 'Current', value: 'current' },
              { label: 'Upcoming', value: 'upcoming', count: 4 },
              { label: 'History', value: 'history' },
            ]}
          />
        </View>
        <Card>
          <AppText variant="rowTitle">Sheet card</AppText>
          <AppText variant="supporting" tone="muted">
            White, 24pt, one soft shadow tinted with the hero navy — the app's only shadow.
          </AppText>
          <Button label="Primary on the sheet" variant="primary" onPress={noop} />
        </Card>
        <Card variant="flat">
          <AppText variant="rowTitle">Flat card</AppText>
          <AppText variant="supporting" tone="muted">
            No shadow and no edge: a container for rows inside an already-contained region.
          </AppText>
        </Card>
      </Section>

      {/* B2 done-when: the four Today states, side by side, because the only other way to see
          `recovery` is to break the network mid-session on a device. The rows come from the same
          `attentionRows` the screen calls — a fixture here, real queries there. */}
      <Section title="Today — the four states">
        {TODAY_STATES.map(({ state, note, rows }) => (
          <View key={state} className="gap-2">
            <View className="flex-row items-center gap-2">
              <Badge label={state} tone={state === 'recovery' ? 'danger' : 'neutral'} />
              <AppText variant="caption" tone="muted" className="flex-1">{note}</AppText>
            </View>
            {rows.length > 0 ? <AttentionQueue rows={rows} /> : (
              <Card variant="flat">
                <AppText variant="supporting" tone="muted">No attention rows — the section is not rendered.</AppText>
              </Card>
            )}
          </View>
        ))}
      </Section>

      <Section title="Toast host" action={{ label: 'Show one', onPress: () => toast.show('Stop 2 completed · 4 photos queued') }}>
        <AppText variant="supporting" tone="muted">
          A toast is raised through `useToast().show(…)` and lives in the root layout, so it outlives
          the screen that raised it — a completion receipt survives the `router.back()` that follows.
        </AppText>
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
        <GroupedList>
          <ListRow
            title="Unit 4471 — Freightliner Cascadia"
            subtitle="Odometer 438,795 · Diesel"
            icon="local_shipping"
            onPress={noop}
          />
          <ListRow
            title="Safety support"
            subtitle="Call or message your safety team"
            icon="health_and_safety"
            onPress={noop}
          />
        </GroupedList>
      </Section>

      <Section title="Card + Avatar">
        <Card>
          <View className="flex-row items-center gap-3">
            <Avatar name="Miki Jokovic" size={44} />
            <View className="gap-0.5">
              <AppText variant="rowTitle">Miki Jokovic</AppText>
              <AppText variant="supporting" tone="muted">Driver · Silvicom Inc.</AppText>
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

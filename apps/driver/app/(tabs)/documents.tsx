import { useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import {
  ActionBar,
  AppText,
  Banner,
  Button,
  EmptyState,
  GroupedList,
  ListRow,
  OfflineBanner,
  Screen,
  ScreenHeader,
  Section,
  Skeleton,
  SkeletonRows,
  StatusBlock,
} from '@/components';
import { useHazmatChecks } from '@/features/hazmat/useHazmatChecks';
import { useLoads } from '@/features/loads/useLoads';
import { documentsView, hazmatRows } from '@/features/documents/documentsModel';
import { HazmatRows, MissingPhotoRows } from '@/features/documents/DocumentRows';
import { useFeatures } from '@/session/useFeatures';

/**
 * Documents — the driver's document tab (D-DB14, 2026-09-07), which is the hazmat hub of the
 * hardening plan's Phase 3 promoted from a modal two taps inside More to a top-level surface.
 *
 * It is the scanner programme's front door: a capture creates the driver's OWN hazmat load via
 * /api/me/hazmat/* and never touches dispatch loads. Primary action: capture a BOL. Below it: every
 * past check, re-findable — the verdict screen used to be unreachable the moment the driver left
 * it. When the Loads module embeds capture as a load-flow step (plan Phase 6), this tab remains
 * the place every document lives.
 *
 * Visual 2026 V7 (the V1 mock's screen 7) makes it a review queue: the status block counts what is
 * still missing, the missing stop photos come first ("Take" opens the stop), then the hazmat
 * verdicts as words in their colours, then what the office already received. The photos are read
 * from the loads payload Today and Loads already hold, so this route composes two features; neither
 * feature reaches into the other (`lint:boundaries`). The words are `documentsModel`.
 */

export default function HazmatHub() {
  const router = useRouter();
  const features = useFeatures();
  const hazmatEnabled = features.enabled('hazmat.capture');
  const loadsEnabled = features.enabled('tab.loads');
  const checks = useHazmatChecks(hazmatEnabled);
  const loads = useLoads(loadsEnabled);
  const [refreshing, setRefreshing] = useState(false);

  // Deep-link guard: the tab is hidden when the feature is off; this covers a direct navigation.
  // Only redirect once the bootstrap has LOADED — a cold start must not bounce an entitled driver
  // off the hub while the cache rehydrates (server RLS is the real boundary).
  if (features.isLoaded && !hazmatEnabled) return <Redirect href="/home" />;
  if (!features.isLoaded) {
    return (
      <Screen flow="sections">
        <ScreenHeader title="Documents" />
        <Skeleton className="h-15 w-full rounded-xl" />
      </Screen>
    );
  }

  const view = documentsView(loadsEnabled ? (loads.data?.loads ?? []) : []);
  const records = hazmatRows(checks.data?.loads ?? []);
  const showSkeletons = checks.isPending && !checks.data;
  const nothingAtAll = !showSkeletons && records.length === 0 && view.missing.length === 0 && !view.sentThisWeek;

  return (
    <Screen
      flow="sections"
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void Promise.allSettled([checks.refetch(), loads.refetch()]).finally(() => setRefreshing(false));
      }}
      footer={
        <ActionBar>
          {/* One amber action per screen (D-DV5): while photos are owed, "Take" is the act and the
              BOL capture steps down to the outline button. */}
          <Button
            label="Capture BOL"
            variant={view.actionable > 0 ? 'secondary' : 'primary'}
            size="lg"
            icon="photo_camera"
            haptic="select"
            onPress={() => router.push('/hazmat/capture')}
          />
          <AppText variant="caption" tone="subtle" className="pb-1 text-center">
            Works offline. Captures sync and are checked when you reconnect.
          </AppText>
        </ActionBar>
      }
    >
      <ScreenHeader title="Documents" />
      <OfflineBanner />

      {checks.isError && !checks.data ? (
        <Section>
          <Banner
            tone="danger"
            message={checks.error.message || 'Could not load your hazmat checks.'}
            actionLabel="Retry"
            onAction={() => void checks.refetch()}
          />
        </Section>
      ) : null}

      {loadsEnabled && loads.data ? (
        <Section>
          {view.actionable > 0 ? (
            <StatusBlock
              context="To finish"
              figure={String(view.actionable)}
              figureSuffix={view.actionable === 1 ? 'photo missing' : 'photos missing'}
            >
              {/* Under the count, as the mock draws it; `place` would set it above the figure. */}
              {view.missingNote ? <AppText variant="supporting" tone="onHeroSecondary">{view.missingNote}</AppText> : null}
            </StatusBlock>
          ) : (
            <StatusBlock context="To finish" subject="Nothing to send" place="Every photo your stops need is with the office." />
          )}
          {view.missing.length > 0 ? (
            <MissingPhotoRows
              rows={view.missing}
              onTake={(row) => router.push(`/loads/${row.loadId}/stop/${row.stopId}` as never)}
            />
          ) : null}
        </Section>
      ) : null}

      <Section title="Hazmat checks">
        {showSkeletons ? (
          <SkeletonRows count={1} />
        ) : records.length > 0 ? (
          <HazmatRows rows={records} onOpen={(id) => router.push(`/hazmat/${id}` as never)} />
        ) : (
          <AppText variant="supporting" tone="secondary">
            None yet. Capture a bill of lading and its compliance check, with the CFR citations, lands here.
          </AppText>
        )}
      </Section>

      {view.sentThisWeek ? (
        <Section title="Sent this week">
          <GroupedList>
            <ListRow
              icon="check_circle"
              disc="success"
              title={`${view.sentThisWeek.photos} ${view.sentThisWeek.photos === 1 ? 'photo' : 'photos'} · ${view.sentThisWeek.loads} ${view.sentThisWeek.loads === 1 ? 'load' : 'loads'}`}
              subtitle="All received by the office"
            />
          </GroupedList>
        </Section>
      ) : null}

      {nothingAtAll ? (
        <Section>
          <EmptyState icon="photo_camera" title="No documents yet" subtitle="Stop photos and BOL checks you send appear here." />
        </Section>
      ) : null}
    </Screen>
  );
}

import { Redirect, useRouter } from 'expo-router';
import type { MeHazmatLoadRow } from '@silvicom/shared';
import {
  ActionBar,
  AppText,
  Badge,
  Banner,
  Button,
  EmptyState,
  GroupedList,
  ListRow,
  OfflineBanner,
  Screen,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  type Tone,
} from '@/components';
import { useHazmatChecks } from '@/features/hazmat/useHazmatChecks';
import { useFeatures } from '@/session/useFeatures';

/**
 * Hazmat hub (hardening plan Phase 3) — the standalone testing surface, decoupled from the Loads
 * module: a capture creates the driver's OWN hazmat load via /api/me/hazmat/* and never touches
 * dispatch loads. Primary action: capture a BOL. Below it: every past check, re-findable — the
 * verdict screen used to be unreachable the moment the driver left it. When the Loads module ships,
 * the same vertical embeds as a load-flow step (plan Phase 6/D51); this hub remains the fallback.
 */

const OUTCOME_BADGE: Record<string, { label: string; tone: Tone }> = {
  cleared: { label: 'Cleared', tone: 'success' },
  analysis_green: { label: 'Cleared', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  needs_review: { label: 'In review', tone: 'warning' },
};

function rowBadge(row: MeHazmatLoadRow): { label: string; tone: Tone } {
  if (row.latest_outcome && OUTCOME_BADGE[row.latest_outcome]) return OUTCOME_BADGE[row.latest_outcome]!;
  if (row.latest_outcome) return { label: 'In review', tone: 'warning' };
  // No run yet: either still draft on this device (outbox not drained) or analyzing server-side.
  return row.status === 'draft' ? { label: 'Not submitted', tone: 'neutral' } : { label: 'Analyzing', tone: 'info' };
}

function rowDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function HazmatHub() {
  const router = useRouter();
  const features = useFeatures();
  const hazmatEnabled = features.enabled('hazmat.capture');
  const checks = useHazmatChecks(hazmatEnabled);

  // Deep-link guard: the More entry already hides when the feature is off; this covers a direct
  // navigation. Only redirect once the bootstrap has LOADED — a cold start must not bounce an
  // entitled driver off the hub while the cache rehydrates (server RLS is the real boundary).
  if (features.isLoaded && !hazmatEnabled) return <Redirect href="/home" />;
  if (!features.isLoaded) {
    return (
      <Screen padTop={false}>
        <ScreenHeader title="Hazmat checks" onClose={() => router.back()} />
        <Skeleton className="h-[60px] w-full rounded-xl" />
      </Screen>
    );
  }
  const rows = checks.data?.loads ?? [];
  const showSkeletons = checks.isPending && !checks.data;

  return (
    <Screen
      padTop={false}
      footer={
        <ActionBar>
          <Button
            label="Capture BOL"
            size="lg"
            icon="photo_camera"
            haptic="select"
            onPress={() => router.push('/hazmat/capture')}
          />
          <AppText variant="caption" tone="subtle" className="pb-1 text-center">
            Works offline — captures sync and analyze when you reconnect.
          </AppText>
        </ActionBar>
      }
    >
      <ScreenHeader
        title="Hazmat checks"
        subtitle="BOL compliance, before you roll"
        onClose={() => router.back()}
      />
      <OfflineBanner />

      {checks.isError && !checks.data ? (
        <Banner
          tone="danger"
          message={checks.error.message || 'Could not load your hazmat checks.'}
          actionLabel="Retry"
          onAction={() => void checks.refetch()}
        />
      ) : null}

      <SectionLabel>History</SectionLabel>
      {showSkeletons ? (
        <>
          <Skeleton className="h-[60px] w-full rounded-xl" />
          <Skeleton className="h-[60px] w-full rounded-xl" />
        </>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="local_fire_department"
          title="No checks yet"
          subtitle="Capture a bill of lading and the compliance verdict — with its CFR citations — lands here."
        />
      ) : (
        <GroupedList>
          {rows.map((row) => {
            const badge = rowBadge(row);
            return (
              <ListRow
                key={row.id}
                icon="local_fire_department"
                title={`BOL check · ${rowDate(row.created_at)}`}
                subtitle={row.status === 'draft' ? 'Waiting to sync' : undefined}
                onPress={() => router.push(`/hazmat/${row.id}` as never)}
                right={<Badge label={badge.label} tone={badge.tone} />}
              />
            );
          })}
        </GroupedList>
      )}
    </Screen>
  );
}

import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import type { MeHazmatLoadRow } from '@fuelguard/shared';
import {
  ActionBar,
  Badge,
  Banner,
  Button,
  EmptyState,
  ListRow,
  OfflineBanner,
  Screen,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  type Tone,
} from '@/components';
import { useHazmatChecks } from '@/features/hazmat/useHazmatChecks';

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
  const checks = useHazmatChecks();
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
            onPress={() => router.push('/hazmat/capture' as never)}
          />
          <Text className="pb-1 text-center text-xs text-ink-subtle">
            Works offline — captures sync and analyze when you reconnect.
          </Text>
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
        rows.map((row) => {
          const badge = rowBadge(row);
          return (
            <ListRow
              key={row.id}
              icon="local_fire_department"
              title={`BOL check — ${rowDate(row.created_at)}`}
              subtitle={row.status === 'draft' ? 'Waiting to sync' : undefined}
              onPress={() => router.push(`/hazmat/${row.id}` as never)}
              right={<Badge label={badge.label} tone={badge.tone} />}
            />
          );
        })
      )}
    </Screen>
  );
}

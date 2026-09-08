import { useMemo } from 'react';
import { View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  AppText,
  Banner,
  Card,
  EmptyState,
  Icon,
  OfflineBanner,
  Screen,
  ScreenHeader,
  Section,
  Skeleton,
  TEXT_TONE_CLASS,
  TONE_SOFT,
  type Tone,
} from '@/components';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';
import { apiFetch } from '@/lib/api';
import { useFeatures } from '@/session/useFeatures';

interface Citation { cfr: string; interpretation?: string }
interface Finding { ruleId: string; tier: string; message: string; citations: Citation[] }
interface RunView { outcome: string; findings: Finding[]; flags: string[] }

function parseRuns(rows: readonly unknown[]): RunView | null {
  const latest = rows[0] as Record<string, unknown> | undefined;
  if (!latest) return null;
  const verdict = (latest.verdict ?? {}) as Record<string, unknown>;
  const eligibility = (verdict.eligibility ?? {}) as Record<string, unknown>;
  const blocks = Array.isArray(eligibility.blocks) ? (eligibility.blocks as Finding[]) : [];
  const segregation = Array.isArray(verdict.segregation) ? (verdict.segregation as Finding[]) : [];
  const flags = Array.isArray(latest.flags) ? (latest.flags as string[]) : [];
  const outcome = typeof latest.outcome === 'string' ? latest.outcome : 'pending';
  return { outcome, findings: [...blocks, ...segregation], flags };
}

const OUTCOME: Record<string, { tone: Tone; word: string; icon: MaterialSymbolName; message: string }> = {
  cleared: { tone: 'success', word: 'Cleared', icon: 'check_circle', message: 'This load passed the compliance check.' },
  analysis_green: { tone: 'success', word: 'Cleared', icon: 'check_circle', message: 'This load passed the compliance check.' },
  rejected: { tone: 'danger', word: 'Rejected', icon: 'error', message: 'Review the findings before moving this load.' },
  needs_review: { tone: 'warning', word: 'In review', icon: 'hourglass_empty', message: 'A compliance reviewer is finalizing this check.' },
  pending: { tone: 'info', word: 'Analyzing', icon: 'hourglass_empty', message: 'Analyzing your BOL · this page updates automatically.' },
};
const PENDING = OUTCOME.pending!;
const TERMINAL = new Set(['cleared', 'analysis_green', 'rejected']);

export default function HazmatVerdictScreen() {
  const { loadId } = useLocalSearchParams<{ loadId: string }>();
  const router = useRouter();
  const features = useFeatures();
  const hazmatEnabled = features.enabled('hazmat.capture');
  const query = useQuery({
    queryKey: ['me', 'hazmat', loadId, 'runs'],
    enabled: hazmatEnabled && Boolean(loadId),
    queryFn: async ({ signal }): Promise<unknown[]> => {
      const response = await apiFetch<{ rows: unknown[] }>(`/api/me/hazmat/loads/${loadId}/runs`, { signal });
      if (!response.ok || !response.data) throw new Error(response.error?.message ?? 'Could not load the verdict');
      return response.data.rows;
    },
    refetchInterval: (state): number | false => {
      const view = parseRuns(state.state.data ?? []);
      return view && TERMINAL.has(view.outcome) ? false : 3000;
    },
  });

  const view = useMemo(() => (query.data ? parseRuns(query.data) : null), [query.data]);
  const meta = OUTCOME[view?.outcome ?? 'pending'] ?? PENDING;

  if (features.isLoaded && !hazmatEnabled) return <Redirect href="/home" />;
  if (!features.isLoaded) {
    return (
      <Screen padTop={false} flow="sections">
        <ScreenHeader title="Compliance verdict" onBack={() => router.back()} />
        <Skeleton className="h-28 w-full rounded-xl" />
      </Screen>
    );
  }

  return (
    <Screen padTop={false} flow="sections">
      <ScreenHeader title="Compliance verdict" onBack={() => router.back()} />
      <OfflineBanner />
      {query.isError && !query.data ? (
        <Banner
          tone="danger"
          message={query.error.message || 'Could not load the compliance verdict.'}
          actionLabel="Retry"
          onAction={() => void query.refetch()}
        />
      ) : query.isLoading ? (
        <Skeleton className="h-28 w-full rounded-xl" />
      ) : !view ? (
        <EmptyState title="Analyzing" subtitle="The compliance check updates automatically after your BOL syncs." />
      ) : (
        <>
          {/* The verdict is the screen: a driver opening this wants one word before any detail,
              and a thin status strip made "Rejected" the same weight as "2 pending". */}
          <Section first>
            <Card variant="flat">
              <View className={`h-11 w-11 items-center justify-center rounded-full ${TONE_SOFT[meta.tone].bg}`}>
                <Icon name={meta.icon} size={22} fill className={TEXT_TONE_CLASS[TONE_SOFT[meta.tone].textTone]} />
              </View>
              <AppText variant="navigationTitle">{meta.word}</AppText>
              <AppText variant="supporting" tone="secondary">{meta.message}</AppText>
            </Card>
          </Section>
          {view.findings.length > 0 ? (
            <Section title="Findings">
              <Card variant="flat" padded={false}>
                {view.findings.map((finding, index) => (
                  <View key={`${finding.ruleId}-${index}`} className="flex-row items-start gap-3 px-4 py-3">
                    <Icon name="warning" size={18} className="mt-0.5 text-warning" />
                    <View className="flex-1 gap-1">
                      <AppText variant="body">{finding.message}</AppText>
                      {finding.citations.length > 0 ? (
                        <AppText variant="caption" tone="muted">{finding.citations.map((citation) => citation.cfr).join(' · ')}</AppText>
                      ) : null}
                    </View>
                  </View>
                ))}
              </Card>
            </Section>
          ) : null}
          {view.findings.length === 0 && view.flags.length > 0 ? (
            <Section title="Review flags">
              <Card variant="flat" padded={false}>
                {view.flags.map((flag, index) => (
                  <View key={`${flag}-${index}`} className="flex-row items-start gap-3 px-4 py-3">
                    <Icon name="info" size={18} className="mt-0.5 text-info" />
                    <AppText variant="body" className="flex-1">{flag}</AppText>
                  </View>
                ))}
              </Card>
            </Section>
          ) : null}
        </>
      )}
    </Screen>
  );
}

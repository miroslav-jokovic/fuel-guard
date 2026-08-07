import { useMemo } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  AppText,
  Banner,
  EmptyState,
  GroupedList,
  Icon,
  Screen,
  ScreenHeader,
  SectionLabel,
  Skeleton,
  type Tone,
} from '@/components';
import { apiFetch } from '@/lib/api';

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

const OUTCOME: Record<string, { tone: Tone; message: string }> = {
  cleared: { tone: 'success', message: 'Cleared · this load passed the compliance check.' },
  analysis_green: { tone: 'success', message: 'Cleared · this load passed the compliance check.' },
  rejected: { tone: 'danger', message: 'Rejected · review the findings before moving this load.' },
  needs_review: { tone: 'warning', message: 'In review · a compliance reviewer is finalizing this check.' },
  pending: { tone: 'info', message: 'Analyzing your BOL · this page updates automatically.' },
};
const PENDING: { tone: Tone; message: string } = { tone: 'info', message: 'Analyzing your BOL · this page updates automatically.' };
const TERMINAL = new Set(['cleared', 'analysis_green', 'rejected']);

export default function HazmatVerdictScreen() {
  const { loadId } = useLocalSearchParams<{ loadId: string }>();
  const router = useRouter();
  const query = useQuery({
    queryKey: ['me', 'hazmat', loadId, 'runs'],
    enabled: Boolean(loadId),
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

  return (
    <Screen padTop={false}>
      <ScreenHeader title="Compliance verdict" onBack={() => router.back()} />
      {query.isLoading ? (
        <Skeleton className="h-28 w-full rounded-xl" />
      ) : !view ? (
        <EmptyState title="Analyzing" subtitle="The compliance check updates automatically after your BOL syncs." />
      ) : (
        <>
          <Banner tone={meta.tone} message={meta.message} />
          {view.findings.length > 0 ? (
            <>
              <SectionLabel>Findings</SectionLabel>
              <GroupedList>
                {view.findings.map((finding, index) => (
                  <View key={`${finding.ruleId}-${index}`} className="flex-row items-start gap-3 bg-surface px-4 py-3">
                    <Icon name="warning" size={18} className="mt-0.5 text-warning" />
                    <View className="flex-1 gap-1">
                      <AppText variant="body">{finding.message}</AppText>
                      {finding.citations.length > 0 ? (
                        <AppText variant="caption" tone="muted">{finding.citations.map((citation) => citation.cfr).join(' · ')}</AppText>
                      ) : null}
                    </View>
                  </View>
                ))}
              </GroupedList>
            </>
          ) : null}
          {view.findings.length === 0 && view.flags.length > 0 ? (
            <>
              <SectionLabel>Review flags</SectionLabel>
              <GroupedList>
                {view.flags.map((flag, index) => (
                  <View key={`${flag}-${index}`} className="flex-row items-start gap-3 bg-surface px-4 py-3">
                    <Icon name="info" size={18} className="mt-0.5 text-info" />
                    <AppText variant="body" className="flex-1">{flag}</AppText>
                  </View>
                ))}
              </GroupedList>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

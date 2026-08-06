import { useMemo } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Banner, Card, EmptyState, Screen, ScreenHeader, SectionLabel, Skeleton, type Tone } from "@/components";
import { apiFetch } from "@/lib/api";

/**
 * M6.3 verdict view. Polls the driver's own runs until a terminal outcome, then shows cleared/rejected/
 * in-review with the findings + their CFR citations. A reviewer still finalizes clearing (drivers never
 * clear or attest — PLAN line 381).
 */

interface Citation {
  cfr: string;
  interpretation?: string;
}
interface Finding {
  ruleId: string;
  tier: string;
  message: string;
  citations: Citation[];
}
interface RunView {
  outcome: string;
  findings: Finding[];
  flags: string[];
}

function parseRuns(rows: readonly unknown[]): RunView | null {
  const latest = rows[0] as Record<string, unknown> | undefined;
  if (!latest) return null;
  const verdict = (latest.verdict ?? {}) as Record<string, unknown>;
  const eligibility = (verdict.eligibility ?? {}) as Record<string, unknown>;
  const blocks = Array.isArray(eligibility.blocks) ? (eligibility.blocks as Finding[]) : [];
  const seg = Array.isArray(verdict.segregation) ? (verdict.segregation as Finding[]) : [];
  const flags = Array.isArray(latest.flags) ? (latest.flags as string[]) : [];
  return { outcome: String(latest.outcome ?? "pending"), findings: [...blocks, ...seg], flags };
}

const OUTCOME: Record<string, { tone: Tone; message: string }> = {
  cleared: { tone: "success", message: "Cleared — this load passed the compliance check." },
  analysis_green: { tone: "success", message: "Cleared — this load passed the compliance check." },
  rejected: { tone: "danger", message: "Rejected — this load did not pass. See the reasons below." },
  needs_review: { tone: "warning", message: "In review — a compliance reviewer is finalizing this load." },
  pending: { tone: "info", message: "Analyzing your BOL — this updates automatically." },
};

const PENDING: { tone: Tone; message: string } = { tone: "info", message: "Analyzing your BOL — this updates automatically." };
const TERMINAL = new Set(["cleared", "analysis_green", "rejected"]);

export default function HazmatVerdictScreen() {
  const { loadId } = useLocalSearchParams<{ loadId: string }>();
  const router = useRouter();

  const query = useQuery({
    queryKey: ["me", "hazmat", loadId, "runs"],
    enabled: !!loadId,
    queryFn: async ({ signal }): Promise<unknown[]> => {
      const res = await apiFetch<{ rows: unknown[] }>(`/api/me/hazmat/loads/${loadId}/runs`, { signal });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the verdict");
      return res.data.rows;
    },
    refetchInterval: (q): number | false => {
      const rows = (q.state.data as unknown[] | undefined) ?? [];
      const view = parseRuns(rows);
      return view && TERMINAL.has(view.outcome) ? false : 3000;
    },
  });

  const view = useMemo(() => (query.data ? parseRuns(query.data) : null), [query.data]);
  const meta = OUTCOME[view?.outcome ?? "pending"] ?? PENDING;

  return (
    <Screen>
      <ScreenHeader title="Compliance verdict" onBack={() => router.back()} />
      <View style={{ gap: 16 }}>
        {query.isLoading ? (
          <Skeleton />
        ) : !view ? (
          <EmptyState title="Analyzing…" subtitle="We're running the compliance check on your BOL. This updates automatically." />
        ) : (
          <>
            <Banner tone={meta.tone} message={meta.message} />
            {view.findings.length > 0 ? (
              <Card>
                <SectionLabel>Findings</SectionLabel>
                {view.findings.map((f, i) => (
                  <View key={`${f.ruleId}-${i}`} style={{ paddingVertical: 8, gap: 4 }}>
                    <Text>{f.message}</Text>
                    {f.citations && f.citations.length > 0 ? (
                      <Text>{f.citations.map((c) => c.cfr).join(" · ")}</Text>
                    ) : null}
                  </View>
                ))}
              </Card>
            ) : null}
            {view.findings.length === 0 && view.flags.length > 0 ? (
              <Card>
                <SectionLabel>Flags</SectionLabel>
                {view.flags.map((fl, i) => (
                  <Text key={`${fl}-${i}`}>{fl}</Text>
                ))}
              </Card>
            ) : null}
          </>
        )}
      </View>
    </Screen>
  );
}

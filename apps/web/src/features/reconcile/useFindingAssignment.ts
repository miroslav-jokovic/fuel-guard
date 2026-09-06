import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { AppSection, FindingRow } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * Who can take a finding, and giving it to them (C7b merge 3, Q-FUI15).
 *
 * The candidate list is NOT a member directory. It answers one question — who could be assigned a
 * finding in this section — and the answer is the same set that may close one, which is the whole
 * design: offering somebody who could not then close it is a menu whose only product is a stuck
 * finding. A driver holds `none` on every section and so appears in no list, without anybody writing
 * "except drivers" anywhere.
 */

export interface Assignee {
  id: string;
  /** Null when the person has never set a profile name. The caller labels it; no email is carried. */
  name: string | null;
  role: string;
}

export function useAssigneesQuery(section: Ref<AppSection | null>) {
  return useQuery({
    queryKey: ["finding-assignees", section],
    enabled: computed(() => section.value != null),
    staleTime: 300_000,
    queryFn: async (): Promise<Assignee[]> => {
      const res = await apiFetch<{ ok: boolean; assignees: Assignee[] }>(
        `/api/fueling/exceptions/assignees?section=${section.value}`,
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the people who can take this");
      return res.data.assignees ?? [];
    },
  });
}

/** What the picker shows for somebody. A name if they set one, otherwise their role — never an id. */
export const assigneeLabel = (a: Assignee): string =>
  a.name?.trim() || `Unnamed ${a.role.replace(/_/g, " ")}`;

/**
 * The sections a selection spans — which decides both which candidate list to offer and whether one
 * person can take the whole thing. A mixed selection needs somebody who can close BOTH, and the API
 * enforces that; asking for one section's list here would offer names the API then refuses.
 */
export const sectionsOf = (rows: readonly FindingRow[]): AppSection[] =>
  [...new Set(rows.map((r) => r.section))];

export function useAssignFindings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { assignee: string | null; findings: { source: string; id: string }[] }) => {
      const res = await apiFetch<{ ok: boolean; assigned: number }>("/api/fueling/findings/assign", {
        method: "POST",
        body: v,
      });
      if (!res.ok) throw new Error(res.error?.message ?? "Could not assign those findings");
      return res.data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["findings"] }),
  });
}

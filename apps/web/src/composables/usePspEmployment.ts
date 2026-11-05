import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { PspEmploymentSuggestions } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { useSessionStore } from "@/stores/session";

/**
 * HW6b — what the driver's PSP record suggests about the job list on screen
 * (`GET /api/recruitment/drivers/:id/psp-employment`, HIRING-WORKFLOW-AUDIT-2026-10-31 §4.6).
 *
 * In `composables/` because both timelines ask it — the filed record (`features/recruitment`) and the
 * application's draft (`features/apply`, `?invitationId=`) — and a feature may not import another's.
 *
 * ── ASKED ONLY BY THE PSP REPORT'S READERS ────────────────────────────────────────────────────
 * The same two questions the route's guards ask: view Recruitment (the org's answer) AND read a
 * `psp_report` (the §391.53(a)(1) test, D-PERM9). Anyone else never sends the request, so a refusal
 * is never drawn as an error on a screen that has nothing to show them.
 *
 * ── WHY `version` IS IN THE KEY ───────────────────────────────────────────────────────────────
 * The answer depends on the list: add the carrier PSP named and it is no longer "not on their list".
 * The caller passes something that changes when its list does — the draft's revision, the record
 * query's update time — so the suggestions follow every save without each save having to know they
 * exist.
 */
export function usePspEmploymentQuery(
  driverId: Ref<string | null | undefined>,
  opts: { invitationId?: Ref<string | null | undefined>; version: Ref<string | number> },
) {
  const session = useSessionStore();
  const allowed = computed(() => session.canView("recruitment") && session.canReadKind("psp_report"));
  const invitationId = computed(() => opts.invitationId?.value ?? null);
  return useQuery({
    queryKey: computed(() => ["psp-employment", driverId.value ?? "", invitationId.value, opts.version.value] as const),
    enabled: computed(() => allowed.value && Boolean(driverId.value)),
    queryFn: async (): Promise<PspEmploymentSuggestions> => {
      const query = invitationId.value ? `?invitationId=${encodeURIComponent(invitationId.value)}` : "";
      const res = await apiFetch<PspEmploymentSuggestions>(
        `/api/recruitment/drivers/${encodeURIComponent(driverId.value ?? "")}/psp-employment${query}`,
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not read the PSP record.");
      return res.data;
    },
    // ⚠ No `placeholderData` keeping the last answer through a re-read, though it would stop the block
    // blinking on each save: query-core reuses a placeholder without calling the function again when
    // its reference is unchanged (`queryObserver` — "prevResult.isPlaceholderData && same
    // placeholderData"), so a guard that checks the previous key runs once and then not at all, and
    // one applicant's PSP carriers stayed on screen over the next one's jobs. Measured by
    // "never shows one applicant's PSP carriers over another's", which failed with it.
  });
}

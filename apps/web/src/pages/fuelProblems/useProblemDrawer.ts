import { computed } from "vue";
import type { FindingSource } from "@silvicom/shared";
import { useQueryState } from "@/composables/useQueryState";

/**
 * Which drawer is open on Fuel problems, held in the URL (F02-F04 chunk 8c4).
 *
 * 8c3 gave every row its own drawer on the page, held in three local refs, so an open item could not be
 * sent: the person told "look at this card-fraud case" got the queue and had to find the row. Now the
 * open item is a parameter, one per kind because each kind is read from its own table — `?finding=` a
 * money finding, `?case=` a fill case, `?incident=` a card-fraud incident — and a link carrying one opens
 * that drawer, on refresh and through the `/findings` redirect alike.
 *
 * Opening one clears the other two in the same patch, so the URL can never name two open drawers.
 */
const PARAM: Record<FindingSource, string> = { exception: "finding", anomaly: "case", incident: "incident" };
const NONE = { finding: undefined, case: undefined, incident: undefined };

export function useProblemDrawer() {
  const { one, set } = useQueryState();
  return {
    findingId: computed(() => one(PARAM.exception) ?? null),
    caseId: computed(() => one(PARAM.anomaly) ?? null),
    incidentId: computed(() => one(PARAM.incident) ?? null),
    open: (source: FindingSource, id: string): void => set({ ...NONE, [PARAM[source]]: id }),
    close: (): void => set(NONE),
  };
}

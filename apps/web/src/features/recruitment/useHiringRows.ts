import { computed } from "vue";
import type { CountRow } from "@/components/ui/CountList.vue";
import { countWaitingOn, usePipelineQuery } from "./useEmployment";

/**
 * The rows of "Hiring", out of the card that draws them — why, in
 * `features/dispatch/useFleetNowRows.ts`. The Applicants board's own split, from the same pipeline
 * query and the same `countWaitingOn`.
 */
export function useHiringRows() {
  const { data: applicants } = usePipelineQuery();
  const count = (who: "us" | "them") => (applicants.value ? countWaitingOn(applicants.value, who) : null);

  const rows = computed<CountRow[]>(() => [
    { key: "us", label: "Waiting on you", value: count("us"), caption: "applications with our next step", to: "/recruitment", door: "Applicants" },
    { key: "them", label: "Waiting on them", value: count("them"), caption: "with the applicant", to: "/recruitment?waiting=them", door: "Applicants" },
  ]);
  return { applicants, rows };
}

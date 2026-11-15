import { computed } from "vue";
import type { CountRow } from "@/components/ui/CountList.vue";
import { useHazmatReviewCountQuery } from "./useHazmatReview";

/**
 * The row of "Hazmat to review", out of the card that draws it — why, in
 * `features/dispatch/useFleetNowRows.ts`. The nav badge's own count, so the card, the badge and the
 * queue it opens are one number.
 *
 * ⚠ The query is always enabled here because both readers mount this only behind the catalogue's
 * `module: "hazmatguard"` gate — an org without the module never runs it.
 */
export function useHazmatReviewRows() {
  const { data: count } = useHazmatReviewCountQuery(computed(() => true));
  const rows = computed<CountRow[]>(() => [
    { key: "needs-review", label: "Loads waiting for review", value: count.value ?? null, caption: "placards and papers to check", to: "/hazmat/review", door: "Review", alarm: true },
  ]);
  return { rows };
}

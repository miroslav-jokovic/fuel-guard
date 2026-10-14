import { ref } from "vue";
import type { ReviewBatchRequest } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { useToastStore } from "@/stores/toast";
import type { CalcLineForm } from "../calcModel";
import type { PrefillKey, PrefillLine } from "./bolPrefill";
import { reviewEntries, type FilledLine } from "./bolReview";

/**
 * The calculator's side of D-DR24: which BOL-filled fields a person acted on, and the review batch each
 * Calculate press posts (`POST /api/documents/reads/:id/reviews`, plan §6). The rules are bolReview.ts's;
 * this holds the state and does the I/O.
 *
 * A failed post does not stop the calculation — the placards are the safety answer and the review is the
 * record of it — so it says so in a toast instead. A second press on an unchanged form posts nothing: the
 * same values confirmed twice by one press pattern would count twice toward graduation.
 */
export function useBolReviews() {
  const acted = ref<Map<PrefillLine, Set<PrefillKey>>>(new Map());
  const lastPosted = new Map<string, string>();
  const toast = useToastStore();

  function act(prefill: PrefillLine, key: PrefillKey) {
    const next = new Map(acted.value);
    next.set(prefill, new Set([...(next.get(prefill) ?? []), key]));
    acted.value = next;
  }

  /** A person picked one reader's value: it goes into the form as printed, and counts as an act. */
  function choose(prefill: PrefillLine, line: CalcLineForm, key: PrefillKey, value: number) {
    if (key === "packageCount") line.packageCount = String(value);
    if (key === "grossWeight") {
      line.grossWeightValue = String(value);
      line.grossWeightUnit = "lb";
    }
    act(prefill, key);
  }

  function reset() {
    acted.value = new Map();
  }

  async function post(readId: string, result: unknown, lines: FilledLine[]) {
    const reviews = reviewEntries(result, lines, acted.value);
    if (reviews.length === 0) return;
    const key = JSON.stringify(reviews);
    if (lastPosted.get(readId) === key) return;
    const body: ReviewBatchRequest = { consumer: "hazmat_calculator", reviews };
    const res = await apiFetch(`/api/documents/reads/${readId}/reviews`, { method: "POST", body });
    if (res.ok) lastPosted.set(readId, key);
    else toast.error("Your check of the BOL was not recorded", res.error?.message ?? "The placards above are unaffected.");
  }

  return { acted, act, choose, reset, post };
}

import { shallowRef } from "vue";
import { valueAtPath, valuesAgree, type PaperAuditView, type ReviewBatchRequest, type ReviewEntry } from "@silvicom/shared";
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
 *
 * A check a person makes against the page — a confirm or a picked reading on the form, a choice under a finding —
 * is recorded as it is made (READER-CORRECTNESS-PLAN Q-RC5): the paper audit then takes it, and the answer is the
 * audit as it now stands. A Calculate press leaves out what was already recorded that way, so one act is one row.
 */
export function useBolReviews() {
  // shallowRef, never ref: the map is keyed by the read's own line objects (`prefilled` in the form). A deep
  // ref wraps the map, and copying it (`new Map(acted.value)`) re-keys every earlier entry by its reactive
  // proxy — so each act after the first lost all the earlier ones, and their "Matches the page" came back
  // (owner, 2026-10-19: "the button appears again and won't let me go further"; useBolReviews.test.ts).
  const acted = shallowRef<Map<PrefillLine, Set<PrefillKey>>>(new Map());
  const lastPosted = new Map<string, string>();
  /** Per read, each path's entry recorded as it was made: the Calculate batch skips one recorded the same. */
  const checked = new Map<string, Map<string, ReviewEntry>>();
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

  /**
   * One field a person checked against the page: `value` is what they said it prints. Recorded now; answers the
   * paper audit as it now stands, or null when the check could not be recorded (said in a toast).
   */
  async function check(readId: string, result: unknown, path: string, value: unknown): Promise<PaperAuditView | null> {
    const oldValue = (valueAtPath(result, path) ?? null) as ReviewEntry["oldValue"];
    const same = valuesAgree(oldValue, value);
    const entry: ReviewEntry = { path, action: same ? "confirmed" : "corrected", oldValue, newValue: (same ? oldValue : value) as ReviewEntry["newValue"], explicit: true };
    const body: ReviewBatchRequest = { consumer: "paper_check", reviews: [entry] };
    const res = await apiFetch<{ recorded: number; paperAudit: PaperAuditView | null }>(`/api/documents/reads/${readId}/reviews`, { method: "POST", body });
    if (!res.ok) {
      toast.error("Your check of the BOL was not recorded", res.error?.message ?? "Try again.");
      return null;
    }
    const mine = checked.get(readId) ?? new Map<string, ReviewEntry>();
    mine.set(path, entry);
    checked.set(readId, mine);
    return res.data?.paperAudit ?? null;
  }

  async function post(readId: string, result: unknown, lines: FilledLine[]) {
    const recorded = checked.get(readId);
    const reviews = reviewEntries(result, lines, acted.value).filter((r) => {
      const c = recorded?.get(r.path);
      return !(c && c.action === r.action && c.explicit === r.explicit && valuesAgree(c.newValue, r.newValue));
    });
    if (reviews.length === 0) return;
    const key = JSON.stringify(reviews);
    if (lastPosted.get(readId) === key) return;
    const body: ReviewBatchRequest = { consumer: "hazmat_calculator", reviews };
    const res = await apiFetch(`/api/documents/reads/${readId}/reviews`, { method: "POST", body });
    if (res.ok) lastPosted.set(readId, key);
    else toast.error("Your check of the BOL was not recorded", res.error?.message ?? "The placards above are unaffected.");
  }

  return { acted, act, choose, reset, post, check };
}

import { computed, ref, watch, onScopeDispose, type Ref } from "vue";
import { toDraftPayload, type ApplicationDraft } from "./draft";
import { saveApplicationDraft } from "./useApplication";

/**
 * Autosave for the applicant's form (A2).
 *
 * The market's one durable finding about these forms is that they are long, they are filled on a
 * phone at a truck stop, and the entire battle is not losing the driver mid-form. Before this, a lost
 * signal was forty minutes of typing gone and a call to the carrier for a new link.
 *
 * ── THE TWO TIMERS, AND WHY THERE ARE TWO ─────────────────────────────────────────────────────
 * A 2-second idle debounce alone is not safe here. The public application surface is rate limited to
 * 20 requests/minute (`app.ts:147`) with `/api/public`'s 60/minute stacked on top, so the budget is
 * the intersection: 20. A driver who pauses every two seconds — which is what typing an address
 * looks like — would produce up to 30 saves a minute and start getting 429s in the middle of their
 * application.
 *
 * So there is also a floor: at most one save every `MIN_INTERVAL_MS`. A change arriving inside that
 * window does not queue a second request, it moves the pending one — the payload sent is always the
 * whole current form, so coalescing loses nothing. Worst case is 12 saves a minute, which leaves
 * room for the driver's own GETs, the unlock, and the submit inside the same budget.
 *
 * ── WHAT THE DRIVER IS TOLD ───────────────────────────────────────────────────────────────────
 * "Saving…", "Saved", or "Not saved — check your signal", and nothing cleverer. A form that silently
 * fails to save is worse than one that never offered to, because the driver keeps typing into it.
 * The failed state names the likeliest cause, which on a phone at a truck stop is the signal.
 */

export type DraftSaveState = "idle" | "saving" | "saved" | "failed";

const DEBOUNCE_MS = 2_000;
const MIN_INTERVAL_MS = 5_000;

export function useApplicationDraft(
  token: Ref<string>,
  draft: ApplicationDraft,
  options: { enabled: Ref<boolean>; section?: Ref<string | null> } = { enabled: ref(true) },
) {
  const state = ref<DraftSaveState>("idle");
  const savedAt = ref<string | null>(null);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSaveStartedAt = 0;
  let inFlight = false;
  /** A change that arrived while a request was in flight — the form moved on since it was sent. */
  let dirtyWhileSaving = false;

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  async function flush(): Promise<void> {
    timer = null;
    if (!options.enabled.value || !token.value) return;
    if (inFlight) {
      dirtyWhileSaving = true;
      return;
    }
    inFlight = true;
    lastSaveStartedAt = Date.now();
    state.value = "saving";
    try {
      const res = await saveApplicationDraft(token.value, toDraftPayload(draft), options.section?.value ?? null);
      savedAt.value = res.updatedAt;
      state.value = "saved";
    } catch {
      // Deliberately not surfaced as an error the driver must act on beyond the one sentence: the
      // next keystroke schedules another attempt, and most failures here are a tunnel.
      state.value = "failed";
    } finally {
      inFlight = false;
      if (dirtyWhileSaving) {
        dirtyWhileSaving = false;
        schedule();
      }
    }
  }

  function schedule(): void {
    if (!options.enabled.value) return;
    clear();
    // The debounce, then the floor — whichever is further out.
    const sinceLast = Date.now() - lastSaveStartedAt;
    const wait = Math.max(DEBOUNCE_MS, MIN_INTERVAL_MS - sinceLast);
    timer = setTimeout(() => void flush(), wait);
  }

  // Deep, because every field the driver touches lives inside this one reactive object.
  watch(() => draft, schedule, { deep: true });

  /** Section changes save at once (subject to the floor) — leaving a section is a real checkpoint. */
  if (options.section) watch(options.section, schedule);

  onScopeDispose(clear);

  return {
    state: computed(() => state.value),
    savedAt: computed(() => savedAt.value),
    /** Save now rather than on the timer — used when the driver leaves a section. */
    flushNow: (): Promise<void> => {
      clear();
      return flush();
    },
  };
}

/** The one sentence the page shows. Fact, then what it means for them. */
export function draftStatusLabel(state: DraftSaveState): string | null {
  switch (state) {
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved. You can close this page and come back to it.";
    case "failed":
      return "Not saved — check your signal. Your answers are still on this screen.";
    default:
      return null;
  }
}

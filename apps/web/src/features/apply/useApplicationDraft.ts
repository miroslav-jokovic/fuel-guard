import { computed, ref, watch, onScopeDispose, type Ref } from "vue";
import type { LocalCopySpec } from "./deviceCopies";
import { fromDraftPayload, toDraftPayload, type ApplicationDraft } from "./draft";
import { DRAFT_COPY_VERSION, clearDraftCopy, draftExpiry, readDraftCopy, replayVerdict, writeDraftCopy } from "./draftLocal";
import { APPLY_COPY } from "./strings";
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
 *
 * ── THE REVISION, AND THE COPY ON THE PHONE (AW10, C3d1b) ─────────────────────────────────────────
 * Every save says which draft revision it was typed on (`revision`, 0376); the server refuses a stale one
 * (409 `draft_revision_conflict`) instead of letting this tab write over a newer save — another tab's, or
 * the office's correction. On that refusal this tab stops saving for good (`conflict`) and says why: its
 * copy is the older one, and the only way forward is the reload that shows the newer answers.
 *
 * And the form is written to the phone on every change (`draftLocal.ts`) and deleted once a save lands
 * with nothing typed since, so what a failed save could not send survives the tab: `replay` puts it back
 * on the next visit, only onto the revision it was typed on.
 */

export type DraftSaveState = "idle" | "saving" | "saved" | "failed" | "conflict";
/** What `replay` found on arrival: answers put back, or answers dropped because the draft moved on. */
export type DraftReplayNotice = "restored" | "dropped" | null;

const DEBOUNCE_MS = 2_000;
const MIN_INTERVAL_MS = 5_000;
const COPY_DEBOUNCE_MS = 300;

export function useApplicationDraft(
  token: Ref<string>,
  draft: ApplicationDraft,
  options: {
    enabled: Ref<boolean>;
    section?: Ref<string | null>;
    /** The revision last read or saved; null (an API from before C3d1b) sends none. The caller sets it on restore. */
    revision?: Ref<number | null>;
    /** Where the device copy lives; null keeps none. */
    local?: Ref<LocalCopySpec | null>;
  } = { enabled: ref(true) },
) {
  const state = ref<DraftSaveState>("idle");
  const savedAt = ref<string | null>(null);
  const notice = ref<DraftReplayNotice>(null);
  const revision = options.revision ?? ref<number | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Counts changes. A save may delete the phone's copy only if nothing changed after it was SENT — not
   * merely if no second save was asked for yet: a change typed while it was in flight is on the phone
   * and nowhere else until the next save, which the debounce has not fired.
   */
  let edits = 0;

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
  const clearCopyTimer = (): void => {
    if (copyTimer !== null) clearTimeout(copyTimer);
    copyTimer = null;
  };

  /** Put the form on the phone, stamped with the revision it was typed on. */
  function keepCopy(): void {
    const spec = options.local?.value;
    clearCopyTimer();
    if (!spec || state.value === "conflict") return;
    copyTimer = setTimeout(() => {
      copyTimer = null;
      const now = new Date();
      void writeDraftCopy({
        key: spec.key,
        version: DRAFT_COPY_VERSION,
        // ⚠ Through JSON: `toDraftPayload` hands back the form's own reactive arrays, and IndexedDB cannot
        // clone a Proxy — the put throws, the store resolves (as it must), and nothing is ever kept.
        payload: JSON.parse(JSON.stringify(toDraftPayload(draft))) as Record<string, unknown>,
        section: options.section?.value ?? null,
        baseRevision: revision.value,
        savedAt: now.toISOString(),
        expiresAt: draftExpiry(now, spec.linkExpiresAt),
      });
    }, COPY_DEBOUNCE_MS);
  }

  function dropCopy(): void {
    const spec = options.local?.value;
    clearCopyTimer();
    if (spec) void clearDraftCopy(spec.key);
  }

  async function flush(): Promise<void> {
    timer = null;
    if (!options.enabled.value || !token.value || state.value === "conflict") return;
    if (inFlight) {
      dirtyWhileSaving = true;
      return;
    }
    inFlight = true;
    const editsAtSend = edits;
    lastSaveStartedAt = Date.now();
    state.value = "saving";
    try {
      const res = await saveApplicationDraft(
        token.value, toDraftPayload(draft), options.section?.value ?? null, revision.value,
      );
      savedAt.value = res.updatedAt;
      if (typeof res.revision === "number") revision.value = res.revision;
      state.value = "saved";
      // Nothing typed since this save was sent: the server holds all of it, so the phone need not.
      if (edits === editsAtSend) dropCopy();
    } catch (e) {
      if ((e as { code?: string }).code === "draft_revision_conflict") {
        // Older than what is on file: stop, and never replay this tab's copy over the newer save.
        state.value = "conflict";
        dirtyWhileSaving = false;
        clear();
        dropCopy();
        return;
      }
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
    // No conflict check here: `keepCopy` and `flush` each refuse after one, which is where it matters.
    if (!options.enabled.value) return;
    edits += 1;
    keepCopy();
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

  onScopeDispose(() => {
    clear();
    clearCopyTimer();
  });

  /**
   * On arrival, after the restore (and after the date-of-birth unlock, D-APP16): a copy the last visit
   * could not send is put back when it was typed on the revision the server still holds, and dropped with
   * a notice when the server moved on. Returns whether the form changed, so the caller can send it.
   */
  async function replay(): Promise<boolean> {
    const spec = options.local?.value;
    if (!spec) return false;
    const copy = await readDraftCopy(spec.key);
    if (!copy) return false;
    const verdict = replayVerdict(copy, revision.value, toDraftPayload(draft));
    if (verdict !== "apply") {
      await clearDraftCopy(spec.key);
      if (verdict === "stale") notice.value = "dropped";
      return false;
    }
    Object.assign(draft, fromDraftPayload(copy.payload));
    notice.value = "restored";
    return true;
  }

  return {
    state: computed(() => state.value),
    savedAt: computed(() => savedAt.value),
    notice: computed(() => notice.value),
    replay,
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
      return APPLY_COPY.save.saving;
    case "saved":
      return APPLY_COPY.save.saved;
    case "failed":
      return APPLY_COPY.save.failed;
    case "conflict":
      return APPLY_COPY.save.conflict;
    default:
      return null;
  }
}

import { onScopeDispose, watch, type Ref } from "vue";
import { copyExpiry, deleteCopy, isLive, putCopy, readCopy, type LocalCopySpec } from "../deviceCopies";
import { HELD_UNTIL_SCREENING, type PartOneAnswers, type PartOneScreen, type PrefilledField } from "./partOneScreens";

export type { LocalCopySpec } from "../deviceCopies";

/**
 * Part 1's held screens, kept on the phone until screen 7 writes them (AW10, C3d1a, Q-AW39).
 *
 * ── THE DEFECT THIS CLOSES ────────────────────────────────────────────────────────────────────
 * Screens 3–6 cannot be saved before §40.25(j) is on file (0376 AI009; `partOneScreens.ts`'s header), so
 * until C3d1a they lived only in the page: a reload, a crashed tab or a phone that dropped the browser to
 * take a call lost up to four screens of typing. Written here as they are typed, they come back on the
 * next visit to the same link, and are deleted the moment screen 7's write has put them on the server.
 *
 * ── WHAT IS KEPT, AND FOR HOW LONG (Q-AW39, ruled 2026-09-28) ─────────────────────────────────────
 * Only the answers of screens 3–6 — phone, date of birth, address, the CDL, the other licences — and
 * which of those screens the driver had passed. Never screen 7's answers (§40.25(j) and §382.301(b) are
 * posted on their own Continue and are never at rest on a device), never the medical card, never a
 * photograph. The link may be opened on an office computer (the desktop handoff), so the copy dies at
 * the EARLIER of 72 hours after it was last written and the link's own expiry, and every read sweeps
 * every expired copy on the device, not only this link's — a copy for a link nobody reopens must not
 * outlive the rule because nobody came back to trigger it.
 *
 * ── WHY THE KEY IS `localKey` AND NOT THE TOKEN ─────────────────────────────────────────────────
 * The token rotates: the reminder (`nudge_application_invitation`) replaces the email's link and the text
 * mints its own (Q-AW29). The Part-1 reminder fires exactly when a driver stopped in Part 1 (C3c3b), so a
 * copy keyed by token would be unreachable on the one return path it exists for. The bundle serves a
 * `localKey` — a hash of the invitation, the same across every door — and never the token or an id.
 *
 * The storage, and what happens when there is none, is `../deviceCopies.ts` — shared with Part 2's
 * unsent draft since C3d1b.
 */

/** Bumped when `HeldAnswers` changes shape; a copy of another version is deleted, never read. */
export const HELD_COPY_VERSION = 1;
export const HELD_COPY_TTL_MS = 72 * 60 * 60 * 1000;
const WRITE_DEBOUNCE_MS = 300;

/** Screens 3–6's answers and nothing else (see the header). */
export type HeldAnswers = Pick<
  PartOneAnswers,
  "phone" | "date_of_birth" | "address_line1" | "address_line2" | "city" | "state" | "postal_code" | "cdl" | "otherHeld" | "others"
>;

export interface HeldCopy {
  key: string;
  version: number;
  answers: HeldAnswers;
  /** Which of screens 3–6 the driver pressed Continue on. */
  passed: PartOneScreen[];
  /** What the barcode filled, so the screen still says "from your licence — check it". */
  fromLicence: PrefilledField[];
  savedAt: string;
  expiresAt: string;
}

/** A deep copy of the held fields — the reactive answers must never be stored by reference. */
export function heldPart(a: PartOneAnswers): HeldAnswers {
  return JSON.parse(
    JSON.stringify({
      phone: a.phone, date_of_birth: a.date_of_birth,
      address_line1: a.address_line1, address_line2: a.address_line2, city: a.city, state: a.state,
      postal_code: a.postal_code, cdl: a.cdl, otherHeld: a.otherHeld, others: a.others,
    }),
  ) as HeldAnswers;
}

/** Has anything of screens 3–6 been typed (or filled by the barcode)? */
export function typedAny(h: HeldAnswers): boolean {
  const c = h.cdl;
  return (
    [h.phone, h.date_of_birth, h.address_line1, h.address_line2, h.city, h.state, h.postal_code].some((v) => v.trim() !== "") ||
    [c.state_code, c.licence_number, c.cdl_class, c.expires_on].some((v) => v.trim() !== "") ||
    c.endorsements.length > 0 ||
    h.otherHeld !== null ||
    h.others.length > 0
  );
}

/** The earlier of 72 hours from now and the link's expiry. An unreadable expiry leaves the 72 hours. */
export const heldExpiry = (now: Date, linkExpiresAt: string): string => copyExpiry(now, HELD_COPY_TTL_MS, linkExpiresAt);

/** Where a restored walk resumes: the first held screen not yet passed, or screen 7 once all four are. */
export function resumeHeld(passed: readonly PartOneScreen[]): PartOneScreen {
  return HELD_UNTIL_SCREENING.find((s) => !passed.includes(s)) ?? "screening";
}

/** This link's copy, if it is live — after deleting every expired or outdated copy on the device. */
export const readHeld = (key: string, now: Date = new Date()): Promise<HeldCopy | null> =>
  readCopy<HeldCopy>("partOne", key, (row) => isLive(row, HELD_COPY_VERSION, now));

export const writeHeld = (copy: HeldCopy): Promise<void> => putCopy("partOne", copy);

export const clearHeld = (key: string): Promise<void> => deleteCopy("partOne", key);

// ── the walk's half ───────────────────────────────────────────────────────────────────────────

/**
 * Restore on arrival, write as the driver types, delete once §40.25(j) is on file.
 *
 * ⚠ A restore applies only to a walk nobody has touched yet: IndexedDB answers in milliseconds, but a
 * barcode read or a keystroke in that window is newer than anything on the device, and a restore must
 * never overwrite the driver's own typing. It moves the walk only when the walk stands where an unbegun
 * link with both photographs resumes (`about`); a walk still owed a photograph stays there, with the
 * answers waiting behind it.
 */
export function useHeldCopy(opts: {
  spec: LocalCopySpec | null | undefined;
  answers: PartOneAnswers;
  held: Set<PartOneScreen>;
  fromLicence: Ref<PrefilledField[]>;
  begun: Ref<boolean>;
  screen: Ref<PartOneScreen>;
  goTo: (s: PartOneScreen) => void;
  now?: () => Date;
}): { ready: Promise<boolean> } {
  const { spec, answers, held, fromLicence, begun, screen, goTo } = opts;
  const now = opts.now ?? (() => new Date());
  if (!spec) return { ready: Promise.resolve(false) };

  let timer: ReturnType<typeof setTimeout> | null = null;
  let restoring = true;
  const stop = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  async function restore(): Promise<boolean> {
    // The server holds screens 3–6 once §40.25(j) is on file; a copy on the device is then only a risk.
    if (begun.value) {
      await clearHeld(spec!.key);
      return false;
    }
    const copy = await readHeld(spec!.key, now());
    if (!copy || begun.value || typedAny(heldPart(answers))) return false;
    Object.assign(answers, JSON.parse(JSON.stringify(copy.answers)) as HeldAnswers);
    for (const s of copy.passed) if (HELD_UNTIL_SCREENING.includes(s)) held.add(s);
    fromLicence.value = [...copy.fromLicence];
    if (screen.value === "about") goTo(resumeHeld(copy.passed));
    return true;
  }

  function save(): void {
    stop();
    if (restoring || begun.value) return;
    timer = setTimeout(() => {
      timer = null;
      const part = heldPart(answers);
      if (!typedAny(part)) return;
      void writeHeld({
        key: spec!.key,
        version: HELD_COPY_VERSION,
        answers: part,
        passed: HELD_UNTIL_SCREENING.filter((s) => held.has(s)),
        fromLicence: [...fromLicence.value],
        savedAt: now().toISOString(),
        expiresAt: heldExpiry(now(), spec!.linkExpiresAt),
      });
    }, WRITE_DEBOUNCE_MS);
  }

  watch(() => [heldPart(answers), [...held], fromLicence.value], save, { deep: true });
  watch(begun, (isBegun) => {
    if (!isBegun) return;
    stop();
    void clearHeld(spec.key);
  });
  onScopeDispose(stop);

  const ready = restore().finally(() => {
    restoring = false;
  });
  return { ready };
}

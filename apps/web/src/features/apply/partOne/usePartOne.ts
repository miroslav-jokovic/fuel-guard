import { computed, reactive, ref, type Ref } from "vue";
import type { AamvaLicence, ApplicationCaptureView, FcraSummary, PartOneStatus } from "@silvicom/shared";
import { readLicenceBarcode } from "@/features/apply/capture/readLicenceBarcode";
import { APPLY_COPY } from "@/features/apply/strings";
import { completePartOne, postIntake, postIntakeLicences } from "./partOneApi";
import { useHeldCopy, type LocalCopySpec } from "./partOneLocal";
import {
  HELD_UNTIL_SCREENING,
  PART_ONE_SCREENS,
  PREFILL_FIELDS,
  aboutPayload,
  addressPayload,
  cdlPayload,
  emptyPartOneAnswers,
  firstWrite,
  isPhotoScreen,
  licenceList,
  photoDone,
  prefillFromLicence,
  resumeScreen,
  screeningPayload,
  validateAbout,
  validateAddress,
  validateLicence,
  validateOtherLicences,
  validateScreening,
  type PartOneScreen,
  type PrefilledField,
  type ScreenErrors,
} from "./partOneScreens";

/**
 * Part 1's walk — which screen, what it holds, and what Continue does (AW3, C3a). The rules are in
 * `partOneScreens.ts`; this is where they meet the network.
 *
 * ── WHAT A SCREEN'S CONTINUE DOES ─────────────────────────────────────────────────────────────
 * Before §40.25(j) is on file: screens 3–6 check themselves and move on, holding their answers here, and
 * screen 7 posts all of it in `firstWrite`'s order. After it: each screen posts its own answers. A screen
 * whose answers the server already holds may be left blank ("keep them") — the bare link never reads an
 * answer back (D-APP16), so a returning applicant sees empty boxes, not their date of birth.
 *
 * ⚠ The licence list is replaced WHOLE on every write (0376). A returning applicant's list is on the
 * server and not in this page, so posting what this page holds would delete what it does not. Those two
 * screens are therefore read-only in a session that did not type them (`locked`), and the office corrects
 * the list (`p_overwrite`) if it is wrong.
 *
 * Screens 3–6's held answers are also kept on the device until screen 7 writes them (`partOneLocal.ts`,
 * AW10), so a reload before screen 7 no longer loses them. A restored screen counts as `held`: this
 * device typed it, and on an unbegun link the server holds no list for a re-post to delete.
 */
export interface PartOneInputs {
  status: PartOneStatus;
  identityComplete: boolean;
  captures: readonly ApplicationCaptureView[];
  summary: FcraSummary | null;
  /** The device copy's key and lifetime (C3d1a). Absent: no copy is kept, as before C3d1a. */
  local?: LocalCopySpec | null;
}

/** Where the licence's barcode stands on the CDL-back screen (AW5). `idle` says nothing. */
export type BarcodeState = "idle" | "reading" | "filled" | "unread";

/** Refusals written for the applicant by the server — shown as they came. Anything else is "try again". */
const SPOKEN_CODES = new Set([
  "intake_frozen",
  "intake_incomplete",
  "prior_positive_required",
  "already_submitted",
  "esign_consent_required",
]);

export function usePartOne(
  token: Ref<string>,
  inputs: Ref<PartOneInputs>,
  refresh: () => Promise<PartOneInputs | null>,
  onDone: () => void,
  readBarcode: (photo: Blob) => Promise<AamvaLicence | null> = readLicenceBarcode,
) {
  const answers = reactive(emptyPartOneAnswers());
  const initial = inputs.value;
  const index = ref(
    PART_ONE_SCREENS.indexOf(resumeScreen(initial.status, initial.identityComplete, initial.captures)),
  );
  const screen = computed<PartOneScreen>(() => PART_ONE_SCREENS[index.value]!);
  const errors = ref<ScreenErrors>({});
  const failure = ref<string | null>(null);
  const working = ref(false);
  const kept = ref(false);
  /** Did THIS session type the screen's answers? Only then can a licence list be re-posted whole. */
  const held = reactive(new Set<PartOneScreen>());
  const wroteFirst = ref(false);
  /** §40.25(j) on file — from the server, or from this session's first write. */
  const begun = computed(() => inputs.value.status.screening || wroteFirst.value);

  const onFile = computed(() => {
    const s = inputs.value.status;
    switch (screen.value) {
      case "about":
        return s.contact && inputs.value.identityComplete;
      case "address":
        return s.address;
      case "licence":
      case "otherLicences":
        return s.licences;
      case "screening":
        return s.screening;
      default:
        return false;
    }
  });
  const barcode = ref<BarcodeState>("idle");
  const fromLicence = ref<PrefilledField[]>([]);
  /**
   * Read the barcode only while it can fill something: before §40.25(j) is on file, nothing of screens
   * 3–6 has been written, so a box is blank because the driver has not reached it. After it, the answers
   * are on the server and the boxes are blank because the bare link never reads them back (D-APP16) —
   * filling them then would post the licence's values over, or beside, what the driver already gave, and
   * the date of birth would be dropped as fill-only. So a begun link does not even download the decoder.
   */
  const readsBarcode = computed(() => screen.value === "cdl_back" && !begun.value);

  /** The CDL's back is in the bucket (`onStaged`): read it, and fill what is still blank. */
  async function licencePhotoStaged(original: Blob): Promise<void> {
    if (!readsBarcode.value) return;
    barcode.value = "reading";
    const licence = await readBarcode(original);
    // Checked again: Part 1 may have been begun while the decoder ran (screen 7 is two screens away).
    const filled = licence && !begun.value ? prefillFromLicence(answers, licence) : [];
    fromLicence.value = [...new Set([...fromLicence.value, ...filled])];
    barcode.value = licence === null ? "unread" : filled.length > 0 ? "filled" : "idle";
  }

  /** Does the screen on show hold a box the barcode filled? Then it says so, and the driver checks it. */
  const prefilledHere = computed(() => {
    const fields = (PREFILL_FIELDS as Partial<Record<PartOneScreen, readonly PrefilledField[]>>)[screen.value] ?? [];
    return fields.some((f) => fromLicence.value.includes(f));
  });

  const locked = computed(
    () => (screen.value === "licence" || screen.value === "otherLicences") && onFile.value && !held.has("licence"),
  );

  const { ready: restored } = useHeldCopy({
    spec: initial.local,
    answers,
    held,
    fromLicence,
    begun,
    screen,
    goTo: (s) => {
      index.value = PART_ONE_SCREENS.indexOf(s);
    },
  });

  function back(): void {
    [errors.value, failure.value, kept.value] = [{}, null, false];
    if (index.value > 0) index.value -= 1;
  }

  function advance(): void {
    [errors.value, failure.value] = [{}, null];
    index.value = Math.min(index.value + 1, PART_ONE_SCREENS.length - 1);
  }

  /** A screen left entirely blank whose answers are on file: keep them, post nothing. */
  function blank(s: PartOneScreen): boolean {
    if (s === "about") return answers.phone.trim() === "" && answers.date_of_birth === "";
    if (s === "address") return [answers.address_line1, answers.city, answers.state, answers.postal_code].every((v) => v.trim() === "");
    if (s === "screening") return answers.prior_positive_2y === null && answers.dot_program_30d === null;
    return false;
  }

  function check(s: PartOneScreen): ScreenErrors {
    switch (s) {
      case "about":
        return validateAbout(answers);
      case "address":
        return validateAddress(answers);
      case "licence":
        return validateLicence(answers);
      case "otherLicences":
        return validateOtherLicences(answers);
      case "screening":
        return validateScreening(answers);
      default:
        return {};
    }
  }

  async function save(s: PartOneScreen): Promise<void> {
    const t = token.value;
    let keptNow: string[] = [];
    if (s === "screening" && !begun.value) {
      for (const write of firstWrite(answers)) {
        const r = write.kind === "intake" ? await postIntake(t, write.body) : await postIntakeLicences(t, write.body);
        keptNow = keptNow.concat(r.keptExisting);
      }
      wroteFirst.value = true;
    } else if (s === "about") {
      keptNow = (await postIntake(t, aboutPayload(answers))).keptExisting;
    } else if (s === "address") {
      keptNow = (await postIntake(t, addressPayload(answers))).keptExisting;
    } else if (s === "licence") {
      await postIntake(t, cdlPayload(answers));
      // The other-licences screen follows and re-posts the whole list; until then this keeps the others.
      await postIntakeLicences(t, licenceList({ ...answers, otherHeld: answers.otherHeld ?? false }));
    } else if (s === "otherLicences") {
      await postIntakeLicences(t, licenceList(answers));
    } else if (s === "screening") {
      await postIntake(t, screeningPayload(answers));
    } else if (s === "medical_card") {
      await postIntake(t, { medical_card_pending: answers.medical_card_pending });
    }
    // Fill-only (D-AF8): said once, before moving on, never what the carrier holds.
    if (keptNow.length > 0 && !kept.value) kept.value = true;
  }

  async function next(): Promise<void> {
    const s = screen.value;
    failure.value = null;
    if (locked.value || (onFile.value && blank(s))) return advance();

    const found = check(s);
    errors.value = found;
    if (Object.keys(found).length > 0) return;

    if (isPhotoScreen(s)) {
      working.value = true;
      try {
        // The capture landed through its own two calls; the bundle is where it is recorded.
        const fresh = (await refresh()) ?? inputs.value;
        if (s === "medical_card" && begun.value) await save(s);
        if (!photoDone(s, fresh.captures, answers)) {
          const copy = APPLY_COPY.partOne.photo;
          errors.value = { photo: s === "selfie" ? copy.selfie.required : copy.required };
          return;
        }
      } catch (e) {
        failure.value = spoken(e);
        return;
      } finally {
        working.value = false;
      }
      return advance();
    }

    if (s === "rights") return finish();

    if (HELD_UNTIL_SCREENING.includes(s) && !begun.value) {
      held.add(s);
      return advance();
    }
    working.value = true;
    try {
      await save(s);
      held.add(s);
      if (s === "screening") for (const h of HELD_UNTIL_SCREENING) held.add(h);
    } catch (e) {
      failure.value = spoken(e);
      return;
    } finally {
      working.value = false;
    }
    if (!kept.value) advance();
  }

  /** "I have read this": stamp which summary was shown, then end Part 1 (0376 refuses otherwise). */
  async function finish(): Promise<void> {
    const summary = inputs.value.summary;
    if (!summary) return;
    working.value = true;
    try {
      await postIntake(token.value, { fcra_summary_version: summary.version });
      await completePartOne(token.value);
    } catch (e) {
      failure.value = (e as { code?: string }).code === "fcra_summary_changed"
        ? APPLY_COPY.partOne.rights.changed
        : spoken(e);
      return;
    } finally {
      working.value = false;
    }
    onDone();
  }

  /** After the "kept" notice: the applicant has read it, and Continue moves on. */
  function acknowledgeKept(): void {
    kept.value = false;
    advance();
  }

  return {
    answers,
    screen,
    step: computed(() => index.value + 1),
    steps: PART_ONE_SCREENS.length,
    errors,
    failure,
    working,
    kept,
    onFile,
    locked,
    barcode,
    readsBarcode,
    prefilledHere,
    licencePhotoStaged,
    back,
    next,
    acknowledgeKept,
    /** Settles once the device copy has been read (and applied, when there was one to apply). */
    restored,
  };
}

function spoken(e: unknown): string {
  const err = e as { code?: string; message?: string };
  return err.code && SPOKEN_CODES.has(err.code) && err.message ? err.message : APPLY_COPY.partOne.failed;
}

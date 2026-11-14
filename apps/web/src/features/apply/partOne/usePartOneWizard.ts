import { computed, ref, watch } from "vue";
import { PART_ONE_SCREENS, wizardScreenShown, wizardScreensOf, type PartOneScreen, type WizardScreen } from "@silvicom/shared";
import { partOneAnswerKey, partOneBinding, partOneErrorKey } from "@/features/apply/wizard/partOneFields";
import { confirmedKeys, scannedFacts, stillConfirmed, type ScanFact, type ScreenErrors } from "./partOneScreens";
import type { usePartOne } from "./usePartOne";

/**
 * Part 1, one question per screen (D-AM2; APPLICATION-SCREEN-MAP §2, §7; F4 PR 1).
 *
 * ── THE PAGE STILL SAVES; THE SCREEN ONLY ASKS ───────────────────────────────────────────────
 * `usePartOne` walks Part 1's pages — "about", "address", "licence", "screening" — and each page's
 * Continue checks the page and posts it, in the order 0376 needs (§40.25(j) first, the licence list
 * whole). That is left exactly as it was. The wizard cuts each page into the screens the catalogue
 * generates (`wizardScreensOf`) and steps through them: Continue on a screen checks that screen's share
 * of the page's own check and moves on, and Continue on the page's LAST screen is the page's Continue.
 * So the posting, the resume point (a page), the device copy (a page) and the screen reports (a page)
 * are unchanged by how finely the page is cut, and the checks are the page's own — never a second set.
 *
 * ⚠ If the page's Continue still refuses — a rule that spans two screens, or one the screen-level check
 * could not see — the walk goes back to the first screen holding a problem, so the driver lands on the
 * box the message is about rather than on the last screen with a message about another one.
 *
 * ── "IS THIS RIGHT?" — WHAT THE SCAN READ IS CONFIRMED ONCE (U2, SCREEN-MAP 1.4, D-AM5) ───────
 * When the CDL's barcode filled anything whole (`scannedFacts`), the first thing after the two
 * photographs is one screen listing it. A fact the driver leaves as read is not asked again: a screen
 * made only of confirmed answers is left out of the walk, and a page left with no screen at all (the
 * home address) is passed through its own Continue — checked and held or posted exactly as if the driver
 * had pressed it. A fact they tap "Change" on is asked on its own screen, with the read value in the box.
 *
 * ⚠ **Confirmed is not the same as valid.** A barcode can hold a date the contract refuses. Whenever a
 * page's own check complains about a confirmed fact, the fact is taken back (`stillConfirmed`) and its
 * screen returns with the message under the box — a driver is never stopped by a problem on a screen
 * they cannot reach.
 */
type PartOneFlow = ReturnType<typeof usePartOne>;

export function usePartOneWizard(flow: PartOneFlow) {
  const binding = partOneBinding(() => flow.answers, () => flow.errors.value);

  // ── the scan's confirmation ──
  /** What the confirmation lists. Empty when the barcode read nothing whole: then there is no such screen. */
  const offered = computed<ScanFact[]>(() => scannedFacts(flow.fromLicence.value));
  /** The facts the driver tapped "Change" on, while the confirmation is on show. */
  const fixing = ref<ScanFact[]>([]);
  /** Back from the first question returns to the confirmation, which was answered once already. */
  const reopened = ref(false);
  const confirming = computed(
    () => flow.screen.value === "about" && offered.value.length > 0 && (flow.scanConfirmed.value === null || reopened.value),
  );
  const confirmedAway = computed(() => confirmedKeys(flow.scanConfirmed.value ?? []));
  const answeredByScan = (s: WizardScreen): boolean =>
    s.fields.length > 0 && s.fields.every((f) => confirmedAway.value.has(partOneAnswerKey(f.fact.path)));

  function toggleFix(fact: ScanFact): void {
    fixing.value = fixing.value.includes(fact) ? fixing.value.filter((f) => f !== fact) : [...fixing.value, fact];
  }

  const shownOf = (page: PartOneScreen): readonly WizardScreen[] =>
    wizardScreensOf(page).filter((s) => wizardScreenShown(s, binding.read) && !answeredByScan(s));
  /** A page the wizard cuts, every screen of which the scan answered: nothing of it is asked. */
  const passedOver = (page: PartOneScreen): boolean => wizardScreensOf(page).length > 0 && shownOf(page).length === 0;

  const screens = computed(() => shownOf(flow.screen.value));
  const at = ref(0);
  const current = computed<WizardScreen | null>(() =>
    confirming.value ? null : (screens.value[Math.min(at.value, screens.value.length - 1)] ?? null),
  );

  /** A page's own check refused something the driver had confirmed: its screen comes back. */
  function takeBack(): void {
    const confirmed = flow.scanConfirmed.value;
    if (!confirmed) return;
    const kept = stillConfirmed(confirmed, new Set(Object.keys(flow.errors.value)));
    if (kept.length !== confirmed.length) flow.scanConfirmed.value = kept;
  }

  /** A page with nothing left to ask: its own Continue, and its screen back if that refuses. */
  async function passThrough(): Promise<void> {
    const page = flow.screen.value;
    await flow.next();
    if (flow.screen.value !== page) return;
    takeBack();
    at.value = 0;
  }

  /** Arriving at a page by Back opens its last screen; any other way, its first. */
  let backing = false;
  watch(flow.screen, (page) => {
    if (passedOver(page)) {
      // Nothing to ask here. Backward: on to the page before. Forward: through the page's own Continue,
      // which checks and holds (or posts) it — and stays, with its screen back, when the check refuses.
      if (backing) flow.back();
      else void passThrough();
      return;
    }
    at.value = backing ? Math.max(screens.value.length - 1, 0) : 0;
    backing = false;
  });
  // A restored walk can resume on a page the scan answered whole (`useHeldCopy` moves it once, at setup).
  void flow.restored.then(() => {
    if (passedOver(flow.screen.value)) void passThrough();
  });

  const keysOf = (screens: readonly WizardScreen[]): Set<string> =>
    new Set(screens.flatMap((s) => s.fields.map((f) => partOneErrorKey(f.fact.path))));
  const pick = (errors: ScreenErrors, keys: Set<string>): ScreenErrors =>
    Object.fromEntries(Object.entries(errors).filter(([k]) => keys.has(k)));

  /** A problem the page's check found that no screen of the page shows — said under the controls, never dropped. */
  const stray = computed<string[]>(() => {
    const all = wizardScreensOf(flow.screen.value);
    if (all.length === 0 || confirming.value) return [];
    const shown = keysOf(all);
    return Object.entries(flow.errors.value).filter(([k]) => !shown.has(k)).map(([, v]) => v);
  });

  const clear = (): void => {
    [flow.errors.value, flow.failure.value, flow.kept.value] = [{}, null, false];
  };

  async function next(): Promise<void> {
    if (confirming.value) {
      clear();
      flow.scanConfirmed.value = offered.value.filter((f) => !fixing.value.includes(f));
      [reopened.value, at.value] = [false, 0];
      return;
    }
    const screen = current.value;
    if (screen && at.value < screens.value.length - 1) {
      // A page whose answers are on file may be left blank whole (`skippable`); its screens then ask nothing.
      const found = flow.skippable.value ? {} : pick(flow.pageErrors(), keysOf([screen]));
      clear();
      flow.errors.value = found;
      if (Object.keys(found).length === 0) at.value += 1;
      return;
    }
    const page = flow.screen.value;
    await flow.next();
    if (flow.screen.value !== page) return;
    takeBack();
    const problems = new Set(Object.keys(flow.errors.value));
    const first = screens.value.findIndex((s) => [...keysOf([s])].some((k) => problems.has(k)));
    if (first >= 0) at.value = first;
  }

  function back(): void {
    if (confirming.value) {
      reopened.value = false;
      flow.back();
      return;
    }
    if (at.value > 0 && screens.value.length > 0) {
      clear();
      at.value -= 1;
      return;
    }
    // The first question of the page the confirmation opens: Back is the confirmation, as it was left.
    if (flow.screen.value === "about" && offered.value.length > 0) {
      clear();
      fixing.value = offered.value.filter((f) => !(flow.scanConfirmed.value ?? []).includes(f));
      reopened.value = true;
      return;
    }
    if (flow.step.value > 1) {
      backing = true;
      flow.back();
    }
  }

  /** One step per screen; a page the wizard does not cut (a photograph, the rights) is one, and the confirmation is one. */
  const count = (page: PartOneScreen): number =>
    (wizardScreensOf(page).length === 0 ? 1 : shownOf(page).length) + (page === "about" && offered.value.length > 0 ? 1 : 0);
  const step = computed(() => {
    const before = PART_ONE_SCREENS.slice(0, PART_ONE_SCREENS.indexOf(flow.screen.value));
    const pagesBefore = before.reduce((n, p) => n + count(p), 0);
    if (confirming.value) return pagesBefore + 1;
    const confirmation = flow.screen.value === "about" && offered.value.length > 0 ? 1 : 0;
    return pagesBefore + confirmation + Math.min(at.value, Math.max(screens.value.length - 1, 0)) + 1;
  });
  const steps = computed(() => PART_ONE_SCREENS.reduce((n, p) => n + count(p), 0));

  /** Does the screen on show hold a box the barcode filled? Then it says so, and the driver checks it. */
  const prefilledHere = computed(() => {
    if (confirming.value) return false;
    const screen = current.value;
    if (!screen) return flow.prefilledHere.value;
    return screen.fields.some((f) => flow.fromLicence.value.includes(partOneAnswerKey(f.fact.path) as never));
  });

  return { binding, current, step, steps, stray, prefilledHere, confirming, offered, fixing, toggleFix, next, back };
}

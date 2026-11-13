import { computed, ref, watch } from "vue";
import { PART_ONE_SCREENS, wizardScreenShown, wizardScreensOf, type PartOneScreen, type WizardScreen } from "@silvicom/shared";
import { partOneAnswerKey, partOneBinding, partOneErrorKey } from "@/features/apply/wizard/partOneFields";
import type { ScreenErrors } from "./partOneScreens";
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
 */
type PartOneFlow = ReturnType<typeof usePartOne>;

export function usePartOneWizard(flow: PartOneFlow) {
  const binding = partOneBinding(() => flow.answers, () => flow.errors.value);
  const shownOf = (page: PartOneScreen): readonly WizardScreen[] =>
    wizardScreensOf(page).filter((s) => wizardScreenShown(s, binding.read));

  const screens = computed(() => shownOf(flow.screen.value));
  const at = ref(0);
  const current = computed<WizardScreen | null>(() => screens.value[Math.min(at.value, screens.value.length - 1)] ?? null);

  /** Arriving at a page by Back opens its last screen; any other way, its first. */
  let backing = false;
  watch(flow.screen, () => {
    at.value = backing ? Math.max(screens.value.length - 1, 0) : 0;
    backing = false;
  });

  const keysOf = (screens: readonly WizardScreen[]): Set<string> =>
    new Set(screens.flatMap((s) => s.fields.map((f) => partOneErrorKey(f.fact.path))));
  const pick = (errors: ScreenErrors, keys: Set<string>): ScreenErrors =>
    Object.fromEntries(Object.entries(errors).filter(([k]) => keys.has(k)));

  /** A problem the page's check found that no screen of the page shows — said under the controls, never dropped. */
  const stray = computed<string[]>(() => {
    const all = wizardScreensOf(flow.screen.value);
    if (all.length === 0) return [];
    const shown = keysOf(all);
    return Object.entries(flow.errors.value).filter(([k]) => !shown.has(k)).map(([, v]) => v);
  });

  const clear = (): void => {
    [flow.errors.value, flow.failure.value, flow.kept.value] = [{}, null, false];
  };

  async function next(): Promise<void> {
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
    const problems = new Set(Object.keys(flow.errors.value));
    const first = screens.value.findIndex((s) => [...keysOf([s])].some((k) => problems.has(k)));
    if (first >= 0) at.value = first;
  }

  function back(): void {
    if (at.value > 0 && screens.value.length > 0) {
      clear();
      at.value -= 1;
      return;
    }
    if (flow.step.value > 1) {
      backing = true;
      flow.back();
    }
  }

  /** One step per screen; a page the wizard does not cut (a photograph, the rights) is one. */
  const count = (page: PartOneScreen): number => Math.max(shownOf(page).length, 1);
  const step = computed(() => {
    const before = PART_ONE_SCREENS.slice(0, PART_ONE_SCREENS.indexOf(flow.screen.value));
    return before.reduce((n, p) => n + count(p), 0) + Math.min(at.value, Math.max(screens.value.length - 1, 0)) + 1;
  });
  const steps = computed(() => PART_ONE_SCREENS.reduce((n, p) => n + count(p), 0));

  /** Does the screen on show hold a box the barcode filled? Then it says so, and the driver checks it. */
  const prefilledHere = computed(() => {
    const screen = current.value;
    if (!screen) return flow.prefilledHere.value;
    return screen.fields.some((f) => flow.fromLicence.value.includes(partOneAnswerKey(f.fact.path) as never));
  });

  return { binding, current, step, steps, stray, prefilledHere, next, back };
}

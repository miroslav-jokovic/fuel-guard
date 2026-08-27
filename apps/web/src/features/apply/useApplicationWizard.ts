import { computed, ref, type Ref } from "vue";
import {
  APPLICATION_CROSS_FIELD_RULES,
  APPLICATION_SECTION_KEYS,
  APPLICATION_SECTION_ORDER,
  driverApplicationObject,
  isApplicationSection,
  sectionOwning,
  type ApplicationSection,
  type DriverApplicationFields,
} from "@silvicom/shared";
import { toApplication, type ApplicationDraft } from "./draft";

/**
 * One screen at a time, validated by the server's own schema (A3).
 *
 * ── WHY VALIDATION PICKS KEYS INSTEAD OF RE-STATING RULES ─────────────────────────────────────
 * `driverApplicationObject` is the same object the API validates with. Picking one section's keys
 * out of it means a screen is checked by the definition of §391.21(b) itself, and the client and the
 * server can still never disagree about what the regulation requires — the property H5b's page had
 * and the one a hand-written per-step validator would have quietly lost.
 *
 * The rules that span fields (`APPLICATION_CROSS_FIELD_RULES`) come along, filtered to the ones whose
 * message lands on a key this section owns. "You listed no accidents and did not say you had none"
 * belongs to the safety screen and to no other, and it must not fire on the identity screen just
 * because the accidents array is still empty there.
 *
 * ── WHY THE DRIVER IS NEVER BLOCKED FROM GOING BACK ───────────────────────────────────────────
 * Forward is gated on the current screen being valid; back never is. A driver who realises on the
 * employment screen that they mistyped their licence must be able to go and fix it, and a form that
 * refuses to move until the screen in front of them is perfect is a form that traps somebody behind
 * a field they cannot answer.
 */

export interface SectionIssue {
  /** The contract key, so the message can be shown against the field it belongs to. */
  key: string;
  message: string;
  /** Which screen owns it — how the review step sends the driver to the right place. */
  section: ApplicationSection | null;
}

/** Validate exactly one screen's fields against the contract. */
export function validateSection(section: ApplicationSection, draft: ApplicationDraft): SectionIssue[] {
  const keys = APPLICATION_SECTION_KEYS[section];
  if (keys.length === 0) return [];

  const candidate = toApplication(draft) as Record<string, unknown>;
  const picked = Object.fromEntries(keys.map((k) => [k, true])) as Record<string, true>;
  const issues: SectionIssue[] = [];

  const parsed = driverApplicationObject
    // `.pick()` on the unrefined object: the refinements are applied below, filtered to this screen.
    .pick(picked as never)
    .safeParse(Object.fromEntries(keys.map((k) => [k, candidate[k]])));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      issues.push({ key, message: issue.message, section });
    }
  }

  for (const rule of APPLICATION_CROSS_FIELD_RULES) {
    if (!keys.includes(rule.path)) continue;
    // The whole candidate, not the picked subset: a rule that reads `declares_no_accidents` to judge
    // `accidents` needs both, and both are on this screen by construction.
    if (!rule.check(candidate as Partial<DriverApplicationFields>)) {
      issues.push({ key: String(rule.path), message: rule.message, section });
    }
  }
  return issues;
}

/**
 * Turn a whole-document parse failure into issues attributed to the screens that can fix them.
 *
 * The send button runs `driverApplicationSchema` itself rather than the union of the per-section
 * checks: it is the exact object the API will run, defaults and coercions included, so what the
 * driver is told is what the server would have said. `sectionOwning` is what turns "employers" into
 * "go back to Where you have worked".
 */
export function issuesFromParse(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): SectionIssue[] {
  return issues.map((issue) => {
    const key = String(issue.path[0] ?? "");
    return {
      key,
      message: issue.message,
      section: sectionOwning(key as keyof DriverApplicationFields),
    };
  });
}

export function useApplicationWizard(draft: ApplicationDraft, resumeAt: Ref<string | null>) {
  const index = ref(0);
  /**
   * The furthest screen reached, which is NOT the current one.
   *
   * `application_drafts.furthest_section` is named for what it stores, and the difference shows the
   * moment a driver steps back to fix an address: sending the current screen would walk the stored
   * value backwards, and a driver who then closed the tab would resume at the top of a form they had
   * almost finished. Going back to correct something is not un-reaching where you got to.
   */
  const furthest = ref(0);
  const issues = ref<SectionIssue[]>([]);

  const section = computed<ApplicationSection>(() => APPLICATION_SECTION_ORDER[index.value]!);
  const isFirst = computed(() => index.value === 0);
  const isLast = computed(() => index.value === APPLICATION_SECTION_ORDER.length - 1);

  /** Where the driver left off, if the saved token is one this version of the form knows. */
  function resume(): void {
    const saved = resumeAt.value;
    if (!isApplicationSection(saved)) return;
    const at = APPLICATION_SECTION_ORDER.indexOf(saved);
    if (at < 0) return;
    index.value = at;
    furthest.value = at;
  }

  /** Where the index moves, the high-water mark follows — and never recedes. */
  const moveTo = (at: number): void => {
    index.value = at;
    if (at > furthest.value) furthest.value = at;
  };

  function goTo(target: ApplicationSection): void {
    const at = APPLICATION_SECTION_ORDER.indexOf(target);
    if (at < 0) return;
    issues.value = [];
    moveTo(at);
    scrollToTop();
  }

  /** Try to advance. Returns false and shows what is missing when the screen is not complete. */
  function next(): boolean {
    const found = validateSection(section.value, draft);
    issues.value = found;
    if (found.length > 0) {
      scrollToTop();
      return false;
    }
    if (!isLast.value) {
      moveTo(index.value + 1);
      scrollToTop();
    }
    return true;
  }

  function back(): void {
    // Never gated. Going back to fix something is the reason back exists.
    issues.value = [];
    // `moveTo` deliberately not used: back never lowers the high-water mark.
    if (index.value > 0) index.value -= 1;
    scrollToTop();
  }

  const scrollToTop = (): void => globalThis.scrollTo({ top: 0, behavior: "smooth" });

  return {
    section,
    /** What autosave stores — the name of the column, and the screen a resumed session opens on. */
    furthestSection: computed<ApplicationSection>(() => APPLICATION_SECTION_ORDER[furthest.value]!),
    index: computed(() => index.value),
    total: APPLICATION_SECTION_ORDER.length,
    isFirst,
    isLast,
    issues: computed(() => issues.value),
    setIssues: (v: SectionIssue[]): void => {
      issues.value = v;
    },
    resume,
    goTo,
    next,
    back,
    sectionOwning,
  };
}

import { computed, ref, type Ref } from "vue";
import {
  APPLICATION_CROSS_FIELD_RULES,
  APPLICATION_FILLING_SECTIONS,
  APPLICATION_SECTION_KEYS,
  driverApplicationObject,
  isApplicationSection,
  sectionOwning,
  type ApplicationSection,
  type DriverApplicationFields,
} from "@silvicom/shared";
import { toApplication, type ApplicationDraft } from "./draft";
import { describeField, fieldId, messageFor, valueAt, type FieldPath } from "./fieldLabels";

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
  /**
   * The WHOLE contract path, as Zod reports it: `["addresses", 1, "city"]`.
   *
   * ⚠ Only `path[0]` used to be kept, and the cost was two things at once. A driver with three
   * addresses was told "addresses" and had to find which card and which box; and nothing could mark
   * the offending control, because nothing knew which one it was. Everything below — the label, the
   * DOM id, the inline message under the field, the focus move — is derived from this array.
   */
  path: FieldPath;
  /** The top-level contract key. Which screen owns it, and what the section map is keyed on. */
  key: string;
  /** Zod's sentence, kept for nothing but the tests that assert a rule fired. Never rendered. */
  message: string;
  /** The field in the words the screen prints above it: "Address 2 · City". */
  label: string;
  /** What the driver is told to do, in a sentence addressed to them. This is what renders. */
  say: string;
  /** The control's DOM id, so a summary entry can move focus to the box it is about. */
  fieldId: string;
  /** Which screen owns it — how the review step sends the driver to the right place. */
  section: ApplicationSection | null;
}

/** One issue, from a Zod issue or a cross-field rule, with everything the screen needs to show it. */
function toSectionIssue(
  raw: { code?: string; message: string; format?: string; path: FieldPath },
  section: ApplicationSection | null,
  candidate: unknown,
): SectionIssue {
  return {
    path: raw.path,
    key: String(raw.path[0] ?? ""),
    message: raw.message,
    label: describeField(raw.path),
    say: messageFor(raw, valueAt(candidate, raw.path)),
    fieldId: fieldId(raw.path),
    section,
  };
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
      issues.push(toSectionIssue(issue as never, section, candidate));
    }
  }

  for (const rule of APPLICATION_CROSS_FIELD_RULES) {
    if (!keys.includes(rule.path)) continue;
    // The whole candidate, not the picked subset: a rule that reads `declares_no_accidents` to judge
    // `accidents` needs both, and both are on this screen by construction.
    if (!rule.check(candidate as Partial<DriverApplicationFields>)) {
      // `code: "custom"` because that is what it is — a rule whose message was written for a driver
      // and must pass through untouched, exactly like the refinements inside the schema.
      issues.push(
        toSectionIssue(
          { code: "custom", message: rule.message, path: [rule.path as string] },
          section,
          candidate,
        ),
      );
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
export function issuesFromParse(
  issues: ReadonlyArray<{ code?: string; path: PropertyKey[]; message: string; format?: string }>,
  candidate?: unknown,
): SectionIssue[] {
  return issues.map((issue) => {
    const path = issue.path as FieldPath;
    const key = String(path[0] ?? "");
    return toSectionIssue(
      { code: issue.code, message: issue.message, format: issue.format, path },
      sectionOwning(key as keyof DriverApplicationFields),
      candidate,
    );
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

  const section = computed<ApplicationSection>(() => APPLICATION_FILLING_SECTIONS[index.value]!);
  const isFirst = computed(() => index.value === 0);
  const isLast = computed(() => index.value === APPLICATION_FILLING_SECTIONS.length - 1);

  /** Where the driver left off, if the saved token is one this version of the form knows. */
  function resume(): void {
    const saved = resumeAt.value;
    if (!isApplicationSection(saved)) return;
    const at = APPLICATION_FILLING_SECTIONS.indexOf(saved as never);
    if (at < 0) return;
    index.value = at;
    furthest.value = at;
  }

  /** Where the index moves, the high-water mark follows — and never recedes. */
  const moveTo = (at: number): void => {
    index.value = at;
    if (at > furthest.value) furthest.value = at;
  };

  /**
   * Jump to a screen.
   *
   * ⚠ `keepIssues` exists for ONE caller and the distinction is real. The review screen's "Fix"
   * button means "take me there to change something", and carrying a stale list across would show a
   * driver errors about a screen they are no longer on. The SEND button's summary means "this is
   * what is stopping you" — clicking an entry there has to arrive with that entry still on screen,
   * beside the field it names, or the driver lands on a long screen with no idea what they came for.
   */
  function goTo(target: ApplicationSection, keepIssues = false): void {
    const at = APPLICATION_FILLING_SECTIONS.indexOf(target as never);
    if (at < 0) return;
    if (!keepIssues) issues.value = [];
    moveTo(at);
    scrollToTop();
  }

  /** Move the cursor to one issue's control, wherever it is. Used by the send summary. */
  const focusIssue = (issue: SectionIssue): void => focusFirstIssue([issue]);

  /** Try to advance. Returns false and shows what is missing when the screen is not complete. */
  function next(): boolean {
    const found = validateSection(section.value, draft);
    issues.value = found;
    if (found.length > 0) {
      focusFirstIssue(found);
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

  /**
   * Put the cursor in the first box that needs an answer.
   *
   * ── WHY THIS IS NOT `scrollTo(0)` ─────────────────────────────────────────────────────────────
   * The old behaviour scrolled to the top of the page and rendered a list. On the employment screen
   * that list can be twelve entries long and the field it is about can be two thousand pixels below
   * the fold, so a driver was told what was wrong and then had to hunt for where. Moving focus is
   * what the WAI-ARIA form-validation pattern asks for, and it also answers the question on a screen
   * reader, which cannot see a list appear at all.
   *
   * ⚠ `scrollToTop` is still the fallback and is not dead code. A cross-field rule's path is a
   * COLLECTION — `["accidents"]`, `["employers"]` — and no single control holds it, so there is
   * nothing to focus; the summary at the top is the whole answer for those, and the page has to go
   * there. `smoothScroll` is guarded because jsdom implements neither method.
   */
  function focusFirstIssue(found: SectionIssue[]): void {
    const target = found
      .map((i) => globalThis.document?.getElementById(i.fieldId))
      .find((el): el is HTMLElement => el !== null && el !== undefined);
    if (!target) {
      scrollToTop();
      return;
    }
    target.scrollIntoView?.({ block: "center", behavior: "smooth" });
    target.focus?.();
  }

  return {
    section,
    /** What autosave stores — the name of the column, and the screen a resumed session opens on. */
    furthestSection: computed<ApplicationSection>(() => APPLICATION_FILLING_SECTIONS[furthest.value]!),
    /**
     * The same high-water mark as a number — the fence the step list navigates inside (X4).
     *
     * Exposed rather than recomputed from `furthestSection`, because the mark is an index here and a
     * section token only at the edge where it is stored; a consumer converting back and forth would
     * be the second opinion about what "furthest" means.
     */
    furthestIndex: computed(() => furthest.value),
    index: computed(() => index.value),
    total: APPLICATION_FILLING_SECTIONS.length,
    isFirst,
    isLast,
    issues: computed(() => issues.value),
    setIssues: (v: SectionIssue[]): void => {
      issues.value = v;
    },
    resume,
    goTo,
    focusIssue,
    next,
    back,
    sectionOwning,
  };
}

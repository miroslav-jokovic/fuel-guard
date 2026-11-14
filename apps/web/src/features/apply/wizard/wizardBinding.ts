import type { FactPath, RowKind, WizardScreenId } from "@silvicom/shared";
import type { SectionIssue } from "@/features/apply/useApplicationWizard";

/**
 * What a generated screen needs from the page it is on (F4 PR 1): how to read and write a fact's
 * answer, the words its control shows, the problem found with it, and its control's DOM id.
 *
 * ⚠ The screen knows facts by catalogue path and nothing else. Part 1's page holds its answers in its
 * own shape (`partOneFields.ts`); Part 2's draft holds them in the contract's (`draftFields.ts`). A binding is the
 * one place each page says where its answers are, so `WizardScreen` is the same component on both.
 */
export interface FieldCopy {
  readonly label: string;
  readonly hint?: string;
  /** A choice's answer in words, by value. Absent: the value is its own word (a CDL class's letter). */
  readonly options?: Readonly<Record<string, string>>;
  /** The browser's autofill name for it — `address-line1`, `bday`, `off` for a licence number. */
  readonly autocomplete?: string;
  readonly placeholder?: string;
  /**
   * How a phone's keyboard capitalizes it (U3): `words` for a name or a city, `characters` for a licence
   * number — which also turns autocorrect off, since a licence number is not a word to be corrected.
   */
  readonly capitalize?: "words" | "characters";
}

/**
 * `row` is the row a loop screen asks about (Stage 2, F4 PR 1b-1): `application.accidents[].nature` on
 * row 2 is the third accident's. A page with no loops (Part 1's) ignores it.
 */
export interface WizardBinding {
  read(path: FactPath, row?: number): unknown;
  write(path: FactPath, value: unknown, row?: number): void;
  /**
   * `screen`: where it is asked. One fact asked on two screens has each screen's own words — the month a
   * home begins is "When did you move in?" for the home lived in now and "From" for an earlier one.
   */
  copy(path: FactPath, screen?: WizardScreenId): FieldCopy;
  error(path: FactPath, row?: number): string | undefined;
  id(path: FactPath, row?: number): string;
  /** Which kind a list's row is (`FactAsk.rows`). Absent on a page whose lists hold one kind of row. */
  rowKind?(list: string, row: number): RowKind;
  /**
   * What is wrong with ONE row, judged alone by its own schema. The task's check drops a row nothing was
   * typed in (an accidental "Add another" is not a declaration), which is right for a list and wrong for
   * the row the walk has on show: that one was asked for, and Continue must not pass it blank.
   */
  rowIssues?(list: string, row: number): SectionIssue[];
  /** Where a fact's problem is reported, when that is not simply where its answer lives. */
  path?(path: FactPath, row?: number): readonly (string | number)[];
  /** Bring derived rows up to date with the answers (the gaps a job's dates leave). Idempotent. */
  settle?(): void;
  /** A task is being opened: put its answers in the state the walk starts from. */
  open?(task: string): void;
}

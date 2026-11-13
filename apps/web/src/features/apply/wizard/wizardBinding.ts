import type { FactPath } from "@silvicom/shared";

/**
 * What a generated screen needs from the page it is on (F4 PR 1): how to read and write a fact's
 * answer, the words its control shows, the problem found with it, and its control's DOM id.
 *
 * ⚠ The screen knows facts by catalogue path and nothing else. Part 1's page holds its answers in its
 * own shape (`partOneFields.ts`); Part 2's draft will hold them in the contract's. A binding is the
 * one place each page says where its answers are, so `WizardScreen` is the same component on both.
 */
export interface FieldCopy {
  readonly label: string;
  readonly hint?: string;
  /** A choice's answer in words, by value. Absent: the value is its own word (a CDL class's letter). */
  readonly options?: Readonly<Record<string, string>>;
  /** The browser's autofill name for it — `address-line1`, `bday`, `off` for a licence number. */
  readonly autocomplete?: string;
}

export interface WizardBinding {
  read(path: FactPath): unknown;
  write(path: FactPath, value: unknown): void;
  copy(path: FactPath): FieldCopy;
  error(path: FactPath): string | undefined;
  id(path: FactPath): string;
}

import type { FactPath } from "@silvicom/shared";
import { APPLY_COPY } from "@/features/apply/strings";
import type { PartOneAnswers } from "@/features/apply/partOne/partOneScreens";
import type { FieldCopy, WizardBinding } from "./wizardBinding";

/**
 * Stage 1's facts on Part 1's page (F4 PR 1): where each one's answer lives in `PartOneAnswers`, and
 * the words its control shows.
 *
 * ── WHERE THE ANSWER LIVES — derived, two exceptions ─────────────────────────────────────────
 * `intake.<key>` is `answers.<key>`. The current CDL is the one place the page's shape differs from the
 * contract's: the contract holds it as row 0 of `licences[]` beside two of its own top-level keys
 * (`cdl_class`, `endorsements`), and the page holds all of them under `cdl`, because that is what
 * the CDL's barcode fills and what `licenceList` posts first. The other licences are not answered
 * through this binding at all — they are the loop's, `PartOneOtherLicences` (`ASKED_BY_HAND`).
 *
 * ── THE WORDS ARE REFERENCES INTO `APPLY_COPY` ─────────────────────────────────────────────────
 * `fieldLabels.ts`'s rule, for the same reason: the label above a box and the error that names it
 * must be the same words, so each entry below points at the copy the field always rendered — never a
 * second copy of it. Built on every call, so the language is the page's (C4).
 */

/** `intake.phone` → `phone`; the CDL's columns → `cdl.<column>`. The dotted key is also the barcode's (`PREFILL_FIELDS`). */
export function partOneAnswerKey(path: FactPath): string {
  const key = path.slice("intake.".length).replace(/\[\]$/, "");
  if (key.startsWith("licences[].")) return `cdl.${key.slice("licences[].".length)}`;
  if (key === "cdl_class" || key === "endorsements") return `cdl.${key}`;
  return key;
}

/** The key Part 1's checks report a field's problem under (`validateAbout` …): the key's last part. */
export const partOneErrorKey = (path: FactPath): string => partOneAnswerKey(path).split(".").pop()!;

function holder(answers: PartOneAnswers, key: string): [Record<string, unknown>, string] {
  const parts = key.split(".");
  const last = parts.pop()!;
  const at = parts.reduce<Record<string, unknown>>((o, p) => o[p] as Record<string, unknown>, answers as never);
  return [at, last];
}

const fieldCopy = (): Record<FactPath, FieldCopy> => {
  const { about, address, licence, screening } = APPLY_COPY.partOne;
  return {
    "intake.phone": { label: about.phone, hint: about.phoneHint, autocomplete: "tel-national" },
    "intake.date_of_birth": { label: about.dateOfBirth, hint: about.dateOfBirthHint, autocomplete: "bday" },
    "intake.address_line1": { label: address.line1, autocomplete: "address-line1" },
    "intake.address_line2": { label: address.line2, autocomplete: "address-line2" },
    "intake.city": { label: address.city, autocomplete: "address-level2" },
    "intake.state": { label: address.state },
    "intake.postal_code": { label: address.postalCode, autocomplete: "postal-code" },
    "intake.licences[].state_code": { label: licence.state, hint: licence.stateHint },
    "intake.licences[].licence_number": { label: licence.number, autocomplete: "off" },
    // A class is its own letter, in every language.
    "intake.cdl_class": { label: licence.cdlClass },
    "intake.licences[].expires_on": { label: licence.expiresOn },
    "intake.endorsements[]": { label: licence.endorsements, options: licence.endorsementLabels },
    "intake.prior_positive_2y": { label: screening.priorPositive },
    "intake.dot_program_30d": { label: screening.program30d, hint: screening.programHint },
    "intake.dot_tested_6m": { label: screening.tested6m },
    "intake.dot_random_12m": { label: screening.random12m },
    // UX5b (D-MSUX10): for Med-Stop's donor record and an observed collection; never shown to the
    // person deciding the hire. Declining is an answer.
    "intake.donor_gender": { label: screening.gender, hint: screening.genderHint, options: screening.genderOptions },
  };
};

/** The paths this page can answer — what the binding test holds the catalogue's Stage 1 screens to. */
export const PART_ONE_BOUND_PATHS = (): FactPath[] => Object.keys(fieldCopy());

/** Part 1's answers, as the generated screens read and write them. */
export function partOneBinding(answers: () => PartOneAnswers, errors: () => Record<string, string>): WizardBinding {
  return {
    read: (path) => {
      const [at, last] = holder(answers(), partOneAnswerKey(path));
      return at[last];
    },
    write: (path, value) => {
      const [at, last] = holder(answers(), partOneAnswerKey(path));
      at[last] = value;
    },
    copy: (path) => {
      const found = fieldCopy()[path];
      if (!found) throw new Error(`No words for ${path} on Part 1's page — add it to partOneFields.ts.`);
      return found;
    },
    error: (path) => errors()[partOneErrorKey(path)],
    // `p1-state` and `p1-phone` are the ids the page always had; the CDL's are `p1-cdl-<column>`.
    id: (path) => `p1-${partOneAnswerKey(path).replace(/\./g, "-")}`,
  };
}

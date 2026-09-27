import { composeFiledApplication, jurisdictionName, type PartOneFactsView, type PartOneLicence } from "@silvicom/shared";
import { formatPhone } from "@/lib/format";
import type { ApplicationDraft, DraftAddress, DraftLicence } from "./draft";
import { showDate } from "./reviewSummary";
import { APPLY_COPY } from "./strings";

/**
 * A v2 applicant's working draft with Part 1's facts laid over it (C3c2c2, Q-AW34) — through FILING's
 * own `composeFiledApplication`, so what the page shows, checks and sends is the document filing will
 * compose, and never a second opinion about which of the two copies wins.
 *
 * ── WHY THE FACTS GO INTO THE DRAFT AT ALL ────────────────────────────────────────────────────
 * Every screen, the task list's statuses, the review, the sign-off summary and both send acts read the
 * draft, and the contract requires the phone and the CDL — which Part 2 no longer asks on a v2 link. So
 * the facts are laid in once, when the unlock releases them, and every reader agrees. It is a COPY, and
 * it cannot go stale where it matters: it is re-laid on every unlock, filing lays Part 1 over whatever
 * was sent, and the office's drawer composes from Part 1 itself. The precedent is the identity overlay
 * (`identityOnRecord`), which has put `drivers`' date of birth and licence into every draft since AF3.
 *
 * ⚠ The draft is draft-SHAPED — strings, "" for nothing — and composition writes contract nulls
 * (Part 1's blank second address line, a licence's kind), so those are turned back into "" here. That is
 * the one thing this adds; everything it lays over is composition's decision.
 */
export function applyPartOne(draft: ApplicationDraft, facts: PartOneFactsView): void {
  const { application } = composeFiledApplication(
    {
      phone: draft.phone,
      addresses: draft.addresses,
      cdl_number: draft.cdl_number,
      cdl_state: draft.cdl_state,
      cdl_class: draft.cdl_class,
      cdl_expires_at: draft.cdl_expires_at,
      additional_licences: draft.additional_licences,
      prior_failed_pre_employment_test: draft.prior_failed_pre_employment_test,
    },
    facts.intake,
    facts.licences,
    facts.asOf,
  );
  draft.phone = application.phone;
  draft.addresses = application.addresses.map((a): DraftAddress => ({ ...a, line2: a.line2 ?? "", to: a.to ?? "" }));
  draft.cdl_number = application.cdl_number;
  draft.cdl_state = application.cdl_state;
  draft.cdl_class = application.cdl_class ?? "";
  draft.cdl_expires_at = application.cdl_expires_at;
  draft.additional_licences = application.additional_licences.map(
    (l): DraftLicence => ({ ...l, kind: l.kind ?? "" }),
  );
  draft.prior_failed_pre_employment_test = application.prior_failed_pre_employment_test ?? false;
}

/**
 * Is this address the one Part 1 recorded — where the applicant lives NOW? Composition's own test (the
 * current entry is the one with no end month), so the panel locks exactly the address filing replaces.
 */
export const isCurrentAddress = (address: DraftAddress): boolean => address.to.trim() === "";

/** One line of the read-only card. */
export interface FactRow {
  label: string;
  value: string;
}

/**
 * "About you": the date of birth and the phone, as Part 1 recorded them. The date of birth is the
 * draft's — `drivers`' value, which every save lays in (`identityOnRecord`) — and the phone Part 1's.
 */
export function aboutYouRows(draft: ApplicationDraft, facts: PartOneFactsView): FactRow[] {
  const copy = APPLY_COPY.partOneFacts;
  return [
    { label: copy.dateOfBirth, value: showDate(draft.date_of_birth) },
    { label: copy.phone, value: formatPhone(facts.intake.phone) },
  ];
}

/**
 * "Your licences": every licence Part 1 recorded, the CDL first. All of them, not only the ones filed —
 * Part 1 asked for every licence held in three years, because the record is checked in each state —
 * with each other licence saying whether the application lists it: (b)(5) takes the UNEXPIRED ones, and
 * `composeFiledApplication` cannot place one with no expiry (Q-AW35). The same day composition cuts on.
 */
export function licenceRows(facts: PartOneFactsView): FactRow[] {
  const copy = APPLY_COPY.partOneFacts;
  const ordered = [...facts.licences].sort((a, b) => a.position - b.position);
  const describe = (l: PartOneLicence, extra: string[]): string =>
    [jurisdictionName(l.state_code) ?? l.state_code, l.agency, l.licence_number, ...extra].filter(Boolean).join(" · ");
  const expiry = (l: PartOneLicence): string =>
    !l.expires_on ? copy.noExpiry : l.expires_on < facts.asOf ? copy.expired : copy.expires(showDate(l.expires_on));

  const [cdl, ...others] = ordered;
  const rows: FactRow[] = [];
  if (cdl && cdl.position === 0) {
    const cdlClass = facts.intake.cdl_class?.trim();
    rows.push({ label: copy.cdl, value: describe(cdl, [cdlClass ? copy.classLabel(cdlClass) : "", expiry(cdl)]) });
  }
  const rest = cdl && cdl.position === 0 ? others : ordered;
  if (rest.length === 0) rows.push({ label: copy.otherLicences, value: copy.noOtherLicences });
  for (const l of rest) rows.push({ label: copy.otherLicences, value: describe(l, [expiry(l)]) });
  return rows;
}

/**
 * The street filing lays over a CURRENT address — derived by composing one probe address through
 * `composeFiledApplication`, so the panel locks exactly when, and exactly to what, filing would replace.
 * Null when Part 1's address is incomplete: composition then files what the applicant typed.
 */
export function partOneStreet(facts: PartOneFactsView): Pick<DraftAddress, "line1" | "line2" | "city" | "state" | "postal_code"> | null {
  const probe = { line1: "", line2: null, city: "", state: "", postal_code: "", from: "2000-01", to: null };
  const { application } = composeFiledApplication(
    {
      phone: "", addresses: [probe], cdl_number: "", cdl_state: "", cdl_class: null, cdl_expires_at: "",
      additional_licences: [], prior_failed_pre_employment_test: null,
    },
    facts.intake, [], facts.asOf,
  );
  const street = application.addresses[0]!;
  if (street === probe) return null;
  return { line1: street.line1, line2: street.line2 ?? "", city: street.city, state: street.state, postal_code: street.postal_code };
}

import type { ApplicantIdentity } from "./applicantIdentity.js";
import type { PartOneCorrection } from "./applicantScreeningContract.js";
import type { PartOneFacts, PartOneFactsView, PartOneLicence } from "./applicationComposition.js";
import type { ApplicationPath } from "./applicationReviewContract.js";

/**
 * What an office correction of Part 1 or of the identity changed, as `application_edits` rows
 * (APPLICATION-FIX-PLAN F3, E7; D-AM7).
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────
 * Until F3 only the draft's own corrections (`editApplication`) wrote an `application_edits` row. The
 * office's Part 1 correction (`correctApplicantPartOne`) and its identity correction
 * (`correctApplicantIdentity`) wrote an audit row naming the FIELDS and nothing else — so a phone, an
 * address or a licence number the office changed reached the signed application without the driver
 * ever being shown it on the signing screen. That is the one thing 0337 exists to prevent: §391.21(b)(12)
 * has the driver certify the entries are true, and they can only honestly certify a change they saw.
 *
 * ── WHY THE ROWS ARE ADDRESSED BY THE APPLICATION'S PATH, NOT PART 1'S ────────────────────────
 * The driver reads the application, not the intake table. `intake.phone` composes into the application's
 * `phone` (`composeFiledApplication`; the catalogue's `through`), so the row says `["phone"]` — which
 * `fieldLabels.ts` already turns into the words the driver's own screen used, on 3.1 and in the office's
 * "What you changed". A Part 1 path would need a second labeller for the same fact.
 *
 * ⚠ The mapping below restates `composeFiledApplication`'s, and the tests hold the two together
 * ("every Part 1 change is addressed where composition files it"). Composition is the source; when it
 * moves a fact, that test fails here.
 *
 * ⚠ Values, not names, go in these rows, unlike the audit row beside them (`apps/api/CLAUDE.md`):
 * `application_edits` is the driver's own answers, read only server-side and shown only to the office
 * that holds them and to the driver who gave them — the same rows every draft correction has written
 * since 0337.
 */
export interface FactEditRow {
  path: ApplicationPath;
  before: unknown;
  after: unknown;
  /** The office's reason (0586): required on the driver's own statements (the catalogue's `statement`). */
  note?: string | null;
  /** Record only THAT it changed (0586): a `replace_only` answer. `before` and `after` are dropped. */
  withheld?: boolean;
}

/** Blank, absent and null are one answer: none. */
const norm = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === "" ? null : t;
};

/** Part 1's street → the current address's column (`composeFiledApplication`'s current-address overlay). */
const STREET: ReadonlyArray<readonly [keyof PartOneCorrection & keyof PartOneFacts, string]> = [
  ["address_line1", "line1"],
  ["address_line2", "line2"],
  ["city", "city"],
  ["state", "state"],
  ["postal_code", "postal_code"],
];

/** Part 1's position-0 licence → the application's CDL columns. `agency` of the current CDL is filed nowhere. */
const CURRENT_CDL: ReadonlyArray<readonly ["state_code" | "licence_number" | "expires_on", string]> = [
  ["state_code", "cdl_state"],
  ["licence_number", "cdl_number"],
  ["expires_on", "cdl_expires_at"],
];

type LicenceLike = Pick<PartOneLicence, "state_code" | "licence_number"> & {
  agency?: string | null;
  expires_on?: string | null;
};

/** An other licence as the application files it — `composeFiledApplication`'s `additional_licences` row. */
const asFiledLicence = (l: LicenceLike | undefined) =>
  l === undefined
    ? null
    : { issuing_authority: norm(l.agency) ?? l.state_code, number: l.licence_number, expires_at: norm(l.expires_on) };

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The rows for one Part 1 correction.
 *
 * `currentAddress` is the draft's index of the address with no `to` — the row composition lays Part 1's
 * street over. A draft with no current address yet still has the street on file, so it is 0.
 *
 * ⚠ Other licences are compared by POSITION and logged as whole rows: adding, removing or re-ordering
 * one is a change to the list, and the driver is shown the licence as it was and as it is. They are
 * logged at their place in Part 1's list (`additional_licences[k-1]` for position k), not after
 * composition's expiry cut — a licence that expired is still the driver's answer, and it is still
 * what the MVR is ordered from.
 */
export function partOneEdits(
  before: { intake: Pick<PartOneFacts, "phone" | "cdl_class" | "address_line1" | "address_line2" | "city" | "state" | "postal_code">; licences: readonly PartOneLicence[] },
  after: PartOneCorrection,
  currentAddress: number,
): FactEditRow[] {
  const out: FactEditRow[] = [];
  const scalar = (path: ApplicationPath, was: string | null | undefined, now: string | null | undefined) => {
    if (norm(was) !== norm(now)) out.push({ path, before: norm(was), after: norm(now) });
  };

  scalar(["phone"], before.intake.phone, after.phone);
  for (const [from, column] of STREET) {
    scalar(["addresses", currentAddress, column], before.intake[from], after[from]);
  }
  scalar(["cdl_class"], before.intake.cdl_class, after.cdl_class);

  const ordered = [...before.licences].sort((a, b) => a.position - b.position);
  const [wasCurrent, ...wasOthers] = ordered;
  const [nowCurrent, ...nowOthers] = after.licences;
  for (const [from, column] of CURRENT_CDL) {
    scalar([column], wasCurrent?.[from], nowCurrent?.[from]);
  }
  // F3c part 2 (E2): ONE licence taken out is one removal row, not a shift of every licence after it
  // ("Licence 2 was X, now Y; Licence 3 was Y, now nothing") — the driver reads one act as one line,
  // and `currentEditPaths` replays it like the draft's own `remove_row`.
  const was = wasOthers.map(asFiledLicence);
  const now = nowOthers.map(asFiledLicence);
  const removed = now.length === was.length - 1
    ? was.findIndex((_, k) => same([...was.slice(0, k), ...was.slice(k + 1)], now))
    : -1;
  if (removed >= 0) {
    out.push({ path: ["additional_licences", removed], before: was[removed], after: null });
    return out;
  }
  for (let k = 0; k < Math.max(was.length, now.length); k++) {
    if (!same(was[k] ?? null, now[k] ?? null)) out.push({ path: ["additional_licences", k], before: was[k] ?? null, after: now[k] ?? null });
  }
  return out;
}

/** An other licence as the card types it: the application's `additional_licences` row. */
export interface OtherLicenceRow {
  issuing_authority: string;
  number: string;
  expires_at: string;
}

/**
 * The Part 1 correction body with one other licence added at the end, or the one at `remove` taken out
 * (F3c part 2, E2) — on a v2 link the licences are Part 1's whole list, so a licence row is added or
 * removed through `partOneCorrectionSchema`, never the draft (whose copy filing drops). Position 0 is
 * the current CDL and is never removed here; the other licences are `additional_licences[k]` = position
 * k + 1. Not parsed: the caller runs the schema, so a blank or a duplicate is refused in its own words.
 */
export function partOneLicencesWith(
  view: Pick<PartOneFactsView, "intake" | "licences">,
  change: { add: OtherLicenceRow } | { remove: number },
  currentAddress: number,
): Record<string, unknown> | null {
  const body = partOneCorrectionWith(view, ["phone"], view.intake.phone ?? null, currentAddress);
  if (!body) return null;
  const licences = [...(body.licences as Array<Record<string, unknown>>)];
  if ("add" in change) {
    licences.push({ state_code: change.add.issuing_authority, agency: null, licence_number: change.add.number, expires_on: change.add.expires_at || null });
  } else {
    if (!licences[change.remove + 1]) return null;
    licences.splice(change.remove + 1, 1);
  }
  return { ...body, licences };
}

/** The rows for one identity correction: the date of birth and the current licence, each by its own key. */
export function identityEdits(
  before: Partial<Record<keyof ApplicantIdentity, string | null>>,
  after: ApplicantIdentity,
): FactEditRow[] {
  const out: FactEditRow[] = [];
  for (const key of ["date_of_birth", "cdl_number", "cdl_state"] as const) {
    const was = norm(before[key]);
    const now = norm(after[key]);
    if (was !== now) out.push({ path: [key], before: was, after: now });
  }
  return out;
}

/**
 * The other direction: the office changed ONE answer, addressed as the application files it, and the
 * Part 1 correction route takes the whole set (`partOneCorrectionSchema`). This builds that set from
 * what Part 1 holds, with the one answer changed — from the same two tables `partOneEdits` reads, so a
 * path this accepts is one `partOneEdits` logs back at the same place ("round-trips every Part 1 path").
 *
 * Returns null for a path Part 1 does not hold: the caller corrects it in the draft instead.
 * `currentAddress` is the draft index of the current home, as in `partOneEdits`. An other licence's
 * `issuing_authority` is its state or province: the code, which composition files when no agency is named.
 *
 * The result is NOT parsed here: the caller runs `partOneCorrectionSchema` over it, so a blank the
 * contract refuses is a refusal the office reads, never a silent default.
 */
export function partOneCorrectionWith(
  view: Pick<PartOneFactsView, "intake" | "licences">,
  path: ApplicationPath,
  value: string | null,
  currentAddress: number,
): Record<string, unknown> | null {
  const { intake } = view;
  const licences = [...view.licences]
    .sort((a, b) => a.position - b.position)
    .map((l) => ({ state_code: l.state_code, agency: l.agency, licence_number: l.licence_number, expires_on: l.expires_on }));
  const body: Record<string, unknown> = {
    phone: intake.phone, address_line1: intake.address_line1, address_line2: intake.address_line2,
    city: intake.city, state: intake.state, postal_code: intake.postal_code, cdl_class: intake.cdl_class, licences,
  };
  const [head, at, column] = path;

  if (path.length === 1 && (head === "phone" || head === "cdl_class")) {
    body[head] = value;
    return body;
  }
  if (head === "addresses" && at === currentAddress && path.length === 3) {
    const street = STREET.find(([, c]) => c === column);
    if (!street) return null;
    body[street[0]] = value;
    return body;
  }
  const cdl = path.length === 1 ? CURRENT_CDL.find(([, c]) => c === head) : undefined;
  if (cdl && licences[0]) {
    licences[0] = { ...licences[0], [cdl[0]]: value };
    return body;
  }
  if (head === "additional_licences" && typeof at === "number" && licences[at + 1]) {
    const k = at + 1;
    const now = licences[k]!;
    if (column === "issuing_authority") licences[k] = { ...now, state_code: value ?? "", agency: null };
    else if (column === "number") licences[k] = { ...now, licence_number: value ?? "" };
    else if (column === "expires_at") licences[k] = { ...now, expires_on: value };
    else return null;
    return body;
  }
  return null;
}

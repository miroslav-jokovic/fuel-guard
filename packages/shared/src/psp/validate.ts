import { dateOfBirthIssue } from "../rosterContract.js";

/**
 * Pre-flight validation for a PSP record request — a COST CONTROL, not form polish.
 *
 * §8 of the PSP guide: *"Accounts are charged the transaction fee for 'Success,' 'Partial' and
 * 'Failure' response statuses."* A `Failure` is what PSP returns when it looked and found nothing —
 * which is exactly what a mistyped licence number produces. Status `2` (Error) is not on that list,
 * so a request PSP rejects as malformed is free.
 *
 * So every rule here is one PSP would have charged us to discover, or one it would have refused for
 * free that we can refuse faster. Each cites the §8.5 detail code it prevents, which is also how the
 * list stays honest: a rule with no code behind it is a rule we invented.
 *
 * Pure, so the whole thing is testable without a vendor, a database or a credential.
 */

export interface PspLicenceQuery {
  dlNum: string;
  dlState: string;
  dlFirstName: string;
  dlLastName: string;
}

export interface PspRequestDraft {
  driverFirstName: string;
  driverLastName: string;
  /** ISO `YYYY-MM-DD`. Converted to PSP's format at the edge, validated as ours here. */
  driverDOB: string;
  dotNumber?: string | null;
  motorCarrierId?: string | null;
  internalRefId: string;
  licenseQueries: readonly PspLicenceQuery[];
  driverConsent: boolean;
}

export interface PspValidationIssue {
  field: string;
  message: string;
  /** The §8.5 statusDetail this rule prevents. */
  preventsDetail: number;
}

/**
 * §8.5 detail 8 — "not valid US state, CA province, US territory, or 'MX.'"
 *
 * Enumerated rather than regex-checked because "two letters" admits `XX`, and PSP charges nothing to
 * reject it but the operator still waits for a round trip to learn they typed a nonsense state.
 */
export const PSP_JURISDICTIONS: readonly string[] = [
  // US states + DC
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA",
  "ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR",
  "PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
  // US territories
  "AS","GU","MP","PR","VI",
  // Canadian provinces and territories
  "AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT",
  // Mexico, as one jurisdiction (§8.5 detail 8 names it explicitly)
  "MX",
];
const JURISDICTION_SET = new Set(PSP_JURISDICTIONS);

/** §8.5 details 2 and 25: "only letters, hyphens (-) and apostrophes (')". */
const NAME_OK = /^[A-Za-z' -]+$/;
/** §8.5 details 5 and 26 — the LICENCE names: "only letters and numbers". A different rule from the
 *  driver's own name, and the guide means it: the two error messages differ on exactly this. */
const LICENCE_NAME_OK = /^[A-Za-z0-9 ]+$/;
/** §8.5 details 4 and 24: invalid characters, or over 25. */
const LICENCE_NUM_OK = /^[A-Za-z0-9-]+$/;

export function validatePspRequest(draft: PspRequestDraft, today: string): PspValidationIssue[] {
  const issues: PspValidationIssue[] = [];
  const add = (field: string, message: string, preventsDetail: number) =>
    issues.push({ field, message, preventsDetail });

  // §391 and §5.4.1 both put the carrier's identity on the request; PSP refuses without one (10).
  if (!draft.dotNumber?.trim() && !draft.motorCarrierId?.trim()) {
    add("dotNumber", "A DOT number or Motor Carrier ID is required", 10);
  }

  // The consent gate. This duplicates the API's authorization check on purpose — one is a policy
  // decision about our records, this is a fact about the bytes we are about to send, and PSP rejects
  // the request outright when it is false (17).
  if (!draft.driverConsent) {
    add("driverConsent", "The driver's disclosure and authorization is required before a PSP request", 17);
  }

  if (!draft.driverFirstName.trim() || draft.driverFirstName.length > 20) {
    add("driverFirstName", "First name is required and may not exceed 20 characters", 2);
  } else if (!NAME_OK.test(draft.driverFirstName)) {
    add("driverFirstName", "First name may contain only letters, hyphens and apostrophes", 2);
  }

  if (!draft.driverLastName.trim() || draft.driverLastName.length > 20) {
    add("driverLastName", "Last name is required and may not exceed 20 characters", 25);
  } else if (!NAME_OK.test(draft.driverLastName)) {
    add("driverLastName", "Last name may contain only letters, hyphens and apostrophes", 25);
  }

  // Details 1 and 27 together: a real date, and a driver at least 18. `dateOfBirthIssue` is the
  // roster's own rule, reused rather than restated — the whole reason it takes `today` as an argument.
  if (!draft.driverDOB) {
    add("driverDOB", "A date of birth is required", 1);
  } else {
    const issue = dateOfBirthIssue(draft.driverDOB, today);
    if (issue) add("driverDOB", issue, issue.includes("18") ? 27 : 1);
  }

  if (draft.internalRefId.length > 256) {
    add("internalRefId", "Internal reference may not exceed 256 characters", 3);
  }

  if (draft.licenseQueries.length === 0) {
    add("licenseQueries", "At least one licence is required", 4);
  }

  draft.licenseQueries.forEach((q, i) => {
    const at = (f: string) => `licenseQueries[${i}].${f}`;
    if (!q.dlNum.trim() || q.dlNum.length > 25) {
      add(at("dlNum"), "Licence number is required and may not exceed 25 characters", 24);
    } else if (!LICENCE_NUM_OK.test(q.dlNum)) {
      add(at("dlNum"), "Licence number may contain only letters, numbers and hyphens", 24);
    }
    if (!JURISDICTION_SET.has(q.dlState.toUpperCase())) {
      add(at("dlState"), `${q.dlState || "(empty)"} is not a US state, territory, Canadian province or MX`, 8);
    }
    if (!q.dlLastName.trim() || q.dlLastName.length > 20) {
      add(at("dlLastName"), "Licence last name is required and may not exceed 20 characters", 26);
    } else if (!LICENCE_NAME_OK.test(q.dlLastName)) {
      add(at("dlLastName"), "Licence last name may contain only letters and numbers", 26);
    }
    if (q.dlFirstName && !LICENCE_NAME_OK.test(q.dlFirstName)) {
      add(at("dlFirstName"), "Licence first name may contain only letters and numbers", 5);
    }
  });

  return issues;
}

/**
 * §5: *"If there are any validation issues with any of the driver record requests, the entire request
 * is cancelled."* The endpoint takes an array and one bad row voids the batch — so batching a nightly
 * sweep of 200 drivers means one bad date of birth kills 199 good requests.
 *
 * Stated as a constant rather than a comment because it is a rule about how the client may be USED,
 * and the client asserts it.
 */
export const PSP_MAX_DRIVERS_PER_REQUEST = 1;

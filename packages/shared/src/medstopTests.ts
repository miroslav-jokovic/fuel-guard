/**
 * What a Med-Stop test's result MEANS — classified once, here (MEDSTOP-PLAN.md §6 F-4/F-5).
 *
 * Med-Stop sends the result as free text (`/Test/list` `result`), and three different things act on
 * it: the hiring step files a verified negative, the DER is told about a positive, a refusal or a
 * dilute, and dispatch stops a driver until return-to-duty is documented. If each of them read the
 * string itself, "NEGATIVE - DILUTE" would be a negative in one place and an alert in another. So
 * every reader asks `medstopTestOutcome`, and nothing else in the product compares a result string.
 *
 * ── ⚠ A DRUG RESULT IS NOT FINAL UNTIL MED-STOP CLOSES THE TEST ──────────────────────────────────
 * Measured 2026-10-13 over twelve months (453 tests): every drug test (TD) with a result was CLOSED;
 * the four COMPLETED and one OPEN had none. A lab result before the MRO's review is not a verified
 * result (§40.129) and must never file a record or stop a driver, so a TD result counts only at
 * REVIEWED or CLOSED. An alcohol test (TA) has no MRO — the breath-alcohol technician's result is the
 * result — and all 23 measured carried it at COMPLETED.
 *
 * ── ⚠ AN UNKNOWN WORDING IS NOT A NEGATIVE ───────────────────────────────────────────────────────
 * The wordings below are the twelve months' (NEGATIVE ×423, NEGATIVE - DILUTE ×10, POSITIVE ×5,
 * CANCELED ×3, NOT REFUSAL ×3) plus `/List/RESULTDER`'s "REFUSAL TO TEST", which the year did not
 * contain. A final result in any other words is `unrecognised`, which the DER is told about — a new
 * Med-Stop wording must cost one notification, not a silently filed negative.
 */

export type MedstopTestOutcome =
  | "pending"
  | "negative"
  | "negative_dilute"
  | "positive"
  | "refusal"
  | "not_refusal"
  | "cancelled"
  | "medical"
  | "unrecognised";

export interface MedstopTestFacts {
  /** TD drug · TA alcohol · TM medical examination. */
  service: string | null;
  status: string | null;
  result: string | null;
}

const VERIFIED_DRUG_STATUSES = new Set(["REVIEWED", "CLOSED"]);

export function medstopTestOutcome(test: MedstopTestFacts): MedstopTestOutcome {
  const result = test.result?.trim().toUpperCase() ?? "";
  if (!result) return "pending";
  if (test.service === "TM") return "medical";
  if (test.service !== "TA" && !VERIFIED_DRUG_STATUSES.has(test.status?.trim().toUpperCase() ?? "")) return "pending";
  // Order matters: "NEGATIVE - DILUTE" starts with NEGATIVE, "NOT REFUSAL" contains REFUSAL.
  if (/^NEGATIVE\s*-\s*DILUTE/.test(result)) return "negative_dilute";
  if (/^NEGATIVE\b/.test(result)) return "negative";
  if (/^POSITIVE\b/.test(result)) return "positive";
  if (/^NOT REFUSAL\b/.test(result)) return "not_refusal";
  if (/\bREFUS/.test(result)) return "refusal";
  if (/^(TEST )?CANCEL/.test(result)) return "cancelled";
  return "unrecognised";
}

/**
 * A request Med-Stop closed as a refusal never gets a test row — the donor refused before a specimen
 * existed — so the refusal lives on the REQUEST (`STATUSREQUEST` REFUSAL). None in 2,152 requests
 * (2026-10-13); handled because §40.191 makes it the same violation as a refused specimen.
 */
export const medstopRequestRefused = (status: string | null): boolean => status?.trim().toUpperCase() === "REFUSAL";

/** Outcomes that are a DOT drug-and-alcohol programme violation (§382.211/§382.215, §40.191). */
export const isMedstopViolation = (outcome: MedstopTestOutcome): boolean => outcome === "positive" || outcome === "refusal";

/**
 * Outcomes the DER is told about the hour Med-Stop knows them: the two violations, a dilute (the MRO
 * may direct a recollection, §40.197), and a wording nobody has classified yet.
 */
export const isMedstopDerAlert = (outcome: MedstopTestOutcome): boolean =>
  isMedstopViolation(outcome) || outcome === "negative_dilute" || outcome === "unrecognised";

/**
 * Collection → closed, pre-employment drug tests, n=25, measured 2026-10-13 (§5A): median 61 h,
 * p90 93 h. "Expected by" uses the p90: a date the result is late after, not one it is usually ready
 * on — a recruiter told "Thursday" who has it Wednesday is pleased; one told "Wednesday" calls.
 */
export const MEDSTOP_RESULT_HOURS = { p50: 61, p90: 93 } as const;

/**
 * The day a drug test's verified result is expected, from Med-Stop's zoneless collection stamp.
 * Day arithmetic only: the stamp is read as a wall-clock time and moved by whole hours, never
 * converted to an instant, so no zone is invented. Null for anything but a drug test (an alcohol
 * result exists at collection) and for a stamp we cannot read.
 */
export function medstopResultExpectedOn(service: string | null, collectedLocal: string | null): string | null {
  if (service !== "TD" || !collectedLocal) return null;
  const wall = Date.parse(`${collectedLocal.slice(0, 19)}Z`);
  if (!Number.isFinite(wall)) return null;
  return new Date(wall + MEDSTOP_RESULT_HOURS.p90 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Does this outcome file the hiring step's `drug_test` record by itself (F-4)? Only a verified
 * NEGATIVE on a PRE-EMPLOYMENT drug test: that is §382.301's record and the one `hiringChecklist`
 * reads. A random negative is the pool's business (F-2), not a qualification record, and an alcohol
 * pre-employment test is optional (§382.301(d)) — neither is filed here.
 */
export const medstopFilesHiringDrugTest = (
  test: { service: string | null; reason: string | null },
  outcome: MedstopTestOutcome,
): boolean => outcome === "negative" && test.service === "TD" && test.reason?.trim().toUpperCase() === "PRE-EMPLOYMENT";

const OUTCOME_WORDS: Partial<Record<MedstopTestOutcome, string>> = {
  positive: "verified positive",
  refusal: "refusal to test",
  negative_dilute: "negative-dilute",
  unrecognised: "a result Silvicom 360 does not recognise",
};

export interface MedstopResultNoticeInput {
  outcome: MedstopTestOutcome;
  service: string | null;
  reason: string | null;
  /** MM/DD/YYYY, already formatted by the caller (`formatDisplayDate`), or null. */
  collectedOn: string | null;
  /** Our driver's name when matched, else Med-Stop's; null if neither is known. */
  personName: string | null;
  /** True when the sweep held the driver out of dispatch (a violation on a certain match). */
  dispatchStopped: boolean;
}

export interface MedstopResultNotice {
  title: string;
  body: string;
  severity: "critical" | "warning";
}

/**
 * The DER's notification (F-5). ⚠ Sent ONLY to the roles `canReadTestingRecords` admits, which is
 * why — unlike the dispatcher's and the recruiter's copy — it says what the result is: the DER is the
 * person who must act on it (§382.211 removal, §40.287 SAP referral), and a notice that made them
 * open a page to learn whether to act would be half a notice.
 */
const article = (phrase: string): string => (/^[aeiou]/i.test(phrase) ? "an" : "a");

export function medstopResultNotice(input: MedstopResultNoticeInput): MedstopResultNotice {
  const kind = input.service === "TA" ? "alcohol" : "drug";
  const reason = input.reason?.trim().toLowerCase();
  const what = OUTCOME_WORDS[input.outcome] ?? input.outcome;
  const who = input.personName?.trim() || "A person on Med-Stop's roster";
  const when = input.collectedOn ? ` collected ${input.collectedOn}` : "";
  const test = reason ? `${reason} ${kind}` : kind;
  const violation = isMedstopViolation(input.outcome);
  const next = violation
    ? input.dispatchStopped
      ? " Dispatch is stopped for this driver until return-to-duty documentation is filed."
      : " Med-Stop's record is not matched to one of our drivers with certainty, so dispatch was NOT stopped — confirm who this is."
    : input.outcome === "negative_dilute"
      ? " The MRO may direct a recollection."
      : " Open Drug & Alcohol and review it.";
  return {
    title: violation ? `${kind === "drug" ? "Drug" : "Alcohol"} test: action needed` : `${kind === "drug" ? "Drug" : "Alcohol"} test result to review`,
    body: `${who}: ${what} on ${article(test)} ${test} test${when}.${next}`,
    severity: violation ? "critical" : "warning",
  };
}

/** TD/TA/TM in the words a screen uses. */
export const medstopTestKind = (service: string | null): "drug" | "alcohol" | "medical" =>
  service === "TA" ? "alcohol" : service === "TM" ? "medical" : "drug";

/**
 * Where a test is, in words — from Med-Stop's `STATUSTEST`. The trail measured on 2026-10-13 is
 * COMPLETED → AT LAB → RESULTS → OPEN → REVIEWED → CLOSED: OPEN after RESULTS is the MRO's review,
 * so it reads as that, not as "open". A status nobody mapped is shown as Med-Stop wrote it.
 */
export function medstopStageLabel(service: string | null, status: string | null): string {
  const s = status?.trim().toUpperCase() ?? "";
  if (s === "CLOSED" || s === "REVIEWED") return "Result reported";
  if (s === "RESULTS" || s === "OPEN" || s.startsWith("SPLIT")) return "With the medical review officer";
  if (s === "AT LAB" || s === "IN TESTING") return "At the lab";
  if (s === "COMPLETED" || s === "COLLECTED" || s === "IN PROGRESS") return service === "TD" || service === null ? "Collected" : "Completed";
  return status?.trim() || "Unknown";
}

/**
 * A Med-Stop ORDER still waiting for the donor (`STATUSREQUEST`). COMPLETED means a test exists and
 * is followed as a test; CANCELED, NO SHOW, EXPIRED, REFUSAL and TEST CANCELED are over.
 */
export const medstopOrderOpen = (status: string | null): boolean =>
  ["PROCESSING", "OPEN", "ACTIVE", "PREPARE", "TESTING"].includes(status?.trim().toUpperCase() ?? "");

/** What an outcome reads as on a screen — one wording, for the hiring drawer and Drug & Alcohol alike. */
export const MEDSTOP_OUTCOME_LABELS: Record<MedstopTestOutcome, string> = {
  pending: "Pending",
  negative: "Negative",
  negative_dilute: "Negative-dilute",
  positive: "Positive",
  refusal: "Refusal to test",
  not_refusal: "Not a refusal",
  cancelled: "Cancelled",
  medical: "Medical exam",
  unrecognised: "Unrecognised result",
};

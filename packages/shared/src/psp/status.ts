/**
 * The PSP §8.5 status table, as data — including which outcomes BILL.
 *
 * Every value here is transcribed from the FMCSA PSP REST guide v3.9 §8.5, and the one fact that
 * shapes the whole client is §8's opening line: *"Accounts are charged the transaction fee for
 * 'Success,' 'Partial' and 'Failure' response statuses."* A typo'd licence number returns `Failure`
 * and costs the same as a hit, which is why `validate.ts` exists at all.
 *
 * `Error` (status 2) is NOT in that list, so a request PSP rejects as malformed is free. That
 * asymmetry is the entire economics of this integration: reject it ourselves and pay nothing, let PSP
 * reject it as an Error and pay nothing, let PSP look and fail to match and pay full price.
 */

/** §8.5. `3` is in the published OpenAPI's enum and in NO version of the guide (PSP-PLAN §2.6). */
export type PspStatus = 0 | 1 | 2 | 3 | 4;

export type PspOutcome = "success" | "failure" | "error" | "partial" | "unknown";

export const PSP_STATUS: Record<number, { outcome: PspOutcome; billed: boolean; meaning: string }> = {
  0: { outcome: "success", billed: true, meaning: "Matched on all four data points for every licence" },
  1: { outcome: "failure", billed: true, meaning: "No licence matched" },
  2: { outcome: "error", billed: false, meaning: "The request or the service was at fault" },
  4: { outcome: "partial", billed: true, meaning: "Some licences matched, not all" },
};

/**
 * How to read a status we do not recognise.
 *
 * Status `3` is the live case: the production OpenAPI declares the enum `[0,1,2,3,4]` and the guide
 * documents four of them. Defaulting an unknown either way is the wrong move in both directions — as
 * success it files a record that may not exist, as failure it hides one we paid for. So it settles
 * for a human, and `billed` is TRUE because the safe assumption about money is that it was spent.
 */
export const UNKNOWN_STATUS = {
  outcome: "unknown" as const,
  billed: true,
  meaning: "Undocumented status — settle this row by hand",
};

export const readStatus = (status: number): { outcome: PspOutcome; billed: boolean; meaning: string } =>
  PSP_STATUS[status] ?? UNKNOWN_STATUS;

export const isBilled = (status: number): boolean => readStatus(status).billed;

/**
 * §8.5's error detail table, verbatim in effect. The ones we can check BEFORE dispatch are marked
 * `preflight`, and `validate.ts` implements exactly those — each rule cites the code it prevents.
 */
export interface PspErrorDetail {
  detail: number;
  message: string;
  /** Checkable from the request alone, so it never reaches PSP. */
  preflight: boolean;
}

export const PSP_ERROR_DETAILS: readonly PspErrorDetail[] = [
  { detail: 1, message: "Driver's birthdate is not valid or is missing", preflight: true },
  { detail: 2, message: "First name empty, invalid, or over 20 characters", preflight: true },
  { detail: 3, message: "Internal Ref ID may not be more than 256 characters", preflight: true },
  { detail: 4, message: "Driver's licence number invalid or over 25 characters", preflight: true },
  { detail: 5, message: "Licence last name empty, over 20 characters, or invalid", preflight: true },
  { detail: 7, message: "User does not have the right to retrieve driver records", preflight: false },
  { detail: 8, message: "Licence state empty, not 2 characters, or not a valid jurisdiction", preflight: true },
  { detail: 10, message: "A valid DOT number or Motor Carrier ID must be provided", preflight: true },
  { detail: 11, message: "No transaction found for that AuthCode", preflight: false },
  { detail: 17, message: "Driver disclosure and authorization is missing, empty, or false", preflight: true },
  { detail: 18, message: "The Motor Carrier ID or DOT Number provided is not correct", preflight: false },
  { detail: 21, message: "Web service functionality is not available at this time", preflight: false },
  { detail: 22, message: "PSP account is suspended", preflight: false },
  { detail: 23, message: "The requester is not authorized to view that record", preflight: false },
  { detail: 24, message: "Licence number contained invalid characters or is over 25 characters", preflight: true },
  { detail: 25, message: "Last name empty, invalid, or over 20 characters", preflight: true },
  { detail: 26, message: "Licence last name empty, over 20 characters, or invalid", preflight: true },
  { detail: 27, message: "Birthdate invalid — the driver must be at least 18", preflight: true },
  { detail: 28, message: "The report you requested has expired", preflight: false },
  { detail: 30, message: "Your token has expired", preflight: false },
  { detail: 31, message: "The record does not have the driver's authorization", preflight: true },
  { detail: 32, message: "Your token is invalid", preflight: false },
  { detail: 33, message: "This PSP account is inactive", preflight: false },
  { detail: 34, message: "Motor Carrier ID doesn't match the DOT number provided", preflight: false },
  { detail: 35, message: "The DOT number belongs to more than one customer", preflight: false },
  { detail: 78, message: "An exception occurred retrieving the driver record", preflight: false },
];

const DETAIL_BY_CODE = new Map(PSP_ERROR_DETAILS.map((d) => [d.detail, d]));

export const describeError = (detail: number): string =>
  DETAIL_BY_CODE.get(detail)?.message ?? `Undocumented PSP error detail ${detail}`;

/**
 * Errors that mean the CREDENTIAL is the problem rather than the request — the operator has to act,
 * and no amount of retrying or re-validating will help. 30 and 32 are token problems, 22 and 33 are
 * account problems, 7 and 23 are entitlement problems.
 */
const OPERATOR_ACTION = new Set([7, 22, 23, 30, 32, 33]);
export const needsOperatorAction = (detail: number): boolean => OPERATOR_ACTION.has(detail);

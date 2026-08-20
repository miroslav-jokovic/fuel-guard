import type { PspRequestDraft } from "./validate.js";

/**
 * Who is asking, and about whom — the two identities every PSP request carries (P3).
 *
 * ── THE CARRIER IS THE ORGANISATION, NOT THE DEPLOYMENT ────────────────────────────────────────
 * §5.4.1 puts the requesting carrier's DOT number on the request, and PSP refuses without one
 * (§8.5 detail 10). The order path read `PSP_DOT_NUMBER` from the environment, which is correct for
 * exactly one shape of deployment: a single carrier per install. This one is not that. With two
 * organisations in the database, an environment-level carrier number files EVERY request under one
 * of them — so a request about the second org's driver would go out under the first org's identity,
 * against the first org's account-holder agreement.
 *
 * That is not untidy, it is a misattribution: PSP records are obtained by a named carrier with that
 * driver's written consent, and the name on the request is part of what makes the request lawful.
 * So the ORG's `dot_number` decides, and the environment is the fallback for a deployment that has
 * not filled it in yet — never the other way round.
 */

export type CarrierIdentitySource = "organization" | "environment" | "none";

export interface CarrierIdentity {
  dotNumber: string | null;
  motorCarrierId: string | null;
  /** Which one answered. Reported to the confirmation screen so an operator can see who they are. */
  source: CarrierIdentitySource;
}

export function resolveCarrierIdentity(input: {
  orgDotNumber?: string | null;
  envDotNumber?: string | null;
  envMotorCarrierId?: string | null;
}): CarrierIdentity {
  const org = input.orgDotNumber?.trim();
  if (org) return { dotNumber: org, motorCarrierId: null, source: "organization" };

  const env = input.envDotNumber?.trim();
  const mc = input.envMotorCarrierId?.trim();
  if (env || mc) {
    return { dotNumber: env || null, motorCarrierId: mc || null, source: "environment" };
  }
  return { dotNumber: null, motorCarrierId: null, source: "none" };
}

export interface PspDriverIdentity {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  date_of_birth: string | null;
  cdl_number: string | null;
  cdl_state: string | null;
}

/**
 * Names are split for PSP, which wants them separately and holds each to 20 characters (§8.5 details
 * 2, 25). `drivers.full_name` is NOT NULL and the structured parts are not, so this falls back to
 * splitting the full name — and the validator then refuses whatever that produced if it is not
 * something PSP will match on. Guessing badly and being refused for free beats not asking.
 */
export function pspNameParts(driver: PspDriverIdentity): { first: string; last: string } {
  if (driver.first_name?.trim() && driver.last_name?.trim()) {
    return { first: driver.first_name.trim(), last: driver.last_name.trim() };
  }
  const parts = driver.full_name.trim().split(/\s+/);
  return { first: parts[0] ?? "", last: parts.length > 1 ? parts[parts.length - 1]! : "" };
}

/**
 * The request we would send for this driver.
 *
 * ONE construction, used by the order path and by the readiness report. That is the property worth
 * protecting: a screen that says "ready to screen" from a second, simpler idea of what a request
 * looks like would eventually disagree with what the order actually sends — and the disagreement
 * costs a transaction fee to discover, because PSP bills on Failure (§8).
 */
export function buildPspDraft(input: {
  driver: PspDriverIdentity;
  carrier: CarrierIdentity;
  /** Our key, echoed on every response and on the 45-day report (§6). */
  internalRefId: string;
  consent: boolean;
  userIPAddress?: string | null;
  monitor?: boolean;
}): PspRequestDraft {
  const { first, last } = pspNameParts(input.driver);
  return {
    driverFirstName: first,
    driverLastName: last,
    driverDOB: input.driver.date_of_birth ?? "",
    dotNumber: input.carrier.dotNumber,
    motorCarrierId: input.carrier.motorCarrierId,
    internalRefId: input.internalRefId,
    driverConsent: input.consent,
    userIPAddress: input.userIPAddress ?? null,
    monitor: input.monitor === true,
    licenseQueries: [
      {
        dlNum: input.driver.cdl_number ?? "",
        dlState: input.driver.cdl_state ?? "",
        dlFirstName: first,
        dlLastName: last,
      },
    ],
  };
}

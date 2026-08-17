import type { EfsMileageCode } from "@fuelguard/shared";
import type { Env } from "../env.js";
import { getLastMileage, overrideLastMileage } from "../lib/efsSecureFuelOps.js";
import type { CardOpOptions } from "../lib/efsCardOps.js";
import type { EfsSoapCredentials } from "./efsSoapCredentials.js";

/**
 * The mileage override, and the re-read that is the only evidence it happened (`docs/37` §6 E′).
 *
 * ── Why this is a service and not three lines in a route ────────────────────────────────────────
 * `overrideLastMileage` returns nothing at all — the WSDL declares its response message with no
 * parts. A route that dispatched it and answered `{ ok: true }` would be reporting the vendor's
 * willingness to accept a request as though it were the reading having changed, which is the H1
 * failure this codebase has already paid for once: a write accepted and silently ignored, reported
 * as success. Every fact in the outcome below comes from a READ, before and after.
 *
 * ── This is not routed through the capability ledger, and that is a recorded decision ───────────
 * `docs/37` §4 sets out the two options and §6 recommends this one: a plain audited write with a
 * verifying re-read, rather than a `unit` target kind plus a second `LedgerAdapter` and the
 * migration that a unit-keyed ledger row needs. What that buys is proportion — one operator
 * correcting a GPS glitch. What it COSTS is real and should not be discovered later:
 *
 *   • no `pnpm efs:prove unit_mileage` — the prover is keyed on capabilities, so this write has no
 *     OEG run and cannot be promoted through Step 4.6's gate;
 *   • no ledger row, so no `mutationView` entry and no background reconciler second look;
 *   • the audit row and the outcome below are the whole record.
 *
 * The re-read is what makes that acceptable rather than merely cheap. It answers the same question
 * `VerifyPlan.judge` answers, at the same moment, from the same operation the capability version
 * would have named as its snapshot.
 */

/** Three-valued for the same reason `Landing` is: "we could not tell" is a real answer. */
export type MileageLanding = "landed" | "not_landed" | "indeterminate" | "already_current";

export interface MileageOverrideOutcome {
  landing: MileageLanding;
  /** What EFS held before we wrote, read moments earlier. Null when it holds no reading for the unit. */
  before: number | null;
  /** What EFS holds now. The only evidence the write landed. */
  after: number | null;
  requested: number;
  unit: string;
  code: EfsMileageCode;
  /** False when the dispatch was skipped because EFS already held the requested value. */
  dispatched: boolean;
}

/** The reading EFS holds for one unit and code, or null when it has none. */
export async function readUnitMileage(
  env: Env,
  creds: EfsSoapCredentials,
  unit: string,
  code: EfsMileageCode,
  opts: CardOpOptions = {},
): Promise<number | null> {
  const rows = await getLastMileage(env, creds, { unit, code }, opts);
  /**
   * Matched on BOTH fields rather than taking `rows[0]`.
   *
   * The search is a filter, not a lookup: the portal's "All" mode proves the same operation can
   * answer with the whole fleet, and a binding that ignored an unrecognised criterion would hand
   * back a first row belonging to a different truck. Comparing the unit we asked for against the
   * unit that came back costs nothing and turns that class of surprise into "no reading" rather
   * than into a confident wrong number.
   */
  const row = rows.find((r) => r.unit === unit && r.code === code);
  return row?.mileage ?? null;
}

/**
 * Set the baseline reading EFS compares the driver's pump entry against.
 *
 * ⚠ **A seed, not a repair** (`docs/37` §6a E′). This corrects EFS's COPY of the odometer; it does
 * not change the truck, Samsara, or `vehicles.current_odometer`. The operator-facing wording has to
 * say so, or the button reads as "fix the odometer".
 */
export async function applyMileageOverride(
  env: Env,
  creds: EfsSoapCredentials,
  request: { unit: string; code: EfsMileageCode; mileage: number },
  opts: CardOpOptions = {},
): Promise<MileageOverrideOutcome> {
  const { unit, code, mileage } = request;
  const before = await readUnitMileage(env, creds, unit, code, opts);

  /**
   * The write is SKIPPED when EFS already holds the requested value, and the outcome says so.
   *
   * This is the same reasoning as a proof plan's OEG-3 precondition, applied to production rather
   * than to the prover. Dispatching here would spend a vendor call to reach a state that already
   * holds, and — because the response carries nothing — the re-read afterwards would show the
   * requested value whether or not the vendor did anything at all. That is indistinguishable from a
   * successful write, which makes it the one case where reporting `landed` would be unfounded.
   *
   * Not a refusal: the operator's intent is already satisfied, and failing them for it would be
   * theatre. It is reported as its own landing so nobody reads it as evidence the write path works.
   */
  if (before === mileage) {
    return { landing: "already_current", before, after: before, requested: mileage, unit, code, dispatched: false };
  }

  await overrideLastMileage(env, creds, { unit, code, mileage }, opts);

  const after = await readUnitMileage(env, creds, unit, code, opts);

  return { landing: judge(before, after, mileage), before, after, requested: mileage, unit, code, dispatched: true };
}

/**
 * Did it land — decided from two reads and nothing else.
 *
 * The third case is the one worth spelling out. EFS's reading has its own writer: the ELD feed that
 * keeps it current is exactly what makes it drift, and it can move between our write and our
 * re-read. A reading that is now neither the old value nor the one we asked for is therefore NOT
 * evidence of failure — it is evidence that something else wrote after us, and calling that
 * `not_landed` would send an operator to repeat a write that may have worked.
 */
function judge(before: number | null, after: number | null, requested: number): MileageLanding {
  if (after === requested) return "landed";
  if (after === before) return "not_landed";
  return "indeterminate";
}

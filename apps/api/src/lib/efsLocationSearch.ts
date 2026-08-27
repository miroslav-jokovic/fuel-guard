import type { EfsLocation } from "@silvicom/shared";
import type { Env } from "../env.js";
import type { EfsSoapCredentials } from "../services/efsSoapCredentials.js";
import { type CardOpOptions, callCardOp, elAlways, resultRecords, text } from "./efsCardOps.js";
import { EfsSoapError, parseSoap } from "./efsSoapSession.js";

/**
 * EFS `searchLocation` — split out of efsCardOps.ts at the 500-line budget, and because it is the one
 * operation whose REQUEST SHAPE had to be resolved against the live binding rather than read from the
 * guide.
 *
 * The guide documents the fields (p132) but not the element nesting around them, and for this WSDL
 * that omission has already bitten twice, in opposite directions:
 *
 *   • getTranRejects' section lists its criteria flat too (p107), yet the production WSDL wraps them
 *     in a `<search>` element — the working feed request in efsSoap.ts is the proof.
 *   • Sending searchLocation's criteria flat, in the guide's order, earned from production:
 *
 *       org.apache.axis2.databinding.ADBException: Unexpected subelement locId
 *
 *     — the ADB deserializer rejecting the FIRST criterion as a direct child, which is what it does
 *     when the request bean expects a wrapper object there. (An earlier attempt that omitted unset
 *     fields got "Unexpected subelement state": same verdict, different first element. Together they
 *     rule flat-at-top-level out.)
 *
 * We cannot read the WSDL from here (EFS's firewall admits only the allowlisted egress addresses), so
 * the binding itself is the oracle: try the plausible shapes in likelihood order, let ADB refuse the
 * wrong ones — a shape complaint is instant and harmless — and REMEMBER the accepted one per
 * endpoint, so the ladder runs at most once per process. `search` goes first because it is the
 * wrapper this same WSDL already proved for the other criteria-carrying operation.
 */

export interface LocationQuery {
  locId?: string | null;
  state?: string | null;
  city?: string | null;
  /** A "like" search (p132). */
  name?: string | null;
  country?: "USA" | "CAN" | "MXN" | null;
  chainId?: string | null;
}

type LocationRequestShape = "search" | "flat" | "criteria" | "request";
const LOCATION_REQUEST_SHAPES: readonly LocationRequestShape[] = ["search", "flat", "criteria", "request"];

/** Shape proven against each endpoint, keyed like the session cache. In-memory on purpose: it is a
 *  protocol fact, re-derivable in one round trip, not state worth a table. */
const acceptedLocationShapes = new Map<string, LocationRequestShape>();

/** Test seam. */
export function __resetLocationShapes(): void {
  acceptedLocationShapes.clear();
}

/** An ADB complaint about WHERE an element sat — as opposed to a refusal, a bad value or an outage.
 *  Only this advances the shape ladder; everything else is a real answer and is rethrown as-is. */
const SHAPE_FAULT = /ADBException|Unexpected subelement/i;

/**
 * Every criterion element is sent, every time, in the guide's declared order — "EFS's Axis2 binding
 * rejects omitted filter elements even though the WSDL marks them nillable"
 * (docs/plans/EFS-SOAP-INTEGRATION-PLAN.md). Unused int fields go as 0, not empty: an empty
 * `<locId></locId>` is not a valid xsd:int, and 0-as-no-filter is the convention already proven
 * against this endpoint by the working getTranRejects request (`<locationId>0</locationId>`).
 */
function locationCriteria(query: LocationQuery): string {
  return (
    elAlways("locId", query.locId ?? 0) +
    elAlways("state", query.state ?? "") +
    elAlways("city", query.city ?? "") +
    elAlways("name", query.name ?? "") +
    elAlways("country", query.country ?? "") +
    elAlways("chainId", query.chainId ?? 0)
  );
}

function locationBody(shape: LocationRequestShape, clientId: string, query: LocationQuery): string {
  const fields = locationCriteria(query);
  const inner = shape === "flat" ? fields : `<${shape}>${fields}</${shape}>`;
  return `<CardManagementEP_searchLocation>${elAlways("clientId", clientId)}${inner}</CardManagementEP_searchLocation>`;
}

/**
 * Find EFS locations. Backs the single-location override picker — an operator knows "the Love's on
 * I-57", not a 6-digit id, and p194 requires a valid id.
 *
 * "the system needs to select 1 to many items to search, not all are required" (p132): an entirely
 * empty query would ask EFS for every location it has, so we refuse it here rather than find out what
 * that does to a paced connection.
 */
export async function searchLocation(
  env: Env,
  creds: EfsSoapCredentials,
  query: LocationQuery,
  opts: CardOpOptions = {},
): Promise<EfsLocation[]> {
  // At least one REAL criterion, judged on the query object rather than on the serialized string —
  // the string is never empty (see locationCriteria), so testing it would silently disable this.
  const hasCriterion = [query.locId, query.state, query.city, query.name, query.country, query.chainId]
    .some((v) => v !== null && v !== undefined && String(v).trim() !== "");
  if (!hasCriterion) {
    throw new EfsSoapError("A location search needs at least one criterion", "not_implemented");
  }

  const shapeKey = `${creds.orgId}:${creds.endpointUrl}`;
  const proven = acceptedLocationShapes.get(shapeKey);
  // The proven shape first, then the rest — so if the binding ever changes under us (a WEX redeploy),
  // the ladder re-runs instead of hard-failing on a memo.
  const shapes = proven
    ? [proven, ...LOCATION_REQUEST_SHAPES.filter((s) => s !== proven)]
    : LOCATION_REQUEST_SHAPES;

  const refusals: string[] = [];
  for (const shape of shapes) {
    let xml: string;
    try {
      xml = await callCardOp(
        env, creds, "searchLocation",
        (session) => locationBody(shape, session.clientId, query),
        opts,
      );
    } catch (error) {
      const isShapeFault =
        error instanceof EfsSoapError && error.code === "soap_fault" && SHAPE_FAULT.test(error.message);
      if (!isShapeFault) throw error; // a real answer — auth, firewall, outage — not a shape question
      refusals.push(`${shape}: ${error.message}`);
      if (acceptedLocationShapes.get(shapeKey) === shape) acceptedLocationShapes.delete(shapeKey);
      continue;
    }
    if (acceptedLocationShapes.get(shapeKey) !== shape) {
      acceptedLocationShapes.set(shapeKey, shape);
      // Loud once per process: this line is the protocol documentation the guide never wrote.
      console.log(`[efs-cards] searchLocation: EFS accepted the "${shape}" request shape (org ${creds.orgId})`);
    }
    return resultRecords(parseSoap(xml)).map((record) => ({
      locId: text(record, "locId") ?? "",
      name: text(record, "name"),
      city: text(record, "city"),
      state: text(record, "state"),
      country: text(record, "country"),
      addr1: text(record, "addr1"),
      phone: text(record, "phone"),
    })).filter((l) => l.locId !== "");
  }

  // Every shape refused. Name each verdict: the next engineer's fix starts from EFS's own words, and
  // the probe surfaces this message verbatim.
  throw new EfsSoapError(
    `EFS rejected every request shape we know for searchLocation — ${refusals.join("; ")}`,
    "soap_fault",
    { refusals },
  );
}

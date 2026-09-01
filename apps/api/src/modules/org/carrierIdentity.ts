import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who the carrier is, as a compliance document has to state it (0282).
 *
 * `organizations` is the `org` module's table (docs/ARCHITECTURE.md §3), so this is the interface
 * every other module reads it through rather than reaching for `.from("organizations")`. The DQ
 * binder's `gatherCarrier` predates the rule and reads directly; it moves here when it is next
 * touched (D-ARC4's "old code moves when touched").
 *
 * ── WHY `complete` IS PART OF THE READ ─────────────────────────────────────────────────────────
 * §396.21(a)(2) requires the annual inspection report to identify the motor carrier, and
 * §396.17(c)(2) requires the decal to carry the address WHERE THE REPORT IS MAINTAINED. A report
 * rendered with a blank carrier block is not a lesser report, it is a non-compliant one — so the
 * caller needs to know before it renders, not after. Answering "is this usable on a filing" here
 * keeps that judgement in one place instead of in every renderer.
 */

export interface CarrierIdentity {
  name: string;
  dotNumber: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  /** True when this is enough to print on a §396.17 report. */
  complete: boolean;
  /** The fields a caller must ask somebody to fill in — named, so the message can be useful. */
  missing: string[];
}

export type CarrierIdentityError = { error: string; code: string };

const COLUMNS = "name, dot_number, address_line1, city, state, postal_code";

export async function getCarrierIdentity(
  admin: SupabaseClient,
  orgId: string,
): Promise<CarrierIdentity | CarrierIdentityError> {
  const { data, error } = await admin.from("organizations").select(COLUMNS).eq("id", orgId).maybeSingle();
  if (error || !data) return { error: "Could not load the carrier record", code: "db_error" };
  const row = data as unknown as {
    name: string;
    dot_number: string | null;
    address_line1: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
  };
  const missing: string[] = [];
  if (!row.name?.trim()) missing.push("name");
  if (!row.address_line1?.trim()) missing.push("street address");
  if (!row.city?.trim()) missing.push("city");
  if (!row.state?.trim()) missing.push("state");
  if (!row.postal_code?.trim()) missing.push("ZIP code");
  return {
    name: row.name,
    dotNumber: row.dot_number,
    addressLine1: row.address_line1,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    complete: missing.length === 0,
    missing,
  };
}

/** "MELROSE PARK IL , 60160" — the shape the office has been printing for years. */
export function carrierCityStateZip(carrier: CarrierIdentity): string | null {
  if (!carrier.city && !carrier.state && !carrier.postalCode) return null;
  return `${carrier.city ?? ""} ${carrier.state ?? ""} , ${carrier.postalCode ?? ""}`.trim();
}

/**
 * ── THERE IS NO SETTER HERE, AND THAT IS THE SECOND ANSWER TO THIS QUESTION ────────────────────
 * A6 shipped one, along with a `PATCH /api/org/carrier` route, without checking whether the product
 * already had somewhere to edit the carrier. It did: `/settings/org` has written `name` and
 * `dot_number` for a year, through `useOrgSettings` and `orgSettingsFormSchema`. The address is
 * `dot_number`'s exact sibling — same table, same reader, same reason it is recorded — so a second
 * endpoint writing the same columns was a second source of truth, and a form that saved half its
 * fields one way and half the other would have been worse than either.
 *
 * So the write went where its siblings already live and this file kept only the READ, which is the
 * part `maintenance` genuinely needs and cannot get any other way (D-ARC3: readers outside the owner
 * go through the owner's interface).
 */

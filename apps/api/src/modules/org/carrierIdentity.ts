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

export interface CarrierIdentityInput {
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  dotNumber?: string | null;
}

/**
 * Set the carrier's address. Deliberately does NOT touch `name` — an organisation's name is its
 * identity across the whole product, and renaming it from a compliance settings form is a different
 * decision from correcting a ZIP code.
 */
export async function setCarrierIdentity(
  admin: SupabaseClient,
  orgId: string,
  input: CarrierIdentityInput,
): Promise<{ ok: true } | CarrierIdentityError> {
  const patch: Record<string, unknown> = {};
  if ("addressLine1" in input) patch.address_line1 = input.addressLine1 ?? null;
  if ("city" in input) patch.city = input.city ?? null;
  if ("state" in input) patch.state = input.state ?? null;
  if ("postalCode" in input) patch.postal_code = input.postalCode ?? null;
  if ("dotNumber" in input) patch.dot_number = input.dotNumber ?? null;
  if (Object.keys(patch).length === 0) return { ok: true };
  const { error } = await admin.from("organizations").update(patch).eq("id", orgId);
  if (error) return { error: "Could not save the carrier record", code: "update_failed" };
  return { ok: true };
}

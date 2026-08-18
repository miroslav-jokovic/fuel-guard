/**
 * Limit IDs — what a card limit may be keyed on, and what its VALUE means (guide p169–171).
 *
 * Split out of `efsCardCatalog.ts` when Step 10.3's `resolveLimitVocabulary` pushed that file past
 * the 500-line budget. The seam is the guide's own: p169–171 IS the Limit IDs code table, and these
 * are the only exports that read it. `efsCardCatalog.ts` re-exports all of them, so nothing that
 * imports from there had to move — the same shape as `promptDrafts.ts` leaving `cardOperations.ts`.
 */

export const EFS_LIMIT_LABELS: Record<string, string> = {
  ADD: "Additives", AMDS: "Aviation merchandise", ANFR: "Anti-freeze", AVGS: "Aviation gas",
  BDSL: "Biodiesel", BRAK: "Brakes and wheels", CADV: "Cash advance", CLTH: "Clothing",
  CNG: "Compressed natural gas", COUP: "Coupon", DEF: "DEF (bulk)", DEFC: "DEF (container)",
  DELI: "Restaurant / deli", DSL: "Diesel", DSLM: "Mexico diesel", ELEC: "Electronics",
  EVCH: "Electric charging", FAX: "Fax", FURN: "Furnace oil", GAS: "Gasoline",
  GASM: "Mexico gas magna", GASP: "Mexico premium gas", GROC: "C-store / groceries",
  HARD: "Hardware / accessories", IDLE: "IdleAire", JET: "Jet fuel", KERO: "Kerosene",
  LABR: "Labour", LMPR: "Lumper", LNG: "Liquid natural gas", MDSL: "Tax-exempt diesel",
  MERC: "Miscellaneous merchandise", MGAS: "Tax-exempt gas", MRFR: "Marked reefer",
  NGAS: "Natural gas", OIL: "Oil", OILC: "Oil change", PART: "Parts", PHON: "Phone time",
  PNT: "Paint", PROP: "Propane", RECP: "Recap", REPR: "Repair service", REST: "Restaurant",
  RFND: "Refund", RFR: "Reefer", RFRM: "Thermo", SCAN: "Tons imaging", SCLE: "Weigh scale",
  SHWR: "Shower", SPLT: "Split / other payment", STAX: "Sales tax", TIRE: "Tyres / tyre repairs",
  TOLL: "Ambassador Bridge toll", TRAL: "Trailer", TRPP: "Trip permit",
  ULSD: "Ultra-low-sulphur diesel", WASH: "Car wash", WIFI: "Fleet WiFi", WWFL: "Washer fluid",
};

export type EfsLimitUnit = "gallons" | "units" | "dollars";

/**
 * What a limit VALUE means. This matters more than it looks: a `ULSD` limit of 100 is a hundred
 * gallons, and rendering it as "$100" tells a fleet manager their driver can buy a third of a tank
 * when in fact he can fill twice.
 *
 * The guide states the rule but does not enumerate which products it covers: "the limit value, which
 * will be gallons for fuel or DEF dispensed and dollar amounts in all other cases" (p36). So:
 *
 *   • `gallons` — liquid fuel and DEF, where "gallons" is unambiguous.
 *   • `units`   — dispensed energy that is NOT sold by the gallon (CNG and LNG in DGE/GGE, electric
 *                 charging in kWh). The guide's sentence plainly intends a dispensed quantity rather
 *                 than dollars, but it does not say the unit, so we render a neutral one instead of
 *                 asserting a wrong one. Confirm with WEX before showing a unit on these.
 *   • `dollars` — everything else, per "dollar amounts in all other cases". This is the DEFAULT, so an
 *                 unrecognised or newly-added limit ID falls here rather than silently claiming volume.
 */
const GALLON_LIMIT_IDS = new Set([
  "ULSD", "DSL", "DSLM", "BDSL", "MDSL", "GAS", "GASM", "GASP", "MGAS",
  "DEF", "DEFC", "RFR", "MRFR", "RFRM", "KERO", "PROP", "AVGS", "JET", "FURN",
]);
const UNIT_LIMIT_IDS = new Set(["CNG", "LNG", "NGAS", "EVCH"]);

export function limitUnit(limitId: string): EfsLimitUnit {
  const id = limitId.toUpperCase();
  if (GALLON_LIMIT_IDS.has(id)) return "gallons";
  if (UNIT_LIMIT_IDS.has(id)) return "units";
  return "dollars";
}

export const limitLabel = (limitId: string): string => EFS_LIMIT_LABELS[limitId] ?? limitId;

/**
 * One `getProductGroups` record as migration 0202 stores it — the vendor's field names, unchanged.
 *
 * `description` and `isFuel` are optional because the column is jsonb written from a vendor response:
 * a record that arrives without them is a thinner answer, not a corrupt one, and the resolver has a
 * documented behaviour for each.
 */
export interface EfsProductGroupRecord {
  groupId: string;
  description?: string | null;
  isFuel?: boolean | null;
}

/** One choice in the product-limit picker: the id that goes on the wire, and how to render it. */
export interface EfsLimitOption {
  limitId: string;
  label: string;
  unit: EfsLimitUnit;
}

/**
 * What a card limit may be keyed on, ON THIS ACCOUNT — the vocabulary half of Step 10.3.
 *
 * ── ⚠ The source is `getProductGroups`, NOT `getProducts` ────────────────────────────────────────
 * `docs/38` §7.1 and `docs/39` §4 both name `getProducts`, and both are wrong. The guide settles it
 * in one line, on the `getProductGroups` output (p~140): *"groupId — string (4) — The product group
 * ID. **See Limit IDs for valid values.**"* `getProducts.code` is documented as "The product code
 * ID" with no such cross-reference, and each product instead carries the `group` it rolls up to.
 *
 * The data agrees, and the cost of the error is concrete: ten ids in the guide's own Limit IDs table
 * — including **DSL**, GAS, JET, DSLM, DEFC — do not appear in `getProducts` at all on this account.
 * A picker fed from products could not offer DSL, which is the one id WEX's Overrides guide says
 * diesel must be paired with (*"different truck stops use different product codes for fuel"*), so
 * every diesel override built on it would have declined half the network.
 *
 * ── Why this does NOT intersect with the guide, where `resolveEditableInfoIds` does ─────────────
 * That function intersects because `getPromptTypes` returns bare four-letter codes and this account
 * returns fifteen the vendor documents nowhere — an operator offered one is offered a switch with no
 * label. `getProductGroups` returns `description` and `isFuel` WITH each id, so the account labels
 * its own vocabulary and the argument does not carry over. Intersecting anyway would drop the
 * fifteen groups this account has and the guide's table lacks (ACCE, APRO, ATOM, BEVR, HYDR, PARK,
 * …) for no reason but our table being older than the account.
 *
 * ── The unit is deliberately conservative on a fuel we cannot name ──────────────────────────────
 * `isFuel: false` is dollars, which the account has just told us. `isFuel: true` is gallons only for
 * an id we recognise as a liquid, and `units` — a bare number — otherwise. This account reports
 * APRO and HYDR as fuel and neither is sold by the gallon (hydrogen is sold by the kilogram), so
 * mapping fuel to gallons would assert a wrong unit on a screen where "100 gal" versus "$100" is the
 * difference between a full tank and a third of one (p36). A neutral quantity asserts nothing.
 *
 * @param groups what `getProductGroups` returned for this org, or null/empty if never read.
 */
export const resolveLimitVocabulary = (
  groups: readonly EfsProductGroupRecord[] | null | undefined,
): readonly EfsLimitOption[] => {
  const fromGuide = (): EfsLimitOption[] =>
    Object.entries(EFS_LIMIT_LABELS).map(([limitId, label]) => ({ limitId, label, unit: limitUnit(limitId) }));

  // Empty falls through to the same fallback as null, for `resolveEditableInfoIds`' reason: an
  // account that offers nothing and an account we never asked are one situation for the operator.
  if (!groups) return fromGuide();

  const seen = new Set<string>();
  const resolved: EfsLimitOption[] = [];
  for (const group of groups) {
    const limitId = group.groupId?.trim().toUpperCase();
    if (!limitId || seen.has(limitId)) continue;
    seen.add(limitId);
    resolved.push({
      limitId,
      // The ACCOUNT's own description wins, because it is the words the operator sees in the WEX
      // portal. Our transcription is the fallback, and the bare id is the last resort — never blank.
      label: group.description?.trim() || EFS_LIMIT_LABELS[limitId] || limitId,
      unit: limitUnitFor(limitId, group.isFuel),
    });
  }
  return resolved.length > 0 ? resolved : fromGuide();
};

/** `isFuel` from the account, narrowed by what we can actually name. See the docblock above. */
const limitUnitFor = (limitId: string, isFuel: boolean | null | undefined): EfsLimitUnit => {
  if (isFuel === false) return "dollars";
  if (isFuel === true) return GALLON_LIMIT_IDS.has(limitId) ? "gallons" : "units";
  // The account did not say. Fall back to the id-only rule rather than inventing an answer.
  return limitUnit(limitId);
};

/** Render a limit value with the unit its ID implies. */
export function formatLimit(limitId: string, value: number): string {
  switch (limitUnit(limitId)) {
    case "gallons":
      return `${value} gal`;
    case "units":
      return `${value}`;
    default:
      return `$${value}`;
  }
}

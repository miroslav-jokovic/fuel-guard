/**
 * The carrier's own file — WHAT Settings › Carrier records is made of (DQ-INTO-DRIVERS-PLAN DD5, D-DQ23).
 * The third catalogue beside `dqCatalogue.ts` (a driver's §391.51 file) and `equipmentFileCatalogue.ts`
 * (a truck's or a trailer's), judged by the same `fileEngine.buildFile`, so "expiring" means the same
 * thing on all three screens.
 *
 * ── WHAT IT IS MADE OF, AND WHAT IS NOT RESTATED ─────────────────────────────────────────────────
 * Its kinds are exactly `ORGANIZATION_CERT_KINDS` (a test pins that, each kind once): the five records
 * only a carrier holds, written here, and the fleet papers filed once for every unit (insurance, IFTA,
 * D-UF6), which are NOT written here. Those are the equipment catalogue's `fleetWide` items, re-shaped,
 * so a change to the truck file's insurance item is a change to the carrier's.
 *
 * ── WHICH ITEMS APPLY (D-DQ23 §4, Q-DD5, Q-DD6) ──────────────────────────────────────────────────
 * - Operating authority applies to every carrier (Q-DD5 (a), 2026-11-06): every tenant is for-hire, and
 *   a "private carrier" setting the product does not have is not invented here.
 * - The hazmat records apply only with the HazmatGuard module (`scope: "hazmat"`, the driver
 *   catalogue's word for it). Within them the split is `qualifyOrg`'s (qualificationGate.ts §10.5), not a
 *   new one: PHMSA registration and financial responsibility it checks on every hazmat load, so they are
 *   required; the security plan and the safety permit it checks only when a load trips §172.800(b) or
 *   §385.403(b), so they are `advisory` — never "missing", shown once filed.
 * - Financial responsibility is its own row, never satisfied by the fleet insurance (Q-DD6 (a)): the
 *   §387.9 hazmat minimum ($1M–$5M by commodity) is a different fact from "the fleet is insured", and
 *   one row standing for both would clear a hazmat load on a policy below the minimum. The office files
 *   the same PDF to both when it is one paper.
 *
 * Recurrence is `expiry` for everything `qualifyOrg` reads, because the gate reads `expires_at` and
 * reports a record without one; operating authority alone is `one_time` — it does not lapse, it is
 * revoked, and the gate never reads it.
 */
import { buildFile, type FileItemSpecBase, type FileSummary } from "./fileEngine.js";
import { DQ_KIND_LABELS } from "./dqCatalogue.js";
import { EQUIPMENT_ITEMS } from "./equipmentFileCatalogue.js";

/** The groups the carrier's file is shown in, in display order. */
export const CARRIER_GROUPS = ["authority", "insurance", "registration", "hazmat"] as const;
export type CarrierGroup = (typeof CARRIER_GROUPS)[number];

export const CARRIER_GROUP_LABELS: Record<CarrierGroup, string> = {
  authority: "Operating authority",
  insurance: "Insurance",
  registration: "Registration & permits",
  hazmat: "Hazmat",
};

export interface CarrierItemSpec extends FileItemSpecBase {
  group: CarrierGroup;
  /** Every carrier item is proved by a current certification on the organization. */
  source: "certification";
  evidenceKinds: readonly string[];
  /** `hazmat` items apply only to a carrier running HazmatGuard (as `DqScope`). */
  scope: "always" | "hazmat";
  /**
   * A policy has a start as well as an end: the drawer asks "Effective from" for these, which the
   * binder and the certification history print (`effective_from`). Nothing else asks it.
   */
  effectiveFrom?: boolean;
  /** The retention rule, as text. Shown, never acted on. */
  retention: string;
}

const label = (kind: string): string => DQ_KIND_LABELS[kind] ?? kind;

/** The records only a carrier holds — one per `CARRIER_ONLY_CERT_KINDS` kind. */
const CARRIER_ONLY_ITEMS: readonly CarrierItemSpec[] = [
  {
    key: "operating_authority",
    label: label("operating_authority"),
    citation: "49 U.S.C. §13902; 49 CFR Part 365",
    group: "authority",
    recurrence: "one_time",
    source: "certification",
    evidenceKinds: ["operating_authority"],
    scope: "always",
    retention: "While the authority is active.",
  },
  {
    key: "phmsa_registration",
    label: label("phmsa_registration"),
    citation: "49 CFR Part 107 subpart G",
    group: "hazmat",
    recurrence: "expiry",
    source: "certification",
    evidenceKinds: ["phmsa_registration"],
    scope: "hazmat",
    retention: "Three years from the date the certificate was issued (§107.620(a)).",
  },
  {
    key: "financial_responsibility",
    label: label("financial_responsibility"),
    citation: "49 CFR §387.9",
    // Beside the fleet policy it is so often the same paper as (Q-DD6), still its own row.
    group: "insurance",
    recurrence: "expiry",
    source: "certification",
    evidenceKinds: ["financial_responsibility"],
    scope: "hazmat",
    effectiveFrom: true,
    retention: "While the policy is in force.",
  },
  {
    key: "security_plan",
    label: label("security_plan"),
    citation: "49 CFR §172.800(b), §172.802",
    group: "hazmat",
    recurrence: "expiry",
    source: "certification",
    evidenceKinds: ["security_plan"],
    scope: "hazmat",
    advisory: true,
    retention: "The current plan; reviewed at least once a year (§172.802(c)).",
  },
  {
    key: "hazmat_safety_permit",
    label: label("hazmat_safety_permit"),
    citation: "49 CFR §385.403",
    group: "hazmat",
    recurrence: "expiry",
    source: "certification",
    evidenceKinds: ["hazmat_safety_permit"],
    scope: "hazmat",
    advisory: true,
    retention: "For the permit's term.",
  },
];

/**
 * The fleet papers, read from the equipment catalogue (D-UF6). Its groups `insurance` and
 * `registration` are this catalogue's too; a policy carries a start date.
 */
const FLEET_ITEMS: readonly CarrierItemSpec[] = EQUIPMENT_ITEMS.filter((i) => i.fleetWide).map((i) => ({
  key: i.key,
  label: i.label,
  citation: i.citation,
  group: i.group as CarrierGroup,
  recurrence: i.recurrence,
  source: "certification",
  evidenceKinds: i.evidenceKinds,
  scope: "always",
  effectiveFrom: i.group === "insurance",
  retention: i.retention,
}));

export const CARRIER_ITEMS: readonly CarrierItemSpec[] = [...FLEET_ITEMS, ...CARRIER_ONLY_ITEMS].sort(
  (a, b) => CARRIER_GROUPS.indexOf(a.group) - CARRIER_GROUPS.indexOf(b.group),
);

/** The items that apply to this carrier — every `always` item, and the hazmat ones with HazmatGuard. */
export function carrierFileSpecs(opts: { includeHazmat: boolean }): readonly CarrierItemSpec[] {
  return CARRIER_ITEMS.filter((i) => i.scope === "always" || opts.includeHazmat);
}

/** One current certification on the organization, as the carrier's file reads it. */
export interface CarrierCertInput {
  kind: string;
  issuedAt: string | null;
  expiresAt: string | null;
  documentId: string | null;
}

/**
 * The carrier's file, as at `today`. `documentIds` are the organization's filed originals: a
 * certification citing an id outside it is dated but shows no scan (the engine's rule, fileEngine.ts).
 */
export function buildCarrierFile(input: {
  certs: readonly CarrierCertInput[];
  documentIds: ReadonlySet<string>;
  today: string;
  includeHazmat: boolean;
}): FileSummary<CarrierItemSpec> {
  return buildFile({
    today: input.today,
    specs: carrierFileSpecs({ includeHazmat: input.includeHazmat }),
    evidenceFor: (spec) => {
      const c = input.certs.find((x) => spec.evidenceKinds.includes(x.kind));
      return c
        ? { expiresAt: c.expiresAt, issuedAt: c.issuedAt, occurredOn: null, coversUntil: null, documentId: c.documentId }
        : undefined;
    },
    documentIds: input.documentIds,
    nothingFiled: input.certs.length === 0,
  });
}

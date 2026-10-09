import { z } from "zod";

/**
 * ShippingDocument — the `shipping_document` profile's contract (DOCUMENT-READER-PLAN.md §2, D-DR1/D-DR2):
 * everything the document reader transcribes from a bill of lading at pickup or a signed copy at delivery.
 *
 * DATA ONLY, AS PRINTED. Every value is the paper's text or number, never an interpretation (D1 of the
 * hazmat plan: AI reads, code decides). A date is the printed string, a party is the printed name, an id
 * is "NA 1993" if that is what the shipper wrote. Resolution against the HMT, unit normalisation, order
 * matching and the paper audit (§5) all happen downstream, in code, over this shape. Nothing here says
 * whether a value is right — that is the `FieldEvidence` beside it (`fieldEvidenceContract.ts`).
 *
 * WHY EVERY FIELD DEFAULTS TO NULL. One schema serves three writers that each fill a different subset: the
 * model passes (structured output, D-DR8), the corpus labellers (`labels.json`, Step 0.3) and, later, the
 * text-layer reader. `shippingDocumentSchema.parse({})` is therefore the empty document, and the corpus
 * skeleton is derived from it (`emptyShippingDocument`) rather than restated.
 *
 * The hazmat section's line shape is the one the hazmat extractor has validated since H6 (`BolFields` in
 * `apps/api/.../bolFields.ts`, which now imports it from here): same keys, same defaults, so `BolFields`
 * is a projection of this document and its tests run unchanged against it (plan Step 1.1).
 */

const str = () => z.string().nullable().default(null);
const num = () => z.number().nullable().default(null);
const int = () => z.number().int().nullable().default(null);

// ── hazmat: the printed basic description, one entry per line (§172.202) ───────────────────────────
export const printedHazmatLineSchema = z.object({
  /** The id exactly as printed ("UN1203", "NA 1993", "1203"). */
  idText: str(),
  /**
   * The basic description as ONE printed string — "UN1203, Gasoline, 3, PG II" — exactly as it stands on
   * the paper, punctuation and order included, from the first of the id, name, class and packing group to
   * the last of them. §172.202(b) (eCFR, current 2026-10-07): "the basic description specified in
   * paragraphs (a)(1), (2), (3), and (4) of this section must be shown in sequence with no additional
   * information interspersed". The four fields beside it say what the parts are; only the string says
   * whether the paper printed them in sequence, so it is the paper audit's input (§5) — an AUDIT input,
   * not an engine input, hence absent from ENGINE_INPUT_LINE_KEYS. Null when no description is legible as
   * one run of text. Not the quantity or packaging printed after it: live 2026-10-09, both Sonnets
   * appended a trailing "5000 GAL" under the looser wording "the whole description"; the wording below
   * has not been re-measured.
   */
  descriptionText: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "This line's id, shipping name, hazard class and packing group as ONE string exactly as printed, in printed order " +
        "and punctuation, from the first of them to the last — not the quantity or packaging after them.",
    ),
  psn: str(),
  /** As printed: "3", "3 (6.1)", "Combustible liquid". */
  hazardClass: str(),
  pg: z.enum(["I", "II", "III"]).nullable().default(null),
  /** The G-entry appended technical name (§172.203(k)), if printed separately. */
  technicalName: str(),
  /** Quantity as printed, with its printed unit string (normalised later). */
  quantity: z.object({ value: num(), unit: str() }).default({ value: null, unit: null }),
  grossWeightLb: num(),
  packageCount: int(),
  /** Per-package weight as printed (enables the count × per-package = extended-weight arithmetic check). */
  perPackageWeightLb: num(),
  /** Packaging phrase as printed ("1 cargo tank", "10 drums", "cases"). */
  packaging: str(),
  /** HM-column mark as printed: "X" (hazmat) or "RQ" (reportable quantity). §172.201(a)(1)(i). */
  hmColumnMark: z.enum(["X", "RQ"]).nullable().default(null),
  /** Marks printed on the line/package ("MARINE POLLUTANT", "LIMITED QUANTITY", "HOT"). */
  marks: z.array(z.string()).default([]),
});
export type PrintedHazmatLine = z.infer<typeof printedHazmatLineSchema>;

const pageOfSchema = z.object({ page: int(), of: int() });

/**
 * The page marker each image prints, as printed ("Page 1 of 2", "2/2", "Pg. 1"): EXACTLY one entry per
 * image the read was given, in image order — entry i is image i's marker, or null when image i prints
 * none. Never "" (an empty string is not text on the paper). §172.201(c) (eCFR, current 2026-10-07): "A
 * shipping paper may consist of more than one page, if each page is consecutively numbered and the first
 * page bears a notation specifying the total number of pages included in the shipping paper." A consumer
 * builds "pages present" by parsing the non-null entries — the page numbers seen, against the total the
 * first page states — and knows WHICH image is unnumbered or a duplicate by index. A length other than
 * the image count is a wrong answer, not a sparse one: the acceptance rule checks it, because a schema
 * cannot know how many images a request carried. `pageOf` above stays the one marker the hazmat path reads.
 *
 * WHY null PER IMAGE, NOT "OMIT UNNUMBERED IMAGES". Measured live 2026-10-09 on a synthetic one-page BOL
 * printing "Page 1 of 1": Sonnet 4.6 answered [] (Sonnet 5.5 ["Page 1 of 1"]). Under an omit rule that
 * [] reads as "no image is numbered" — wrong and undetectable; one-per-image makes it a length mismatch.
 * The cost is a union inside the array's items: the same day a probe request with 16 nullable fields
 * PLUS an `array<string|null>` was accepted, so the API did not count it, but that is undocumented, so
 * `schemaComplexity` counts it anyway (the identity section is then 15, strictly under 16).
 */
const printedPageNumbersSchema = z
  .array(z.string().nullable())
  .default([])
  .describe("Exactly one entry per page image, in image order: that image's page marker exactly as printed, or null if it prints none.");

/** A party as printed. Address is one string — split into parts only when a consumer needs them. */
const partySchema = z.object({ name: str(), address: str() }).nullable().default(null);

export const shippingDocumentSchema = z.object({
  identity: z
    .object({
      bolNumber: str(),
      /** The shipping date as printed; parsing it is a consumer's job, against the paper's own format. */
      date: str(),
      /** "Page n of m"; null when the paper prints no marker. */
      pageOf: pageOfSchema.nullable().default(null),
      printedPageNumbers: printedPageNumbersSchema,
    })
    .default({ bolNumber: null, date: null, pageOf: null, printedPageNumbers: [] }),
  parties: z
    .object({ shipper: partySchema, consignee: partySchema, billTo: partySchema })
    .default({ shipper: null, consignee: null, billTo: null }),
  /** Reference numbers by kind, each as printed. A paper often carries several of one kind. */
  references: z
    .object({
      po: z.array(z.string()).default([]),
      customer: z.array(z.string()).default([]),
      consignee: z.array(z.string()).default([]),
    })
    .default({ po: [], customer: [], consignee: [] }),
  freight: z
    .object({
      pieces: int(),
      pallets: int(),
      /** The printed load total with its own unit — never converted here (plan §6: "never converted silently"). */
      weight: num(),
      weightUnit: z.enum(["lb", "kg"]).nullable().default(null),
      seals: z.array(z.string()).default([]),
      trailer: str(),
    })
    .default({ pieces: null, pallets: null, weight: null, weightUnit: null, seals: [], trailer: null }),
  hazmat: z
    .object({
      lines: z.array(printedHazmatLineSchema).default([]),
      /** §172.604 emergency-response phone, digits as printed. */
      emergencyPhone: str(),
      /** §172.204 shipper's certification present on the paper; null = could not tell. */
      shipperCertification: z.boolean().nullable().default(null),
      offeror: str(),
      /**
       * The words printed next to the emergency number, as printed ("EMERGENCY CONTACT: CHEMTREC CCN
       * 12345"). §172.604(b)(2) (eCFR, current 2026-10-07): "The person who is registered with the ERI
       * provider must be identified by name, or contract number or other unique identifier assigned by
       * the ERI provider, on the shipping paper immediately before, after, above, or below the emergency
       * response telephone number"; §172.604(a)(3)(ii) allows the number once per paper only "if it is
       * indicated that the telephone number is for emergency response information (for example:
       * “EMERGENCY CONTACT: * * *”)". Both are paper-audit questions (§5) the digits alone cannot answer.
       * Null when nothing is printed beside the number.
       */
      emergencyContactText: z
        .string()
        .nullable()
        .default(null)
        .describe("The text printed immediately before, after, above or below the emergency phone number, as printed."),
    })
    .default({ lines: [], emergencyPhone: null, shipperCertification: null, offeror: null, emergencyContactText: null }),
  /**
   * Each NON-hazmat line's printed description of the articles, as printed ("Paper products (not
   * regulated)") — the description text only, not the line's package count or weight columns (live
   * 2026-10-09, under a looser wording Sonnet 5.5 wrote the whole row and Sonnet 4.6 the description).
   * §172.201(a)(1) (eCFR, current 2026-10-07): "When a hazardous material and a material not subject to
   * the requirements of this subchapter are described on the same shipping paper, the hazardous material
   * description entries required by § 172.202 and those additional entries that may be required by
   * § 172.203: (i) Must be entered first, or (ii) …" in a contrasting colour, "or (iii) Must be identified
   * by the entry of an “X” placed before the basic shipping description" — so a mixed paper has lines
   * that are not hazmat, and they need a home that is not `hazmat.lines`. Measured 2026-10-09: with no
   * home for them, Sonnet 4.6 put a "Paper products (not regulated)" line INTO `hazmat.lines`; with this
   * field, both Sonnet 4.6 and 5.5 put it here. A non-hazmat line goes here and never into
   * `hazmat.lines`; the hazmat path never reads this list.
   *
   * WHY TOP-LEVEL, not under `freight` or `hazmat`. It is a list of description lines — the sibling of
   * `hazmat.lines`, not a load total like `freight`'s — and under `hazmat` it would read as hazmat data
   * to every consumer that takes the section whole (`bolFieldsFromShippingDocument`). Top-level, the
   * boundary is structural: a consumer of `hazmat` cannot receive a non-hazmat line by construction.
   * It is read in the same section as `hazmat.lines` (SHIPPING_DOCUMENT_SECTIONS) so the one answer
   * that sorts the paper's lines has both bins.
   */
  otherLines: z
    .array(z.string())
    .default([])
    .describe(
      "Each line that is NOT hazardous material: its description of the articles as printed, without its count or " +
        "weight. Never put these in hazmat.lines.",
    ),
  /** The delivery half: what the receiver wrote on the signed copy (Phase 6.2's stop readiness). */
  execution: z
    .object({
      receiverSignaturePresent: z.boolean().nullable().default(null),
      receiverName: str(),
      /** Delivery date/time as printed. */
      deliveredAt: str(),
      /** Over, short and damaged notations, each as written ("2 PCS SHORT", "WRAP TORN"). */
      osdNotations: z.array(z.string()).default([]),
    })
    .default({ receiverSignaturePresent: null, receiverName: null, deliveredAt: null, osdNotations: [] }),
});
export type ShippingDocument = z.infer<typeof shippingDocumentSchema>;

export function emptyShippingDocument(): ShippingDocument {
  return shippingDocumentSchema.parse({});
}

/** Bumped on any change to the schema above; stored on every read and in the cache key (§4.6). */
export const SHIPPING_DOCUMENT_PROFILE_VERSION = "1.1.0";

// ── read sections (Q-DR11, ruled 2026-10-09) ───────────────────────────────────────────────────────
/**
 * The profile is read in three SECTIONS, one strict structured-output request each, run in parallel and
 * merged (`sectionSchema` / `mergeSections`, documentReadingContract.ts). Measured 2026-10-09: the API
 * refuses the whole profile as one strict schema — 37 union parameters against a documented limit of 16
 * per request, and the "16 nullable + 21 optional" variant was refused as "The compiled grammar is too
 * large". A group is a dotted path into the schema, so a section may take part of a top-level key
 * (hazmat's header items here, its lines there); every leaf belongs to exactly one section, and every
 * section's generated wire schema stays strictly under the union limit — both are tests, so a field
 * added later that breaks either fails CI, not a read.
 *
 * Packing, counted by `schemaComplexity` over each section's wire schema (unions; optional is 0 in all):
 *   identity  — identity + parties: 15. Parties are three nullable objects of two nullable strings (9);
 *               printedPageNumbers counts one (its items are nullable).
 *   load      — freight + references + execution + hazmat's header items: 12.
 *   lines     — hazmat.lines + otherLines: 13 (twelve per line plus descriptionText; a list counts once).
 * `otherLines` sits with `hazmat.lines`, not with the load section the research packing first gave it:
 * the measured failure (a non-hazmat line written into `hazmat.lines`) is a sorting error, and only an
 * answer that holds BOTH bins can sort; a lines request with no other bin would repeat it.
 */
export const SHIPPING_DOCUMENT_SECTIONS = [
  { name: "identity", groups: ["identity", "parties"] },
  {
    name: "load",
    groups: [
      "freight", "references", "execution",
      "hazmat.emergencyPhone", "hazmat.shipperCertification", "hazmat.offeror", "hazmat.emergencyContactText",
    ],
  },
  { name: "lines", groups: ["hazmat.lines", "otherLines"] },
] as const;

// ── field criticality (D-DR5) ──────────────────────────────────────────────────────────────────────
/**
 * The hazmat line keys that feed the placard engine — D-DR5's "engine inputs": id, PSN, class, PG,
 * quantity, weight, packaging, LQ, RQ, marine pollutant. LQ and marine pollutant are read from `marks`
 * (`lineDeclaresLq`), RQ from `hmColumnMark`. `technicalName` and `perPackageWeightLb` are audit and
 * arithmetic inputs, not engine inputs, so they graduate at the ordinary bar.
 */
export const ENGINE_INPUT_LINE_KEYS = [
  "idText", "psn", "hazardClass", "pg", "quantity", "grossWeightLb", "packageCount", "packaging",
  "hmColumnMark", "marks",
] as const satisfies readonly (keyof PrintedHazmatLine)[];

export type FieldCriticality = "engine" | "standard";

/**
 * Which bar a field path graduates at. Paths are `fieldEvidenceContract.ts`'s (`hazmat.lines[2].psn`,
 * `hazmat.lines[0].quantity.value`): anything under an engine key of a hazmat line is `engine`.
 */
export function shippingFieldCriticality(path: string): FieldCriticality {
  const m = /^hazmat\.lines\[\d+\]\.([A-Za-z]+)/.exec(path);
  return m && (ENGINE_INPUT_LINE_KEYS as readonly string[]).includes(m[1]!) ? "engine" : "standard";
}

/**
 * D-DR5's graduation bars: consecutive confirmations with zero corrections, under one rule version,
 * before a field may move from Check to Read. Rule of three — zero errors in N puts the 95 % upper bound
 * on the false-accept rate at ≈ 3/N, so 300 → ≤ 1 % and 600 → ≤ 0.5 %. Q-DR8 makes them the owner's.
 */
export const GRADUATION_MIN_CONFIRMATIONS: Readonly<Record<FieldCriticality, number>> = {
  engine: 600,
  standard: 300,
};

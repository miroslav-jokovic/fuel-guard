import { z } from "zod";

/**
 * Importing a PSP record that was bought on the FMCSA portal — PSP-PLAN P14 (D-PSP9).
 *
 * ── WHY THIS EXISTS AT ALL, GIVEN P6 ALREADY BUYS RECORDS ───────────────────────────────────────
 * The API cannot fetch a record we already own. Five endpoints, none of which lists past
 * transactions, and `/Record` needs an `authCode` that expires 120 hours after the request that
 * produced it (guide §7). A carrier switching to FuelGuard therefore has a drawer of PSP PDFs that
 * no integration can recover — and buying them a second time would be paying twice for a record we
 * are already holding lawfully, on a driver who already signed for the first one.
 *
 * So the import is the cheapest thing in the whole PSP feature: no vendor call, no transaction fee,
 * no consent to re-obtain. It exists to make the qualification file complete.
 *
 * ── WHAT AN IMPORT IS NOT ───────────────────────────────────────────────────────────────────────
 * A PDF is not a data feed. The ordered path (P7) files a record whose `detail` carries counted
 * inspections and crashes because `parse.ts` read them out of a structured response; an imported
 * PDF has been read by nobody. That difference is recorded rather than smoothed over — see
 * `pspImportDetail`, which writes `structured: false` and NO counts.
 *
 * Writing `inspections: 0` would have been the easy shape and the dangerous one: zero inspections is
 * a MEANINGFUL claim about a driver (D-PSP5 — a clean record and an unexamined one look identical
 * from the outside), and the cross-check would then corroborate employment history against counts
 * that came from nowhere. An absent field cannot be misread that way.
 *
 * Pure: no database, no storage, no vendor. Everything here is testable as arithmetic on strings.
 */

/**
 * PSP opened to carriers in May 2010. A record cannot predate the programme, and the bound is worth
 * enforcing because the field is hand-typed off a PDF header — `2011-03-04` mistyped as `1011-03-04`
 * is a date Postgres accepts happily and a §391.51 file then dates its own evidence to the 11th
 * century.
 */
export const PSP_PROGRAM_START = "2010-05-01";

/** `qualification_records.detail.source` — what distinguishes an import from a purchase. */
export const PSP_IMPORT_SOURCE = "portal_import";

/**
 * `qualification_records.result` for an imported record.
 *
 * NOT `clean`, and not the operator's reading of the PDF. The ordered path derives `clean` from
 * `isCleanRecord(report)` — a computed fact about structured data. Nothing computed anything here,
 * so the honest value states the provenance and claims nothing about the content. A human's "looks
 * clean to me" typed into an evidence row is an opinion wearing a fact's clothes.
 */
export const PSP_IMPORT_RESULT = "imported";

/** `application/pdf` and nothing else: PSP renders one format, and the kind is not the client's to
 *  choose (the route composes it, as `DISCLOSURES` is composed server-side). */
export const PSP_IMPORT_CONTENT_TYPE = "application/pdf";

/**
 * Step one — register the PDF and get somewhere to PUT it.
 *
 * The id is client-generated so a retry after a dropped response replays instead of registering a
 * second copy, exactly as `documentRegisterSchema` does. There is no `kind` field on purpose: the
 * route forces `psp_report`, because the kind is what carries the §391.53(a)(1) read restriction
 * (0217) — a PSP report registered as `other` would be a PSP report anyone in the section can open.
 */
export const pspImportUploadSchema = z.object({
  driver_id: z.uuid(),
  document_id: z.uuid(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "sha256 must be 64 lowercase hex characters"),
  bytes: z.number().int().positive().nullish(),
});
export type PspImportUpload = z.infer<typeof pspImportUploadSchema>;

/**
 * Step two — file the uploaded PDF as evidence.
 *
 * `consent_obtained` is a literal `true` rather than a boolean, so the schema itself refuses the
 * request that omits it or sends `false`; there is no path through this endpoint that files a PSP
 * record without somebody asserting the consent existed. See `PSP_IMPORT_CONSENT_ATTESTATION` for
 * what is being asserted and why an attestation is the right instrument here.
 */
export const pspImportSchema = z.object({
  driver_id: z.uuid(),
  document_id: z.uuid(),
  /** The date the record was pulled from the portal, off the PDF's own header. */
  obtained_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD"),
  consent_obtained: z.literal(true),
  /** The portal's transaction identifier when the operator has one. Never invented. */
  reference: z.string().max(200).nullish(),
  note: z.string().max(1000).nullish(),
});
export type PspImport = z.infer<typeof pspImportSchema>;

/**
 * What the importing user affirms, stored verbatim on the row.
 *
 * ── WHY AN ATTESTATION AND NOT A `driver_authorizations` CHECK (D-PSP9) ─────────────────────────
 * The ordered path refuses without a live signed `psp` authorization in our own table, and that is
 * right: we are about to make the request, so the consent has to be one we hold. An import is the
 * opposite situation. The pull already happened, on a portal, under an account agreement, before
 * this driver had a row in this system — the consent that authorised it is on paper in a folder and
 * may predate FuelGuard by years. Requiring a digital authorization would refuse to file lawfully
 * obtained evidence, and the workaround would be to back-date a signature into the table that exists
 * precisely so signatures are never back-dated.
 *
 * So the instrument matches the fact: a named person, at a recorded time, asserting the paper exists.
 * Attaching that paper is the natural next step and is a separate document — this text does not
 * claim to be the consent, only that the consent was obtained.
 */
export const PSP_IMPORT_CONSENT_ATTESTATION =
  "I confirm this PSP record was obtained with the driver's written consent, given before the "
  + "record was requested, and that the consent is retained and available for inspection.";

export interface PspImportIssue {
  field: string;
  message: string;
}

/**
 * The rules a date has to survive. Both bounds are about a hand-typed field, not about PSP: the
 * vendor is not involved in an import and nothing here can cost money.
 */
export function validatePspImport(input: PspImport, today: string): PspImportIssue[] {
  const issues: PspImportIssue[] = [];
  if (input.obtained_on > today) {
    issues.push({ field: "obtained_on", message: "A PSP record cannot have been obtained in the future" });
  }
  if (input.obtained_on < PSP_PROGRAM_START) {
    issues.push({
      field: "obtained_on",
      message: `PSP records begin in May 2010; ${input.obtained_on} predates the programme`,
    });
  }
  return issues;
}

/**
 * The `detail` jsonb for the qualification record.
 *
 * Every field answers a question an auditor or a later maintainer actually asks: where did this come
 * from, was anything machine-read out of it, who said the consent existed and what did they say.
 * `structured: false` is the one that earns its place — it is what stops the cross-check (D-PSP5)
 * from treating an unread PDF as a source of inspection data, and what a UI reads to explain why an
 * imported record shows no violation summary.
 */
export function pspImportDetail(input: PspImport, attestedBy: string): Record<string, unknown> {
  return {
    source: PSP_IMPORT_SOURCE,
    structured: false,
    obtained_on: input.obtained_on,
    consent_attestation: PSP_IMPORT_CONSENT_ATTESTATION,
    consent_attested_by: attestedBy,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  };
}

/** Did this record come from the portal rather than from the API? Read by anything that must not
 *  mistake an unread PDF for structured data. */
export const isImportedPspRecord = (detail: Record<string, unknown> | null | undefined): boolean =>
  (detail?.source ?? null) === PSP_IMPORT_SOURCE;

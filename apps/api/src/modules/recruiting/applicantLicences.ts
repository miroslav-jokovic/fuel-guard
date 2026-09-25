/**
 * The two reads AF7's MVR rule needs, by path, shared by the applicant's checklist and the board so
 * the two cannot fold different evidence for one person (D-HM2).
 *
 * ⚠ **Paths, never the payload** — `applicantApplyingAs.ts`'s rule. The draft holds a date of birth
 * and a licence number, and a checklist has no business pulling either. `additional_licences`
 * does come back whole (PostgREST cannot project one key out of each element of an array), so it
 * carries licence NUMBERS into memory: `declaredLicenceJurisdictions` keeps the issuing authority
 * alone, and nothing else in the array is read, returned or logged.
 */
export const DRAFT_LICENCES_SELECT =
  "cdl_state:payload->>cdl_state, additional_licences:payload->additional_licences";

/** The jurisdiction a recorded MVR was filed for (`hiringEvidenceDetail`), and nothing else of `detail`. */
export const RECORD_JURISDICTION_SELECT = "jurisdiction:detail->>jurisdiction";

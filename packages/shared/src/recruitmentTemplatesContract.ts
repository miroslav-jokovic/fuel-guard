import { AUTHORIZATION_PURPOSE_LABELS, type AuthorizationPurpose } from "./authorizationContract.js";
import { APPLICATION_RELEASE_ORDER } from "./applicationIntake.js";

/**
 * The documents the office can print BLANK (MVR-RELEASE-AND-TEMPLATES-PLAN.md MV2, D-MVR2).
 *
 * ── WHAT A TEMPLATE IS FOR ────────────────────────────────────────────────────────────────────
 * The owner's ruling (2026-09-25): templates exist *"in case something goes wrong with electronic
 * documents"* — a driver without a phone that works, a link that will not open, an office with a
 * driver standing at the desk. So a template is the document a driver signs BY HAND, and the office
 * then records that signature back (MV3 for the permissions).
 *
 * ── WHY THE LIST IS DERIVED AND THE BYTES ARE NOT STORED ──────────────────────────────────────
 * ⚠ The permissions are `APPLICATION_RELEASE_ORDER`, read here, not six keys typed out: the list the
 * applicant signs on the link and the list the office can print are one fact, and a seventh permission
 * must appear in both or neither. Every PDF is drawn on request by the SAME renderer that draws the
 * electronic copy (A2's lesson, `instrumentPages.ts`: for four days the office previewed one renderer
 * while the driver signed another). A stored blank would be a second copy of the wording that the
 * next wording change leaves behind.
 *
 * ⚠ **No "paper copy" band on the page, although the plan first said there would be.** Two of these
 * forbid it outright: FMCSA's PSP form must be used *"in whole, exactly as provided … the language
 * may NOT be included with other consent forms or any other language"*, and FCRA §604(b)(2) requires
 * a document that *"consists solely of the disclosure"*. A band on those two would be the very
 * addition the law forbids, and a band on only the other seven would be a rule nobody could state.
 * What records that a signature was on paper is the ROW — `method = 'wet_signature'` and the scan it
 * cites — not a word printed on the form.
 */

export type RecruitmentTemplateGroup = "permission" | "application" | "hire";

export interface RecruitmentTemplate {
  /** The URL segment: `GET /api/recruitment/templates/:key.pdf`. */
  key: string;
  group: RecruitmentTemplateGroup;
  label: string;
  /** One line on WHEN it is signed — what the office needs to hand the right paper over. */
  when: string;
  /** Set for a permission, so the office can record its paper signature against the right purpose. */
  purpose?: AuthorizationPurpose;
}

export const RECRUITMENT_TEMPLATE_GROUP_LABELS: Record<RecruitmentTemplateGroup, string> = {
  permission: "Permissions",
  application: "Application",
  hire: "Before the hire",
};

export const RECRUITMENT_TEMPLATES: readonly RecruitmentTemplate[] = [
  ...APPLICATION_RELEASE_ORDER.map(
    (purpose): RecruitmentTemplate => ({
      key: `permission-${purpose}`,
      group: "permission",
      label: AUTHORIZATION_PURPOSE_LABELS[purpose],
      when: "Signed first, before the application.",
      purpose,
    }),
  ),
  {
    key: "application-packet",
    group: "application",
    label: "Driver application (the carrier's packet)",
    when: "Signed after the permissions. Pages 4 and 19 print their notices: they are not signed here.",
  },
  {
    key: "handbook",
    group: "hire",
    label: "Driver handbook",
    when: "Signed after the application is filed, and countersigned by a Representative.",
  },
  {
    key: "road-test",
    group: "hire",
    label: "Road test examination",
    when: "Filled in and signed by the examiner during the road test.",
  },
];

/** One template by its key, or null — the route's 404. */
export const recruitmentTemplateByKey = (key: string): RecruitmentTemplate | null =>
  RECRUITMENT_TEMPLATES.find((t) => t.key === key) ?? null;

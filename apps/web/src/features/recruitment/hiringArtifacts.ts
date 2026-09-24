import type { RouteLocationRaw } from "vue-router";
import type { HiringEvidenceTable } from "@silvicom/shared";

/**
 * Where a reader goes to see the artifact a hiring step is proved by (B5, D-HUI3).
 *
 * ── WHY THE ADDRESSES ARE HERE AND THE WORDS ARE IN `packages/shared` ─────────────────────────
 * D-HUI3's third column has two halves and they belong in different places. *What the artifact is
 * called* is a fact about the step — the applicant's own screen will fold the same steps (D-HM2)
 * and must call the same document the same thing — so it lives on the spec, in `hiringSteps.ts`.
 * *Where you go to look at it* is a route in this app, which `packages/shared` cannot know and must
 * not learn. This file is that seam, and it is the same one `badges.recruiting.ts` sits on: shared
 * owns the vocabulary, the web app owns the dressing and the addresses.
 *
 * ── THE PART THAT MAKES THIS SAFE RATHER THAN A COPY ──────────────────────────────────────────
 * ⚠ A map beside a catalogue is normally a copy with a delay fuse: somebody adds a step, forgets
 * the entry, and the column is blank for the newest thing in the process with nothing failing. The
 * key here is `HiringEvidenceTable`, a CLOSED union, and the map is a `Record` over it — so a new
 * artifact is a **type error in this file** until somebody says where it is reached. That is the
 * whole reason B5 made the table a union rather than leaving it `string`.
 *
 * ── AND THE FIVE THAT ARE NOT ROUTES ──────────────────────────────────────────────────────────
 * ⚠ Five of the thirteen resolve to `null`, and all five now mean **"it is on the page you are
 * reading"**: B6 made every checklist row open a drawer, so the invitation, the approval, the
 * application, the signed releases and — since Q-HM9 — the previous-employer inquiries are one
 * click away rather than one navigation.
 *
 * ⚠ The fourth of those was a real missing capability when B5 wrote this file — nothing in the
 * office's half of the product showed a signed authorization, the read endpoint existed and no
 * screen called it, and it was recorded as **Q-HUI6** rather than papered over with a link to
 * somewhere near it. **B6 closed it**, and the entry below was corrected at the same time rather
 * than left saying something that had stopped being true. A comment describing a gap that has been
 * filled is worse than no comment: the next reader trusts it.
 */

/** A destination, or nothing — with the reason written down where the reader of this file is. */
export interface HiringArtifactLink {
  to: RouteLocationRaw | null;
  /** Why there is nowhere to go. Non-null exactly when `to` is null. */
  unreachable: string | null;
}

/**
 * The driver's §391.51 file, which is the office's actual filing cabinet.
 *
 * ⚠ It resolves the SIGNED PACKET too, and that is measured rather than assumed:
 * `applicationPdf/file.ts` files the rendered packet as a `documents` row of kind
 * `employment_application` against the driver, cited by a `qualification_records` row — so it is
 * listed and downloadable on that page beside the MVR and the drug test, and does not need an
 * address of its own.
 */
const qualificationFile = (driverId: string): HiringArtifactLink => ({
  to: { name: "driver-detail", params: { id: driverId }, query: { section: "qualification" } },
  unreachable: null,
});

const onThisPage = (what: string): HiringArtifactLink => ({
  to: null,
  unreachable: `${what} is on this page; B6 opens it from the row.`,
});

/**
 * ⚠ Exhaustive by construction. Adding a step to `HIRING_STEPS` with a new evidence table fails
 * `pnpm typecheck` here, which is the only kind of cross-file reminder that actually works.
 */
const DESTINATIONS: Record<HiringEvidenceTable, (driverId: string) => HiringArtifactLink> = {
  "application_invitations": () => onThisPage("The invitation"),
  "application_invitations.approved_at": () => onThisPage("The approved application"),
  "application_invitations.application_sent_at": () => onThisPage("The sent application"),
  "driver_applications": () => onThisPage("The application"),
  // ⚠ Was the one real gap. **Q-HUI6 was CLOSED by B6**: `AuthorizationsPanel` is the drawer behind
  // the Permissions row, so the releases now have a screen and this entry stops claiming otherwise.
  "driver_authorizations": () => onThisPage("The signed releases"),
  "qualification_records.mvr": qualificationFile,
  "qualification_records.psp_report": qualificationFile,
  "qualification_records.clearinghouse_full": qualificationFile,
  "qualification_records.drug_test": qualificationFile,
  "qualification_records.medical_registry_verification": qualificationFile,
  "qualification_records.road_test": qualificationFile,
  "application_packet_marks": qualificationFile,
  // ⚠ Q-HM9's step. On this page since the same change: the investigation got its own checklist row
  // and `EmployerInquirySection` moved out of the application drawer and behind it, so the §391.23
  // written record is one click from the row it proves rather than three screens away.
  "employer_inquiries": () => onThisPage("The previous-employer inquiries"),
  "drivers.hire_date": (driverId) => ({
    to: { name: "driver-detail", params: { id: driverId } },
    unreachable: null,
  }),
};

export function hiringArtifactLink(table: HiringEvidenceTable, driverId: string): HiringArtifactLink {
  return DESTINATIONS[table](driverId);
}

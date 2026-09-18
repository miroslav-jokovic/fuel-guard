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
 * ── AND ONE GAP, NAMED RATHER THAN FAKED ──────────────────────────────────────────────────────
 * ⚠ Four of the twelve resolve to `null`, and three of those are "it is already on the page you are
 * reading" — B6 rebuilds this page as the checklist plus drawers and gives them real affordances.
 * The fourth, `driver_authorizations`, is a genuine missing capability: **nothing in the office's
 * half of the product shows a signed authorization.** The API to read them exists
 * (`GET /api/recruitment/drivers/:driverId/authorizations`) and no screen calls it. Recorded as
 * Q-HUI6 in `HIRING-UI-PLAN.md` §7 rather than papered over with a link to somewhere near it — a
 * row that says "Authorizations" and opens the wrong document is worse than one that does not open.
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
  "driver_applications": () => onThisPage("The application"),
  // ⚠ The one real gap — Q-HUI6. No office screen renders a signed authorization at all.
  "driver_authorizations": () => ({
    to: null,
    unreachable: "No screen shows a signed authorization yet (Q-HUI6).",
  }),
  "qualification_records.mvr": qualificationFile,
  "qualification_records.psp_report": qualificationFile,
  "qualification_records.clearinghouse_full": qualificationFile,
  "qualification_records.drug_test": qualificationFile,
  "qualification_records.medical_registry_verification": qualificationFile,
  "qualification_records.road_test": qualificationFile,
  "application_packet_marks": qualificationFile,
  "drivers.hire_date": (driverId) => ({
    to: { name: "driver-detail", params: { id: driverId } },
    unreachable: null,
  }),
};

export function hiringArtifactLink(table: HiringEvidenceTable, driverId: string): HiringArtifactLink {
  return DESTINATIONS[table](driverId);
}

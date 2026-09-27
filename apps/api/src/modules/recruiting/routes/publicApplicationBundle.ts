import { todayInZone } from "@silvicom/shared";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { listCaptures } from "../applicationCapture.js";
import { applicantVisibleEdits } from "../applicationHandoff.js";
import { loadCarrierWording } from "../carrierWording.js";
import { loadDraft } from "../applicationDraft.js";
import { esignConsentForApplicant } from "../esignConsent.js";
import { isIntakeError, phasesOf, resolveInvitation } from "../applicationIntake.js";
import { releasesForApplicant, signedReleases } from "../applicationReleases.js";
import { adoptedPacketMarks, packetStops } from "../applicationPacketMarks.js";
import { identityOnFile } from "../applicantIdentity.js";
import { partOneStatus } from "../applicantIntake.js";
import { FCRA_SUMMARY } from "../fcraSummary.js";
import { latestRoadTestCertificate } from "../applicationRoadTestCopy.js";
import { linkHandbookStatus } from "../handbookCeremony.js";
import { carrierZone } from "../carrierClock.js";

/**
 * `GET /api/public/apply/:token` — the bundle a link opens on.
 *
 * ⚠ **Split out of `publicApplication.ts` on 2026-09-26 (APPLICATION-FLOW-V2-PLAN §8.5, C1)**, at the
 * 450-line warning, and it is the one route there that WRITES nothing: every other handler records
 * an act, and this one assembles what the page is shown. It moved whole — same reads, same order,
 * same response keys — and `publicApplicationRouter` still registers it first, at the same path.
 * That file's header governs it: every refusal is the same `invalid_link`, and no org id crosses the
 * boundary — the token resolves to the org server-side, here as everywhere on the surface.
 */

/**
 * What the applicant sees when they open the link: which carrier, what is being asked, and the
 * exact wording of each instrument they will be asked to sign. The disclosures are SERVED, never
 * shipped in the client bundle, so what somebody signed is a fact the server can prove.
 */
export const applicationBundleHandler = asyncHandler(async (req, res) => {
  const admin = getSupabaseAdmin(getAppLocals(req).env);
  const invitation = await resolveInvitation(admin, String(req.params.token ?? ""), new Date());
  if (isIntakeError(invitation)) {
    res.status(404).json(apiError(invitation.code, invitation.message));
    return;
  }

  const { data: org } = await admin
    .from("organizations")
    .select("name, legal_address")
    .eq("id", invitation.org_id)
    .maybeSingle();
  // C3c1: the day the application is being made, on the CARRIER's clock — the `asOf` filing judges the
  // three-year windows against (`applicationSubmit.ts`), so the page and the filing count the same days.
  const carrierToday = todayInZone(new Date(), await carrierZone(admin, invitation.org_id));

  // The carrier's own published instruments (0338), or the code's placeholders for anything they
  // have not published. Loaded once and used for both the releases and the consent below, so the
  // page cannot show a published release beside a placeholder consent.
  const wording = await loadCarrierWording(admin, invitation.org_id);

  // What they typed last time (A2). The body is withheld once a date of birth is in it — see
  // `applicationDraft.ts` for why the bare link is not enough to read one back (D-APP16).
  const draft = await loadDraft(admin, invitation.org_id, invitation.id);
  // Which of the four this link has already collected, so a resumed ceremony opens on the next
  // one rather than asking for a signature the driver has already given (A5).
  const signed = await signedReleases(admin, invitation.org_id, invitation.id);
  // And which slots have been photographed (A8), so a resumed session does not ask a driver to
  // take a licence photograph they already took.
  const captures = await listCaptures(admin, invitation.org_id, invitation.id);
  // What the office corrected while it had it (F4, D-AX12). The driver is about to certify that
  // every entry is true — they are owed the changes somebody else made to their statement.
  const edits = await applicantVisibleEdits(admin, invitation.org_id, invitation.id);
  // THIS applicant's places on the carrier's packet (Q-HM14: a company driver has no p31b), in its own page order, each saying whether
  // this link has collected it yet (P5). Served on every load rather than behind the approval,
  // so a driver who opens the link early sees what is still coming instead of an empty screen.
  const packet = await packetStops(admin, invitation.org_id, invitation.id);
  // ⚠ What this link has already adopted, so a RESUMED walk does not ask the driver to retype a
  // mark the server has pinned and then refuse them at the next stop (Q-PKT9).
  const packetAdopted = await adoptedPacketMarks(admin, invitation.org_id, invitation.id);
  // AF3/D-AF1: whether the identity screen still stands between them and the permissions. A
  // boolean and never the values — D-APP16 keeps a date of birth off the bare link.
  const identityComplete = await identityOnFile(
    admin, invitation.org_id, invitation.id, invitation.driver_id,
  );
  // RT4, §391.31(g): the test date of the certificate this link can hand over, so the page offers the
  // download only when pressing it can work. The date and nothing else — the ratings stay on the form.
  const certificate = await latestRoadTestCertificate(admin, invitation.org_id, invitation.driver_id);
  // D-HB1: where the handbook stands, null until the application is filed. Places, never names.
  const handbook = await linkHandbookStatus(admin, invitation);
  // C3a (§6.2): where Part 1 stands — null for a legacy link, which has none. Booleans and a stamp,
  // never an answer, for `identityComplete`'s reason.
  const partOne = await partOneStatus(admin, invitation.org_id, invitation);

  res.json({
    // The carrier's name, and — since C3c1 — the one address §391.21(b)(1) puts on the application
    // itself ("The name and address of the employing motor carrier"), the same `legal_address` the filed
    // PDF prints (`carrierOf`). Nothing else about them: an application link is not a directory.
    carrier: (org as { name?: string } | null)?.name ?? "the carrier",
    carrierAddress: (org as { legal_address?: string | null } | null)?.legal_address ?? null,
    carrierToday,
    expiresAt: invitation.expires_at,
    releases: releasesForApplicant(wording),
    releasesSigned: signed,
    // Where this driver stopped (D-APP1). Three dates and nothing else — the page opens on the
    // step they had reached instead of on a blank form they have already filled in once.
    phases: phasesOf(invitation),
    // C3c2c2 (Q-AW34): once Part 1 is finished a v2 link's form is behind the unlock whether or not the
    // draft holds a date of birth yet — the unlock is what releases Part 1's facts to the page, and a
    // page that never met the gate would never be given them.
    draft: partOne?.completedAt && !draft.locked ? { ...draft, locked: true, payload: null } : draft,
    // The 15 U.S.C. 7001(c) consent, served like every other instrument — the exact text, from
    // the server, so what somebody agreed to is a fact we can prove (A4).
    esignConsent: esignConsentForApplicant(wording.esignConsent),
    // Slots and dates, not pictures (A8) — see `listCaptures` for why the photographs are not
    // re-served to the person who took them.
    captures,
    // Empty for every application nobody has corrected, which is most of them.
    edits,
    // The signing ceremony's queue. Empty of signatures until the office approves — the stops
    // themselves are the carrier's paper and do not depend on anything the driver has done.
    packet,
    // Null on both until the first mark lands, which is every application nobody has started
    // signing — the ordinary case.
    packetAdopted,
    identityComplete,
    roadTestCertificate: certificate ? { testedOn: certificate.occurred_on } : null,
    handbook,
    partOne,
    // The FCRA summary Part 1 ends on (AW3), served — like the instruments — so the version the page
    // posts back names text the server holds. Only to a link that has a Part 1 still to walk.
    fcraSummary: partOne && !partOne.completedAt ? FCRA_SUMMARY : null,
  });
});

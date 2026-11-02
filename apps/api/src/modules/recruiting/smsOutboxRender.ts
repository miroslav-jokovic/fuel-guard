import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SIGN_LINK_LIFETIME_HOURS,
  renderApplicantText,
  smsApplicationApproved,
  smsDrugTestSite,
  smsOptInConfirmation,
  smsSigningLink,
  type DrugTestSiteParams,
  type RecruitingMessageKey,
} from "@silvicom/shared";
import { readCarrierZone } from "./applicantBoardReads.js";
import { carrierName } from "./applicationMail.js";
import { messageInputs } from "./messageWording.js";
import { readTrip, tripLinesFor } from "./applicantTrip.js";
import type { SmsTemplate } from "./smsOutbox.js";

/**
 * A queued text's words, rendered at SEND time from what the row holds — never stored (0376, 0232).
 * Out of `smsOutbox.ts` since §12 MT2 for its file budget, and because it now reads the carrier's wording.
 *
 * ── THE CARRIER'S WORDING IS THE ONE IN FORCE WHEN THE TEXT GOES (§12 D-MT6) ──────────────────
 * The four outbox templates that are catalogue messages (`MESSAGE_OF`) render through
 * `renderApplicantText` with the carrier's newest wording and the applicant's first name, read here at
 * the moment of sending — so a text queued overnight goes in the words the carrier had saved when it
 * went, the instant `sms_outbox.sent_at` records. The trip (`travel`, MT3) is a catalogue message too,
 * rendered from the trip row as it stands when the text goes. The others (opt-in confirmation, approval, sign link,
 * drug-test site) carry rules and are not a carrier's to word (§12 D-MT1).
 */

const MESSAGE_OF: Partial<Record<SmsTemplate, RecruitingMessageKey>> = {
  invite: "invitation",
  application_sent: "application_ready",
  nudge: "reminder",
  orientation_videos: "videos",
};

export async function renderOutboxText(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  template: SmsTemplate,
  params: Record<string, unknown>,
  link: string | null,
): Promise<string> {
  const message = MESSAGE_OF[template];
  if (message) {
    // Q-AW55: the invitation's lifetime travels as a number of days — a date in the params would be a
    // second statement of `expires_at`. The other three say no number.
    const days = template === "invite" ? Number(params.days) : null;
    const { vars, wording } = await messageInputs(admin, orgId, driverId, message, days);
    return renderApplicantText(message, vars, String(link), wording);
  }
  if (template === "travel") {
    // The trip as it stands now: `stillWanted` has just checked it was not cancelled and has not left.
    const trip = await readTrip(admin, orgId, String(params.travel_id ?? ""));
    if (!trip) throw new Error("the trip this text announces is gone");
    const [zone, { vars, wording }] = await Promise.all([
      readCarrierZone(admin, orgId), messageInputs(admin, orgId, driverId, "travel", null),
    ]);
    return renderApplicantText("travel", vars, "", wording, { trip: tripLinesFor(trip, zone) });
  }
  const carrier = await carrierName(admin, orgId);
  if (template === "consent_confirm") return smsOptInConfirmation(carrier);
  if (template === "application_approved") return smsApplicationApproved(carrier);
  if (template === "signing_link") return smsSigningLink(carrier, String(link), SIGN_LINK_LIFETIME_HOURS);
  const zone = await readCarrierZone(admin, orgId);
  const label = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
    .formatToParts(new Date(String(params.window_start)))
    .find((p) => p.type === "timeZoneName")?.value ?? zone;
  return smsDrugTestSite(carrier, params as unknown as DrugTestSiteParams, zone, label);
}

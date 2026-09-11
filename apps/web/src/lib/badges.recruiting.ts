import { toneClass, type DqBadge } from "./badges";

/**
 * The recruiting surface's badges.
 *
 * Split out of `badges.ts` on 2026-09-11 when that file crossed the 500-line budget, and along the
 * seam the file already had: everything here belongs to ONE reader — the recruiter working an
 * applicant from invitation to decision — and nothing else in the product renders any of it.
 *
 * ⚠ The rule `badges.ts` exists for is unchanged and applies here: a badge is
 * `[BADGE_BASE, toneClass(...)]`, the LABEL comes from the shared label map wherever one exists, and
 * no `.vue` file carries a status literal or a local tone `Record`. This is a second file, not a
 * second policy.
 */

/**
 * Application-invitation state (`InviteState`) → badge.
 *
 * The last local tone `Record` in a .vue file, moved here 2026-08-21 as A1's UI-touching PR
 * (RECRUITING-SYSTEM-PLAN §4 flagged it by file and line so nobody would copy it). "Submitted" for
 * `used` deliberately: the machine token predates 0225, and since then a submitted link is not used
 * up — it reopens to what the driver sent. The label was always the honest word for it.
 */
export function applicationInviteBadge(state: string): DqBadge {
  switch (state) {
    case "open":
      return { label: "Not opened yet", tone: "neutral" };
    case "signing":
      return { label: "Signing", tone: "brand" };
    // ⚠ The three F5 added. Before them every one of these read "Open", including an application
    // sitting in the office's own queue.
    case "filling":
      return { label: "Filling it in", tone: "info" };
    case "awaiting_review":
      return { label: "Waiting for you", tone: "warning" };
    case "approved":
      return { label: "Sent back to sign", tone: "brand" };
    case "used":
      return { label: "Submitted", tone: "success" };
    case "revoked":
      return { label: "Revoked", tone: "neutral" };
    case "expired":
      return { label: "Expired", tone: "warning" };
    default:
      return { label: state, tone: "neutral" };
  }
}

/**
 * §391.23 inquiry-queue state (`inquiryQueue.ts` `InquiryState`) → tone. Labels come from
 * `INQUIRY_STATE_LABELS` in shared — the label and the colour deliberately live in the two
 * canonical homes rather than in a page-local `Record`, which is the drift D4 closed.
 * `documented` is neutral for the same reason `no_response` is success-toned below: a documented
 * good-faith effort discharges §391.23(c)(1), so it must never read as a problem.
 */
export function inquiryStateTone(state: string): string {
  return toneClass(
    state === "not_sent" ? "warning"
    : state === "awaiting" ? "info"
    : state === "overdue" ? "danger"
    : state === "answered" ? "success"
    : state === "undeliverable" ? "caution"
    : "neutral",
  );
}

/**
 * §391.23(a)(2) inquiry state (0208's `inquiry_status`) → badge.
 *
 * `no_response` is SUCCESS-toned on purpose and is not a bug to fix later: §391.23(d) lets a carrier
 * rely on a documented non-response, so the obligation is discharged. Colouring it as a problem would
 * nag a recruiter forever about a requirement they have already met.
 */
/**
 * The applicant board's stage chip.
 *
 * ⚠ **Moved here from a local `Record` in `RecruitmentPage.vue` (2026-08-23).**
 * `RECRUITING-SYSTEM-PLAN.md` §4 says tones live in this file only and that
 * `ApplicationInviteCard`'s `STATE_TONE` was "the last survivor". It was not — `STAGE_TONE` was
 * still sitting in the page. Found while adding the disposition chip beside it, and moved rather
 * than matched, because the wrong one is the template the next person copies.
 */
export function applicantStageBadge(stage: string): DqBadge {
  switch (stage) {
    case "not_started":
      return { label: "Not started", tone: "neutral" };
    // ⚠ The three F5 added, and the reason it had to: every one of them read "Not started" before,
    // because the board counted employment rows and those are written only at submission.
    case "filling_in":
      return { label: "Filling it in", tone: "info" };
    // The one stage on this board where the CARRIER owes the next move, which is why it is the only
    // one that shouts.
    case "awaiting_review":
      return { label: "Waiting for you", tone: "warning" };
    case "awaiting_signature":
      return { label: "Waiting for signature", tone: "brand" };
    case "history_incomplete":
      return { label: "History incomplete", tone: "warning" };
    case "awaiting_releases":
      return { label: "Awaiting releases", tone: "caution" };
    case "ready_to_screen":
      return { label: "Ready to screen", tone: "success" };
    default:
      return { label: stage, tone: "neutral" };
  }
}

/**
 * How an application ended, when it ended without a hire (0238).
 *
 * ⚠ **`declined` is `danger` and the other two are `neutral`**, and the difference is not decoration:
 * a decline is the CARRIER's decision and the only one of the three that can ever owe the applicant
 * a notice. A recruiter scanning the board needs to tell at a glance which of these the company did
 * and which happened to it.
 */
export function applicantDispositionBadge(outcome: string): DqBadge {
  switch (outcome) {
    case "declined":
      return { label: "Declined", tone: "danger" };
    case "withdrawn":
      return { label: "Withdrew", tone: "neutral" };
    case "no_response":
      return { label: "No response", tone: "neutral" };
    default:
      return { label: outcome, tone: "neutral" };
  }
}

export function employmentInquiryBadge(status: string): DqBadge {
  switch (status) {
    case "not_required":
      return { label: "Not required", tone: "neutral" };
    case "pending":
      return { label: "Not sent", tone: "danger" };
    case "sent":
      return { label: "Awaiting", tone: "warning" };
    case "responded":
      return { label: "Responded", tone: "success" };
    case "no_response":
      return { label: "No response", tone: "success" };
    default:
      return { label: status, tone: "neutral" };
  }
}

import {
  HIRING_PHASE_LABELS, HIRING_STEP_STATE_LABELS,
  type HiringPhase, type HiringStepState,
} from "@silvicom/shared";
import { CheckCircleIcon, ClockIcon, ExclamationTriangleIcon, NoSymbolIcon } from "@silvicom/ui/icons";
import type { Icon } from "@silvicom/ui/icons";
import { toneClass, type BadgeTone, type DqBadge } from "./badges";

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

/**
 * The hiring board's Stage chip (B4) — the phase of the step an applicant is waiting on.
 *
 * ⚠ **The label is read from `HIRING_PHASE_LABELS`, never written here.** A `case` per phase with a
 * string beside it would be the copy `hiringSteps.ts`'s own header argues against, and it would go
 * stale silently the first time a phase was renamed. What this function decides is the TONE, which
 * is a UI fact and belongs in this file; the words are the catalogue's.
 *
 * ⚠ And every tone but one is `neutral`, which is D-HUI4 applied rather than an unfinished palette:
 * *a board where everything shouts is a board nobody reads*. The stage is context, not an alarm —
 * the loud column is Waiting on, and only when the answer is *you*. `hire` earns `success` because
 * "there is nothing left to do but hire them" is the one stage that is genuinely good news.
 */
export function hiringPhaseBadge(phase: HiringPhase | null): DqBadge {
  if (phase === null) return { label: "Hired", tone: "success" };
  return { label: HIRING_PHASE_LABELS[phase], tone: phase === "hire" ? "success" : "neutral" };
}

/**
 * A badge that carries a glyph as well as a word (D-HUI4).
 *
 * ⚠ `DqBadge` is deliberately left alone rather than widened. Every other badge in this app and its
 * neighbour is a label and a tone, and making `icon` optional on the shared shape would invite a
 * hundred call sites to start answering a question only the hiring states have to answer.
 */
export interface HiringStateBadge extends DqBadge {
  icon: Icon;
}

/**
 * The four step states, dressed (D-HUI4) — **one record, read by both surfaces**.
 *
 * ── WHY THE ICON AND THE TONE ARE DECIDED IN ONE PLACE ────────────────────────────────────────
 * The checklist renders all four states as rows (B5); the board renders two of them as its
 * Waiting-on column (B4). They are the same fact seen from two distances, so a recruiter reads
 * *waiting on you* twice a morning in two places — and the failure to avoid is not a wrong icon but
 * two DIFFERENT right ones, which teaches a reader that the two screens mean different things.
 * `hiringWaitingOnBadge` below reads this record rather than carrying its own pair.
 *
 * ── THE FOUR CHOICES ──────────────────────────────────────────────────────────────────────────
 * ⚠ These are NOT a severity ramp, and D-HUI4 is explicit that they cannot be: *waiting on them*
 * and *waiting on us* are equally "in progress" and are completely different actions. So the glyphs
 * differ in KIND — a clock is somebody else's delay, an alert is a job on your desk — rather than in
 * loudness, and only `waiting_on_us` is toned at all. A board where everything shouts is a board
 * nobody reads, and the office's real question every morning is *"what is mine today?"*.
 *
 * ⚠ The alert triangle on `waiting_on_us` looks alarming for a state that just means "your turn",
 * and it is right anyway for a reason worth writing down: `requires` keeps the number of rows in
 * that state tiny. A freshly invited applicant has exactly ONE — the Clearinghouse query, the only
 * measurable step with no prerequisite. The loudness is bounded by the process, not by taste.
 *
 * ⚠ `blocked` gets the slashed circle the mockup drew as `⊘` and stays neutral: nobody owes
 * anything on a blocked row, and colouring it would ask the reader to act on a row whose whole
 * meaning is that they cannot yet.
 */
const HIRING_STEP_STATE_STYLE: Record<HiringStepState, { tone: BadgeTone; icon: Icon }> = {
  blocked: { tone: "neutral", icon: NoSymbolIcon },
  waiting_on_them: { tone: "neutral", icon: ClockIcon },
  waiting_on_us: { tone: "warning", icon: ExclamationTriangleIcon },
  done: { tone: "success", icon: CheckCircleIcon },
};

/**
 * One checklist row's state (B5) — icon and word, never colour alone (D-HUI4).
 *
 * ⚠ The words come from `HIRING_STEP_STATE_LABELS` in shared, never from a `case` here, for the
 * same reason `hiringPhaseBadge` reads `HIRING_PHASE_LABELS`: the applicant's own screen folds the
 * same states (D-HM2), and two vocabularies for one computation is the disagreement that has already
 * shipped twice. What this file decides is the tone and the glyph, which are UI facts.
 */
export function hiringStepStateBadge(state: HiringStepState): HiringStateBadge {
  return { label: HIRING_STEP_STATE_LABELS[state], ...HIRING_STEP_STATE_STYLE[state] };
}

/**
 * The hiring board's Waiting-on chip (B4) — who owes the next move.
 *
 * ⚠ **This is the only loud thing on the board**, and D-HUI4 says why in as many words: the office's
 * real question every morning is *"what is mine today?"*, and the four step states are not ordered
 * on a good/bad axis — *waiting on them* and *waiting on us* are equally "in progress" and are
 * completely different actions. So `us` is `warning` and `them` is `neutral`: not because chasing
 * somebody is less important, but because a recruiter can only ever act on one of the two.
 *
 * ⚠ "You" and "Them" rather than "Us" and "Applicant". The column is read by the person who owes
 * it, and `applicantStageBadge` already established the second person for exactly this ("Waiting
 * for you"). A board that says "Us" is a board written from the product's point of view.
 *
 * ⚠ **It shipped word-only on 2026-09-18 and D-HUI4 asks for an icon AND a word.** The tones below
 * are B4's unchanged — they were argued for and they already agree with the state record — and what
 * B5 adds is the glyph, TAKEN FROM that record rather than chosen again here. The board and the
 * checklist now say *waiting on you* with the same mark, which is the whole point of doing it in
 * B5's PR rather than leaving two vocabularies a screen apart.
 *
 * ⚠ `null` is not one of the four states: on the board it means the applicant is hired and nobody
 * owes anything, so it borrows `done`'s tick and keeps B4's neutral tone. Success-toning it would
 * put a second green chip beside `hiringPhaseBadge`'s "Hired" on the same row, saying one fact
 * twice in the loudest way available.
 */
export function hiringWaitingOnBadge(who: "us" | "them" | null): HiringStateBadge {
  if (who === "us") return { label: "You", ...HIRING_STEP_STATE_STYLE.waiting_on_us };
  if (who === "them") return { label: "Them", ...HIRING_STEP_STATE_STYLE.waiting_on_them };
  return { label: "Nobody", tone: "neutral", icon: HIRING_STEP_STATE_STYLE.done.icon };
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

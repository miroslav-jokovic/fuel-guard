import type { HiringStepKey } from "./hiringSteps.js";
import type { SmsHoldReason } from "./smsQuietHours.js";

/**
 * The link the office sends for signing (D-AW14, C3s3a): how long it lives, and how many wrong dates of
 * birth it survives.
 *
 * ⚠ The counter is the SENT link's, not the application link's. D-APP16 (`applicationDraftUnlockSchema`)
 * kept the unlock free of any lockout, because a driver mistyping their own birthday at 5am must not need
 * a support call — and that still holds for the link they were invited with. The sign link is different
 * in the one way the owner named: it travels by text and email, and the date of birth guarding it is
 * printed on the CDL photographed in Part 1. So five wrong answers kill it, and the office sends another,
 * which is a press rather than a support call because the driver is in the office when it is sent.
 */
export const SIGN_LINK_LIFETIME_HOURS = 72;
export const SIGN_LINK_UNLOCK_LIMIT = 5;

/** What became of the signing text. `held` names why nothing went; `queued` says when it will. */
export type SigningTextOutcome =
  | { state: "sent" }
  | { state: "queued"; notBefore: string }
  | { state: "held"; reason: SmsHoldReason }
  | { state: "failed" };

/**
 * The office's Send for signing, answered (D-AW14, C3s3a).
 *
 * ⚠ No link in it. Until C3s3a the office's press answered with the sign link for its own screen
 * (D-AF3); now the link goes to the driver's phone and nowhere else, so the office learns only where it
 * went, and "send it again" is the remedy for every way it can fail to arrive.
 */
export interface SigningSent {
  /** The steps D-AF6 warns about that were not done at the press. Keys — the screen reads the words. */
  warnings: HiringStepKey[];
  /** 0369 keeps the FIRST date, however many times it is sent again. */
  signingOpenedAt: string;
  /** This send's link stops working at this instant. */
  signLinkExpiresAt: string;
  email: { sent: boolean; email: string | null; reason: string | null };
  text: SigningTextOutcome;
}

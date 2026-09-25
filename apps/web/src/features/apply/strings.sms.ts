/**
 * The words on the optional text-message card (SMS-OPT-IN-PLAN SMS2, D-SMS1).
 *
 * A fifth file for the reason `strings.identity.ts` gives: `strings.ts` and `strings.flow.ts` sit
 * near their 500-line budget. Spread into `APPLY_COPY`, so `strings.test.ts` walks it.
 *
 * ── WHAT THE CARD MUST SAY, AND WHAT IT MUST NOT ──────────────────────────────────────────────
 * The consent itself is the SERVED document, shown in full above the box — none of it is here, so
 * none of it can drift from what the server stores on the row. These strings are the frame around
 * it: why the offer is worth taking, that it is optional (said in the heading, not buried), and what
 * happened after the press. What they must never do is make texts sound like a step: no "required",
 * no "to continue", nothing that reads as the next move in the application.
 */
export const APPLY_SMS_COPY = {
  sms: {
    heading: "Get a text when it is your turn",
    optional: "Optional",
    intro: (carrier: string): string =>
      `${carrier} can text you when your application is ready to fill in, and about your application after that. Email still comes either way.`,
    phoneLabel: "Mobile number",
    phoneHint: "A US mobile number that can receive texts.",
    phoneInvalid: "Enter a 10-digit US mobile number.",
    consentLabel: "What you are agreeing to",
    terms: "Text message terms",
    privacy: "Privacy policy",
    action: "Turn on texts",
    working: "Saving…",
    failed: "That did not save. Check your signal and try again.",
    onHeading: "Texts are on",
    onBody: (last4: string): string => `We will text the number ending ${last4} about your application.`,
    confirmationSent: "We just sent you a confirmation text.",
    confirmationHeld: "Your confirmation text will arrive during the day — we do not text at night.",
    stopHint: "You can reply STOP to any text, or turn them off here.",
    stop: "Turn off texts",
    stopping: "Turning off…",
    offHeading: "Texts are off",
    offBody: "We will not text you. You can turn them back on below if you change your mind.",
  },
} as const;

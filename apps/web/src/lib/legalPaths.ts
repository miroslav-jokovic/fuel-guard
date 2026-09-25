/**
 * The two URLs the text-message opt-in links to (SMS-OPT-IN-PLAN D-SMS4), and the two a toll-free
 * verification submission names.
 *
 * Constants rather than literals at each call site because the applicant's card, the router and the
 * verification form must all point at the same place — a reviewer who opens a link from the opt-in
 * screenshot and lands on a 404 rejects the submission. In `@/lib` rather than beside `legalMeta.ts`
 * because two features read them (`apply` and `legal`), and `lint:boundaries` keeps each feature's
 * internals its own.
 */
export const SMS_TERMS_PATH = "/sms-terms";
export const SMS_PRIVACY_ANCHOR = "text-messages";
export const SMS_PRIVACY_PATH = `/privacy#${SMS_PRIVACY_ANCHOR}`;

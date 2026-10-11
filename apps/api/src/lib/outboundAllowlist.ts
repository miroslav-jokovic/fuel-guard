import { z } from "zod";

/**
 * Who a non-production environment may email or text (RELEASE-TRAIN-PLAN R4, D-REL4).
 *
 * Staging holds whatever addresses and numbers somebody typed, imported or invited while checking a
 * feature, and nothing about a staging database says they belong to testers. A staging stack with a
 * live Resend/Brevo key and a live Telnyx number is one recruiting nudge away from texting a real
 * applicant from a build nobody approved. That incident is common enough in this industry to have a
 * name; this file is the reason it cannot happen here.
 *
 * `OUTBOUND_ALLOWLIST` is a comma-separated list of exact emails (`tester@example.com`), whole
 * domains (`@example.org`) and E.164 numbers (`+13125550123`). **Unset = no filtering**, which is
 * production. Set = every email recipient and SMS number not on it is dropped at the transport,
 * logged as a count (never the address — the root rule on PII in logs), and the send reports
 * `ok: false` with a detail that names this variable, so a staging page shows a failed send rather
 * than a success that never left.
 *
 * It sits in `sendEmail` and `sendSms` because those are the ONLY two exits: every email in the api
 * goes through `sendEmail` and every text through `sendSms` (the Resend, Brevo and Telnyx URLs appear
 * nowhere else). Push is deliberately NOT filtered: a push token exists in a database only after a
 * person signed in to the driver app against THAT environment's api, so a staging token is a tester's
 * phone by construction.
 *
 * A plain object of Zod fields spread into `EnvSchema`, the `envEfs.ts` shape: one parse, one error.
 */
export const outboundEnvFields = {
  OUTBOUND_ALLOWLIST: z
    .string()
    .optional()
    .transform((s) =>
      s === undefined || s.trim() === ""
        ? null
        : s
            .split(",")
            .map((e) => e.trim().toLowerCase())
            .filter(Boolean),
    ),
};

interface AllowlistEnv {
  OUTBOUND_ALLOWLIST: string[] | null;
}

const digits = (s: string): string => s.replace(/[^\d+]/g, "");

/** May this environment send to this email address or phone number? Pure. */
export function outboundAllowed(env: AllowlistEnv, recipient: string): boolean {
  const list = env.OUTBOUND_ALLOWLIST;
  if (list === null) return true;
  const r = recipient.trim().toLowerCase();
  if (r.includes("@")) {
    const domain = r.slice(r.lastIndexOf("@"));
    return list.includes(r) || list.includes(domain);
  }
  // Numbers compare on digits so "+1 (312) 555-0123" in the env matches the E.164 the sender holds.
  const n = digits(r);
  return n !== "" && list.some((e) => !e.includes("@") && digits(e) === n);
}

/** Split recipients into those this environment may reach and how many it withheld. */
export function partitionRecipients(env: AllowlistEnv, to: string[]): { allowed: string[]; withheld: number } {
  const allowed = to.filter((r) => outboundAllowed(env, r));
  return { allowed, withheld: to.length - allowed.length };
}

export const WITHHELD_DETAIL = "withheld: recipient not on OUTBOUND_ALLOWLIST";

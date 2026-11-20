import { z } from "zod";
import { normalisePhone } from "../../smsConsentContract.js";
import { normaliseEmail } from "./leadContract.js";
import type { OpeningStatus } from "./opening.js";

/**
 * The carrier's public careers page as Settings › Recruiting shows and saves it (APPLY-PAGE-PLAN AP1; 0641's
 * `recruiting_careers_pages`). The public page (AP2/AP3) is the reader of every field; this file is only what
 * crosses the wire and the one rule of what is published, so the card, the public API and the Openings editor
 * hold one answer.
 *
 * ── THE HANDLE ──────────────────────────────────────────────────────────────────────────────────
 * The page lives at `/careers/<handle>` (D-AP1): one link for the company website that stays right while openings
 * come and go. 0641's check is the pattern below, in the office's words; it is a path segment people type, so it
 * is lower case, digits and inner hyphens, 3 to 40 characters.
 *
 * ── THE ACCOMMODATION CONTACT ───────────────────────────────────────────────────────────────────
 * The page's footer names somebody an applicant can ask for an accommodation (D-AP7). 0641 refuses a page that is
 * on without one; the schema below says so before the database has to.
 */

export const CAREERS_HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const careersPageSaveSchema = z
  .object({
    handle: z.string().trim().toLowerCase()
      .regex(CAREERS_HANDLE_PATTERN, "Use 3 to 40 lower-case letters, digits or hyphens, starting and ending with a letter or digit."),
    enabled: z.boolean(),
    accommodationEmail: z.string().trim().max(320).nullable(),
    accommodationPhone: z.string().trim().max(40).nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.accommodationEmail && normaliseEmail(v.accommodationEmail) === null) {
      ctx.addIssue({ code: "custom", path: ["accommodationEmail"], message: "That email address cannot be used." });
    }
    if (v.accommodationPhone && normalisePhone(v.accommodationPhone) === null) {
      ctx.addIssue({ code: "custom", path: ["accommodationPhone"], message: "Enter a 10-digit US number or a number starting with +." });
    }
    if (v.enabled && !v.accommodationEmail && !v.accommodationPhone) {
      ctx.addIssue({
        code: "custom",
        path: ["accommodationEmail"],
        message: "The page must name an email or a phone number for applicants who need an accommodation before it can be on.",
      });
    }
  });
export type CareersPageSave = z.infer<typeof careersPageSaveSchema>;

/**
 * Why an opening is not on the public page (D-AP2), or null when it is. In the order the office fixes them: a
 * closed opening is not "missing a pay top", it is closed. `no_pay_top` is the Illinois Equal Pay Act's rule
 * (Q-APX31 point 1): an opening is published only with the top of its pay range.
 */
export type OpeningUnpublishedReason = "not_open" | "no_version" | "no_pay_top";

export function openingUnpublishedReason(
  status: OpeningStatus,
  current: { facts: { pay: { max_cents: number | null } } } | null,
): OpeningUnpublishedReason | null {
  if (status !== "open") return "not_open";
  if (current === null) return "no_version";
  if (current.facts.pay.max_cents === null) return "no_pay_top";
  return null;
}

/** The office's sentence for each reason. */
export const OPENING_UNPUBLISHED_TEXT: Record<OpeningUnpublishedReason, string> = {
  not_open: "Not open, so not on the careers page.",
  no_version: "Has no saved details yet.",
  no_pay_top: "Not on the careers page: it needs the top of its pay range (Illinois Equal Pay Act).",
};

/** One opening as the card lists it. */
export interface CareersPageOpening {
  id: string;
  title: string | null;
  status: OpeningStatus;
  /** Null when it is on the page. */
  unpublished: OpeningUnpublishedReason | null;
}

export interface CareersPageStatus {
  /** False until a handle is saved: the card then shows only the form. */
  configured: boolean;
  handle: string | null;
  enabled: boolean;
  accommodationEmail: string | null;
  accommodationPhone: string | null;
  /** `<WEB_APP_URL>/careers/<handle>`, the link the company website points at; null until a handle is saved. */
  publicUrl: string | null;
  /** Whether the server holds Turnstile's secret (D-AP6). Off: every application is recorded as "not checked". */
  robotCheckReady: boolean;
  /** Every opening except closed ones, with whether it is published and why not. */
  openings: CareersPageOpening[];
}

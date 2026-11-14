import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applicationPaperFilingIssues,
  applicationV2FilingIssues,
  driverMustAnswer,
  type ApplicationFilingIssue,
} from "@silvicom/shared";
import { applicationAsFiled } from "./applicationAsFiled.js";

/**
 * What the office must complete before it sends an application for signing (D-AM4, Q-AM8 (a); owner
 * 2026-11-09 and 2026-11-11).
 *
 * ── WHY SEND FOR SIGNING REFUSES HERE, WHEN IT ONLY WARNS ON EVERYTHING ELSE ─────────────────────
 * D-AF6 has Send for signing warn, never refuse, on what is outstanding — the federal gates refuse at
 * travel and at hire, where they belong. These are different in kind: they are answers ON the document.
 * The driver may leave an employer's address or an old home's street for the office (`OFFICE_COMPLETES`),
 * and filing refuses without them. A link sent while one is missing sends the driver to sign a document
 * that cannot be filed, and then back to the office. So the office is stopped here, before the driver
 * is, and told exactly what to complete.
 *
 * ── THE SAME RULES AS FILING, ON THE DOCUMENT FILING WILL SEE ─────────────────────────────────────
 * The draft as filed (`applicationAsFiled`, Part 1 laid over it, as the preview and filing compose it),
 * judged by filing's own rules, kept to the ones the office completes. A rule the driver owes is not the
 * office's to fix, and the driver's hand-off already held them to it.
 */

export interface OfficeMustComplete {
  code: "office_must_complete";
  message: string;
}

/** The office's words for one missing answer — the row named the way the drawer lists it. */
function describe(issue: ApplicationFilingIssue, application: Record<string, unknown>): string {
  const [list, at] = issue.path.split(".");
  const row = (((application[list ?? ""] as unknown[]) ?? [])[Number(at)] ?? {}) as Record<string, unknown>;
  const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  if (list === "employers") return `the address of ${text(row.employer_name) || `job ${Number(at) + 1}`}`;
  const place = [text(row.city), text(row.state)].filter(Boolean).join(", ");
  return `the street and ZIP of the address ${place ? `in ${place}` : Number(at) + 1}`;
}

export async function officeMustComplete(
  admin: SupabaseClient,
  invitation: { id: string; org_id: string; driver_id: string },
  now: Date,
): Promise<OfficeMustComplete | null> {
  const { data } = await admin
    .from("application_drafts")
    .select("payload")
    .eq("org_id", invitation.org_id)
    .eq("invitation_id", invitation.id)
    .maybeSingle();
  const payload = (data as { payload?: Record<string, unknown> } | null)?.payload ?? null;
  if (!payload) return null;

  // ⚠ Cast, as the preview casts (`applicationPdf/preview.ts`): a stored draft, judged on what it holds.
  const composed = await applicationAsFiled(
    admin, invitation, { ...payload, addresses: Array.isArray(payload.addresses) ? payload.addresses : [] } as never, now,
  );
  const application = composed.application as unknown as Parameters<typeof applicationV2FilingIssues>[0]
    & Parameters<typeof applicationPaperFilingIssues>[0];
  const missing = [
    ...(composed.asOf ? applicationV2FilingIssues(application, composed.asOf) : []),
    ...applicationPaperFilingIssues(application),
  ].filter((issue) => !driverMustAnswer(issue));
  if (missing.length === 0) return null;

  const items = missing.map((issue) => describe(issue, application as unknown as Record<string, unknown>));
  return {
    code: "office_must_complete",
    message: `Complete ${items.length === 1 ? "this" : "these"} before sending it for signing: ${items.join("; ")}. `
      + "The driver may leave them, and the application cannot be filed without them.",
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canResendApplicationLink,
  renderApplicationInviteEmail,
  renderApplicationLinkResentEmail,
  stoppedBeforeLinkExpires,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { writeAudit } from "../../lib/audit.js";
import { mintInvitationToken } from "./applicationIntake.js";
import { mintIntakeRow } from "./applicantIntake.js";
import { carrierName, deliverApplicationMail, type ApplicationInviteDelivery } from "./applicationMail.js";
import { recruitingSettings } from "./recruitingSettings.js";

/**
 * The office's hold on an applicant's link (C2e: Q-AX5, Q-AX6).
 *
 * ── WHAT WAS MISSING ──────────────────────────────────────────────────────────────────────────
 * Q-AX5 (2026-09-14): the table keeps a hash, so the plaintext link lives only in the email that
 * carried it, and a driver who lost that email had a draft nobody could reach — the only remedy was a
 * new invitation, which opens EMPTY. Q-AX6: the board's only invite action always created a new
 * applicant, and production held four `Marija Varmeda` rows, one per invitation.
 *
 * ── ONE ACTION, AND THE SERVER DECIDES WHICH IT IS ────────────────────────────────────────────
 * `sendApplicationLinkAgain` is the office's "Send the link again", on the applicant's own record. If
 * their current invitation can still be used (`canResendApplicationLink`: not revoked, handbook not yet
 * filed) it REPLACES that invitation's token — same invitation, everything they did kept, the old link
 * dead. Otherwise it opens a new invitation: a fresh, empty application (owner, 2026-09-27). The rule
 * lives here rather than in the button, so the card, the board's drawer and a later caller agree.
 *
 * ⚠ Every query org-filters itself: the service role bypasses RLS. And the audit carries the ids and
 * the expiry, never the token or its hash — an audit log is the last place a credential should be
 * recoverable from.
 */

export interface ApplicationLinkResult {
  invitation: Record<string, unknown>;
  /** The only copy of the link that will ever exist outside the applicant's inbox. */
  link: string;
  delivery: ApplicationInviteDelivery;
  /** `resent` — the same invitation, a new link; `created` — a new invitation, an empty application. */
  mode: "resent" | "created";
}

export interface ApplicationLinkError {
  status: number;
  code: string;
  message: string;
}

export const isApplicationLinkError = (v: unknown): v is ApplicationLinkError =>
  typeof v === "object" && v !== null && "status" in v && "code" in v;

// ⚠ ONE string literal, as the route's own `INVITE_COLS` explains.
export const INVITE_COLS =
  "id, driver_id, email, expires_at, consented_at, intake_completed_at, releases_completed_at, application_sent_at, review_requested_at, approved_at, signing_opened_at, submitted_at, handbook_filed_at, revoked_at, created_at, sign_link_expires_at, unlock_failures";

const applyLink = (env: Env, token: string): string => `${env.WEB_APP_URL}/apply/${token}`;

/** The driver, in this org, and only while they are an applicant (§391.21 is filed BEFORE hire). */
async function applicantOf(admin: SupabaseClient, orgId: string, driverId: string): Promise<{ email: string | null } | ApplicationLinkError> {
  const { data } = await admin
    .from("drivers")
    .select("id, status, email")
    .eq("id", driverId)
    .eq("org_id", orgId)
    .maybeSingle();
  const row = data as { status: string; email: string | null } | null;
  if (!row) return { status: 404, code: "not_found", message: "Driver not found" };
  // An application is what somebody submits BEFORE they are hired. Sending the form to a driver who
  // already works here would collect a §391.21 certification dated after their hire, which is not the
  // document §391.51(b)(1) is asking for.
  if (row.status !== "applicant") {
    return { status: 409, code: "not_an_applicant", message: `This driver is ${row.status}, not an applicant.` };
  }
  return { email: row.email };
}

/** Q-AW51: the override would expire the link before the office's alert could fire. */
export const linkShorterThanDelay = (hours: number): ApplicationLinkError => ({
  status: 422,
  code: "link_shorter_than_delay",
  message: `This link would expire before the driver counts as stopped (after ${hours} hours), so the office would never be told. Make it last longer, or leave it blank for the carrier's setting.`,
});

/**
 * A new invitation (H5) — moved here from the route unchanged in behaviour, because "send the link
 * again" needs it too when the current one is finished.
 *
 * `days` is the invite drawer's override for this one link; absent, the carrier's own lifetime
 * (Q-AW41, `recruitingSettings`) — never a constant, which would quietly overrule the carrier.
 *
 * ⚠ An override is refused when the link would die before its driver counts as stopped (Q-AW51, ruled
 * (a) by the owner 2026-09-29): the reminder sweep skips an expired invitation, so the office would
 * never be told this applicant stopped — Q-AW50's defect on one invitation. The same rule the settings
 * contract holds (`stoppedBeforeLinkExpires`), checked before anything is written.
 *
 * ⚠ Sending never decides whether the invitation exists: the row and the audit are committed before
 * the mailer is touched, and a refused send is reported rather than raised (the route's header).
 */
export async function createApplicationInvite(
  admin: SupabaseClient,
  env: Env,
  input: { orgId: string; userId: string; driverId: string; email: string | null; days?: number },
): Promise<ApplicationLinkResult | ApplicationLinkError> {
  const applicant = await applicantOf(admin, input.orgId, input.driverId);
  if (isApplicationLinkError(applicant)) return applicant;

  const settings = await recruitingSettings(admin, input.orgId);
  if (input.days !== undefined && !stoppedBeforeLinkExpires(input.days, settings.reminder_after_hours)) {
    return linkShorterThanDelay(settings.reminder_after_hours);
  }
  const { token, hash } = mintInvitationToken();
  const days = input.days ?? settings.invite_ttl_days;
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
  const { data, error } = await admin
    .from("application_invitations")
    .insert({
      org_id: input.orgId,
      driver_id: input.driverId,
      token_hash: hash,
      email: input.email,
      expires_at: expiresAt,
      created_by: input.userId,
    })
    .select(INVITE_COLS)
    .single();
  if (error || !data) return { status: 500, code: "db_error", message: "Could not create the invitation" };

  const invitation = data as Record<string, unknown> & { id: string };
  // C3a: a new invitation is a v2 invitation, and "has a Part 1 row" is how every reader tells (plan
  // §7). Two statements, because PostgREST cannot insert into two tables in one — so a row that did
  // not land takes the invitation with it: revoked before its link is shown or sent, rather than left
  // alive to be read as legacy by the fold, the filing and the page.
  if (!(await mintIntakeRow(admin, input.orgId, invitation.id))) {
    await admin
      .from("application_invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", invitation.id)
      .eq("org_id", input.orgId);
    return { status: 500, code: "db_error", message: "Could not create the invitation" };
  }
  await writeAudit(admin, {
    orgId: input.orgId,
    actorId: input.userId,
    action: "compliance.application_invited",
    entity: "application_invitations",
    entityId: invitation.id,
    meta: { driverId: input.driverId, expiresAt, email: input.email },
  });

  const link = applyLink(env, token);
  const carrier = await carrierName(admin, input.orgId);
  const delivery = await deliverApplicationMail(env, input.email, renderApplicationInviteEmail(carrier, link, days));
  return { invitation, link, delivery, mode: "created" };
}

/**
 * The same invitation, a new link (Q-AX5): rotate the hash and keep the link alive for another of the
 * carrier's link lifetimes (Q-AW41) — never shortening it (0232's rule, as the handbook's extension).
 *
 * The UPDATE is conditional on the invitation still being re-sendable, so a revoke or a handbook filing
 * that lands between the read and the write is honoured rather than overwritten.
 */
async function resendOnInvitation(
  admin: SupabaseClient,
  env: Env,
  input: { orgId: string; userId: string; invitation: { id: string; driver_id: string; email: string | null; expires_at: string } },
  now: Date,
): Promise<ApplicationLinkResult | ApplicationLinkError> {
  const { invitation } = input;
  const { invite_ttl_days: ttl } = await recruitingSettings(admin, input.orgId);
  const floor = new Date(now.getTime() + ttl * 86_400_000);
  const expiresAt = Date.parse(invitation.expires_at) > floor.getTime() ? invitation.expires_at : floor.toISOString();
  const { token, hash } = mintInvitationToken();
  const { data, error } = await admin
    .from("application_invitations")
    .update({ token_hash: hash, expires_at: expiresAt })
    .eq("org_id", input.orgId)
    .eq("id", invitation.id)
    .is("revoked_at", null)
    .is("handbook_filed_at", null)
    .select(INVITE_COLS);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (error) return { status: 500, code: "db_error", message: "Could not send the link again" };
  if (rows.length !== 1) {
    return { status: 409, code: "link_changed", message: "That application link changed while you were looking at it. Reload and try again." };
  }

  await writeAudit(admin, {
    orgId: input.orgId,
    actorId: input.userId,
    action: "compliance.application_link_resent",
    entity: "application_invitations",
    entityId: invitation.id,
    // The ids and the expiry (Q-AX5). Never the token or its hash.
    meta: { driverId: invitation.driver_id, expiresAt },
  });

  const link = applyLink(env, token);
  const carrier = await carrierName(admin, input.orgId);
  const days = Math.max(1, Math.round((Date.parse(expiresAt) - now.getTime()) / 86_400_000));
  const delivery = await deliverApplicationMail(env, invitation.email, renderApplicationLinkResentEmail(carrier, link, days));
  return { invitation: rows[0]!, link, delivery, mode: "resent" };
}

/**
 * "Send the link again" (Q-AX5 + Q-AX6): the current invitation's link replaced when it can still be
 * used, a new invitation — an empty application — when it cannot, or when there is none.
 *
 * The current invitation is the newest one not revoked — the rule `liveApplicationInvitation` and
 * `applicantChecklist.ts` both state. A new invitation is addressed to the last one's email, else the
 * driver's own; with neither, the link is only on the office's screen, as creating one always was.
 */
export async function sendApplicationLinkAgain(
  admin: SupabaseClient,
  env: Env,
  input: { orgId: string; userId: string; driverId: string },
  now: Date = new Date(),
): Promise<ApplicationLinkResult | ApplicationLinkError> {
  const applicant = await applicantOf(admin, input.orgId, input.driverId);
  if (isApplicationLinkError(applicant)) return applicant;

  const { data } = await admin
    .from("application_invitations")
    .select("id, driver_id, email, expires_at, revoked_at, handbook_filed_at, created_at")
    .eq("org_id", input.orgId)
    .eq("driver_id", input.driverId)
    .order("created_at", { ascending: false })
    .limit(20);
  type Row = { id: string; driver_id: string; email: string | null; expires_at: string; revoked_at: string | null; handbook_filed_at: string | null };
  const rows = (data ?? []) as Row[];
  const current = rows.find((r) => r.revoked_at === null) ?? null;
  if (current && canResendApplicationLink(current)) {
    return resendOnInvitation(admin, env, { orgId: input.orgId, userId: input.userId, invitation: current }, now);
  }
  const email = rows.find((r) => r.email)?.email ?? applicant.email;
  return createApplicationInvite(admin, env, { orgId: input.orgId, userId: input.userId, driverId: input.driverId, email });
}

/** One applicant who may be the person the office is about to add again (Q-AX6). */
export interface ApplicantMatch {
  id: string;
  full_name: string;
  email: string | null;
  archived: boolean;
}

/** `%` and `_` are wildcards to `ilike`; a name or address containing one must match only itself. */
const literal = (v: string): string => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Applicants already on this org's board — archived ones included, because production's four
 * `Marija Varmeda` rows were archived — with the same email or the same full name, case-insensitive.
 * Two reads rather than one `or()`, whose filter string would need a second escaping for commas and
 * brackets a name can hold.
 */
export async function findExistingApplicants(
  admin: SupabaseClient,
  orgId: string,
  input: { fullName: string; email: string | null },
): Promise<ApplicantMatch[]> {
  const read = (col: "email" | "full_name", value: string) =>
    admin
      .from("drivers")
      // The service role bypasses RLS; this query carries its own tenant scope.
      .select("id, full_name, email, archived_at")
      .eq("org_id", orgId)
      .eq("status", "applicant")
      .ilike(col, literal(value.trim()))
      .limit(10);
  const reads = [read("full_name", input.fullName)];
  if (input.email && input.email.trim()) reads.push(read("email", input.email));
  const found = new Map<string, ApplicantMatch>();
  for (const { data } of await Promise.all(reads)) {
    for (const r of (data ?? []) as Array<{ id: string; full_name: string; email: string | null; archived_at: string | null }>) {
      found.set(r.id, { id: r.id, full_name: r.full_name, email: r.email, archived: r.archived_at !== null });
    }
  }
  return [...found.values()];
}

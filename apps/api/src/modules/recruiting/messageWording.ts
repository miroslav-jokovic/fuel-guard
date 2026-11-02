import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RECRUITING_MESSAGE_KEYS,
  STANDARD_WORDING,
  messageWordingIssues,
  type MessageVars,
  type MessageWording,
  type RecruitingMessageKey,
  type SavedMessageWording,
} from "@silvicom/shared";
import { displayNameFor } from "../../lib/memberLabels.js";
import { carrierName } from "./applicationMail.js";

/**
 * The carrier's wording for the messages an applicant is sent (HIRING-WORKFLOW-AUDIT §12 MT2, 0551).
 *
 * ── NEWEST WINS, AND A FAILED READ IS THE STANDARD WORDS ──────────────────────────────────────
 * 0551 keeps every save (append-only); the wording is the newest row per message. The senders read it
 * through `wordingFor`, which answers the standard wording when nothing is saved AND when the read
 * fails: a message in the product's words is worth sending, a link that did not go out because a
 * settings read failed is not — `carrierName`'s rule. The settings screen reads through
 * `listMessageWording`, which throws instead, so the office is never shown "standard" for a wording it
 * cannot see.
 *
 * ⚠ The service role bypasses RLS (0551 has no client policies): every query here carries its own
 * `.eq("org_id", …)`, asserted by `expectOrgScoped` in the route test.
 */

const COLS = "message_key, email_subject, email_heading, email_paragraph, text_lead, saved_by_name, saved_at";

interface Row {
  message_key: string;
  email_subject: string | null;
  email_heading: string | null;
  email_paragraph: string | null;
  text_lead: string | null;
  saved_by_name: string;
  saved_at: string;
}

const toWording = (r: Row): MessageWording => ({
  emailSubject: r.email_subject,
  emailHeading: r.email_heading,
  emailParagraph: r.email_paragraph,
  textLead: r.text_lead,
});

async function newestRow(admin: SupabaseClient, orgId: string, key: RecruitingMessageKey): Promise<Row | null> {
  const { data, error } = await admin
    .from("recruiting_message_wording")
    .select(COLS)
    .eq("org_id", orgId)
    .eq("message_key", key)
    .order("saved_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not read the message wording: ${error.message}`);
  return (data as Row | null) ?? null;
}

/** What a sender renders with: the carrier's newest wording, or the standard words. Never throws. */
export async function wordingFor(admin: SupabaseClient, orgId: string, key: RecruitingMessageKey): Promise<MessageWording> {
  try {
    const row = await newestRow(admin, orgId, key);
    return row ? toWording(row) : STANDARD_WORDING;
  } catch (e) {
    console.error("[message-wording] read failed, sending the standard words", { orgId, key, detail: (e as Error).message });
    return STANDARD_WORDING;
  }
}

/** Settings → Recruiting's list: every catalogue message, with its newest save. A key 0551 holds that the catalogue does not is not read. */
export async function listMessageWording(admin: SupabaseClient, orgId: string): Promise<SavedMessageWording[]> {
  return Promise.all(RECRUITING_MESSAGE_KEYS.map(async (key) => {
    const row = await newestRow(admin, orgId, key);
    return row
      ? { key, wording: toWording(row), savedAt: row.saved_at, savedByName: row.saved_by_name }
      : { key, wording: STANDARD_WORDING, savedAt: null, savedByName: null };
  }));
}

export interface WordingActor {
  userId: string;
  role: string | null;
  email: string | null;
}

export type WordingSaveError = { status: 400; code: "invalid_wording"; message: string; issues: Partial<Record<keyof MessageWording, string>> };

/**
 * One save: a new row (0551 never edits one). Four nulls is "Use the standard wording". The name on the
 * row is the SESSION's (`displayNameFor`, then the email), never the client's — `carrierSteps.ts`' rule.
 * The placeholder, line and GSM-7 rules are checked here as well as on the screen (D-MT3, D-MT4).
 */
export async function saveMessageWording(
  admin: SupabaseClient,
  orgId: string,
  actor: WordingActor,
  key: RecruitingMessageKey,
  wording: MessageWording,
): Promise<SavedMessageWording | WordingSaveError> {
  const issues = messageWordingIssues(key, wording);
  if (Object.keys(issues).length > 0) {
    return { status: 400, code: "invalid_wording", message: Object.values(issues)[0]!, issues };
  }
  const name = await displayNameFor(admin, actor.userId, orgId, actor.role);
  const byName = (name ?? actor.email ?? "An office user").trim().slice(0, 200) || "An office user";
  const { data, error } = await admin
    .from("recruiting_message_wording")
    .insert({
      org_id: orgId,
      message_key: key,
      email_subject: wording.emailSubject,
      email_heading: wording.emailHeading,
      email_paragraph: wording.emailParagraph,
      text_lead: wording.textLead,
      saved_by: actor.userId,
      saved_by_name: byName,
    })
    .select(COLS)
    .single();
  if (error || !data) throw new Error(`Could not save the message wording: ${error?.message ?? "no row"}`);
  const row = data as Row;
  return { key, wording: toWording(row), savedAt: row.saved_at, savedByName: row.saved_by_name };
}

/** `{first_name}` (D-MT3): the driver's first name, else the first word of the full name, else null ("there"). */
export async function applicantFirstName(admin: SupabaseClient, orgId: string, driverId: string): Promise<string | null> {
  const { data } = await admin
    .from("drivers")
    .select("first_name, full_name")
    .eq("org_id", orgId)
    .eq("id", driverId)
    .maybeSingle();
  return firstNameOf(data as DriverNames | null);
}

export interface DriverNames { first_name?: string | null; full_name?: string | null }

/** The rule itself, for a caller that already read the driver row (the reminder sweep). */
export const firstNameOf = (d: DriverNames | null): string | null =>
  d?.first_name?.trim() || d?.full_name?.trim().split(/\s+/)[0] || null;

/** Everything one message to one applicant is rendered with, in three reads that run together. */
export async function messageInputs(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  key: RecruitingMessageKey,
  days: number | null,
): Promise<{ vars: MessageVars; wording: MessageWording }> {
  const [carrier, firstName, wording] = await Promise.all([
    carrierName(admin, orgId),
    applicantFirstName(admin, orgId, driverId),
    wordingFor(admin, orgId, key),
  ]);
  return { vars: { carrier, firstName, days }, wording };
}

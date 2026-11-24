import { z } from "zod";
import { recordId } from "./recordId.js";

/**
 * The broker-mail gateway's wire with the database (docs/plans/dispatch-loads/BROKER-MAIL-READER-PLAN.md).
 *
 * The gateway (apps/mail-gateway, on Lambda) reaches Postgres only as the login `mail_gateway`, which
 * may EXECUTE the `mailgw_*` functions and touch no table (D-BMR3). Every argument it sends and every
 * row it gets back is a shape below, so the gateway, the functions' matrix and (from P2) the API read
 * the same words. The functions are the authority: each refuses what these schemas would refuse, so
 * a gateway that skipped a parse still cannot write a wrong row. The schemas exist so that it fails
 * in the gateway first, where the cycle can say which mailbox and which field.
 *
 * ── WHAT IS NEVER HERE ─────────────────────────────────────────────────────────────────────────
 * No body, no preview, no attachment, no quoted text: an envelope is the eight fields D-BMR6
 * selects, and the subject is cut to 255 characters. Unmatched reference tokens are counted, never
 * kept (D-BMR7). No org id either: no function takes one, and the org comes from the single
 * `mail_gateway_config` row (D-BMR3, A8). A schema with an `org_id` would be the first half of a
 * gateway that names its company.
 *
 * ⚠ Each vocabulary below is restated in a CHECK in migration 0643. The two are compared by
 * `supabase/tests/mail-gateway-door.test.mjs` ("every vocabulary in brokerMailContract equals its
 * CHECK"), so adding a word here without a migration fails CI.
 */

/** How a message's reference tokens matched loads (D-BMR8). `not_tried`: no token to try. */
export const BROKER_MAIL_MATCH_STATES = ["one", "several", "none", "not_tried"] as const;
export type BrokerMailMatchState = (typeof BROKER_MAIL_MATCH_STATES)[number];

/** Whether the owner's mailbox holds proof of an answer (D-BMR9). */
export const BROKER_MAIL_THREAD_STATES = ["waiting", "answered_by_owner", "answered_by_colleague"] as const;
export type BrokerMailThreadState = (typeof BROKER_MAIL_THREAD_STATES)[number];

/**
 * What Graph said about a mailbox (D-BMR14). `still_connected_after_unlink`: it left the derived
 * list but its inbox still opens — IT has not removed it from the mail group yet.
 */
export const MAIL_GATEWAY_MAILBOX_STATES = ["connected", "not_connected", "over_quota", "still_connected_after_unlink"] as const;
export type MailGatewayMailboxState = (typeof MAIL_GATEWAY_MAILBOX_STATES)[number];

/** The daily probes (D-BMR14). A canary that `opened` switches the gateway off in the same call. */
export const MAIL_GATEWAY_PROBE_KINDS = ["canary", "unlinked"] as const;
export const MAIL_GATEWAY_PROBE_RESULTS = ["refused", "opened", "not_found", "error"] as const;
export type MailGatewayProbeKind = (typeof MAIL_GATEWAY_PROBE_KINDS)[number];
export type MailGatewayProbeResult = (typeof MAIL_GATEWAY_PROBE_RESULTS)[number];

/** The folders D-BMR6 reads. Never Drafts (until P4), Deleted Items or Junk. */
export const MAIL_GATEWAY_FOLDER_ROLES = ["inbox", "inbox_child", "sent"] as const;
export type MailGatewayFolderRole = (typeof MAIL_GATEWAY_FOLDER_ROLES)[number];

/** `broker_mail_messages.subject`'s CHECK. Longer subjects are cut, not refused: a cut subject still dates the row. */
export const BROKER_MAIL_SUBJECT_MAX = 255;
/** At most this many tokens per `mailgw_match_refs` call and per message — more is noise, not a reference. */
export const BROKER_MAIL_MAX_TOKENS = 50;

const address = z.string().trim().toLowerCase().max(320).regex(/^[^@\s]+@[^@\s]+$/, "not an address");
const isoInstant = z.iso.datetime({ offset: true });

/** What `mailgw_begin_cycle` returns: the lease and everything the cycle may know (D-BMR3, D-BMR5). */
export const mailGatewayCycleStartSchema = z.object({
  /** null: another run holds the lease, or the gateway is switched off — the run ends quietly. */
  cycle_id: recordId().nullable(),
  enabled: z.boolean(),
  body_reading: z.boolean(),
  /** Q-BMR10: what "internal" means. Empty = no mailbox is derived at all. */
  mail_domains: z.array(z.string()),
  mailboxes: z.array(z.object({ mailbox: address, owner_user_id: recordId() })),
  /** Folder delta positions this gateway saved, per mailbox (D-BMR6). */
  cursors: z.array(z.object({ mailbox: address, folder_id: z.string(), folder_role: z.enum(MAIL_GATEWAY_FOLDER_ROLES), delta_link: z.string() })),
  /** Mailboxes due a daily probe: the canary is not here (it comes from Parameter Store), only unlinked ones. */
  probe_unlinked: z.array(address),
  /** Sender domains that matched a load in the last 45 days — half of D-BMR6's "candidate" rule. */
  known_sender_domains: z.array(z.string()),
});
export type MailGatewayCycleStart = z.infer<typeof mailGatewayCycleStartSchema>;

/** One envelope for `mailgw_record_messages` (D-BMR7). `mailbox` must be in the cycle's derived list. */
export const brokerMailEnvelopeSchema = z.object({
  mailbox: address,
  internet_message_id: z.string().min(1).max(998),
  conversation_id: z.string().min(1).max(512).nullable(),
  from_address: address.nullable(),
  received_at: isoInstant,
  subject: z.string().transform((s) => s.slice(0, BROKER_MAIL_SUBJECT_MAX)).nullable(),
  /** The mailbox's own address was in To/Cc — false means it came through a list (Q-BMR4). */
  addressed_directly: z.boolean(),
  was_candidate: z.boolean(),
  body_was_read: z.boolean(),
  /** Tokens to match, normalised by the gateway; the function matches and keeps only the ones that hit. */
  tokens: z.array(z.string().min(1).max(64)).max(BROKER_MAIL_MAX_TOKENS),
});
export type BrokerMailEnvelope = z.infer<typeof brokerMailEnvelopeSchema>;

/**
 * An answer seen in the owner's own mailbox (D-BMR9): a Sent Items message, or an internal arrival
 * (a colleague's reply-all), on the conversation — with the broker among its recipients, because
 * unrelated mail can share a conversation (V6). The function closes only `waiting` rows of that
 * mailbox and conversation received BEFORE `answered_at`.
 */
export const brokerMailAnswerSchema = z.object({
  mailbox: address,
  conversation_id: z.string().min(1).max(512),
  answered_at: isoInstant,
  by: z.enum(["owner", "colleague"]),
  /** Every To/Cc address of the answer; the function checks the waiting row's sender is among them. */
  recipients: z.array(address).max(500),
});
export type BrokerMailAnswer = z.infer<typeof brokerMailAnswerSchema>;

/** `mailgw_end_cycle`'s counts — the heartbeat and the measure week's daily sums (§8). */
export const mailGatewayCycleCountsSchema = z.object({
  mailboxes_read: z.number().int().nonnegative(),
  mailboxes_skipped: z.number().int().nonnegative(),
  messages_in: z.number().int().nonnegative(),
  external: z.number().int().nonnegative(),
  candidates: z.number().int().nonnegative(),
  bodies_read: z.number().int().nonnegative(),
  graph_throttled: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
});
export type MailGatewayCycleCounts = z.infer<typeof mailGatewayCycleCountsSchema>;

/**
 * A reference token as both sides compare it (D-BMR8, exact match only in P1): upper case, with
 * everything that is not a letter or digit removed, so "PO# 12-345" and "po12345" meet. The SQL side
 * applies `upper(regexp_replace(x, '[^A-Za-z0-9]', '', 'g'))` to the load's columns, and the matrix
 * pins the two to the same answers. Shorter than 4 characters is not a reference.
 */
export function normaliseBrokerMailToken(raw: string): string | null {
  const t = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return t.length >= 4 && t.length <= 64 ? t : null;
}

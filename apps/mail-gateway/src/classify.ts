import { brokerMailTokensIn, type BrokerMailAnswer, type BrokerMailAskKind, type BrokerMailEnvelope } from "@silvicom/shared";

/**
 * What one Graph message means for 360 — pure, so every rule here is a unit test (D-BMR6, D-BMR9).
 *
 * An Inbox message from OUTSIDE our mail domains is an envelope row. An Inbox message from INSIDE
 * (a colleague's reply-all) and every Sent Items message are possible PROOF that a thread was
 * answered, and are never stored. The database repeats the internal/external rule on write
 * (`mailgw_record_messages` skips internal senders), so a mistake here can lose a row but never
 * store a colleague's mail.
 */

export type GraphMessage = Record<string, unknown>;
type Address = { emailAddress?: { address?: unknown } };

const addressOf = (a: unknown): string | null => {
  const x = (a as Address | undefined)?.emailAddress?.address;
  return typeof x === "string" && x.includes("@") ? x.trim().toLowerCase() : null;
};
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(addressOf).filter((x): x is string => x !== null) : []);
const domainOf = (address: string | null): string | null => (address ? address.slice(address.lastIndexOf("@") + 1).toLowerCase() : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function isInternal(address: string | null, mailDomains: readonly string[]): boolean {
  const d = domainOf(address);
  return d !== null && mailDomains.some((m) => m.toLowerCase() === d);
}

/** The token rule, shared with the API's measure-week report (`brokerMailTokensIn`, D-BMR8). */
export const tokensIn = brokerMailTokensIn;

/**
 * What a broker asks (D-BMR11, 0656), by fixed word rules — the closed list, never the words. Read on
 * the subject, and on the body while it is held in memory when body reading is on. A plain "update?" or
 * "status?" is an ETA question: that is what brokers chase, and the mockup's drafts answered it so. A
 * broker email whose question no rule names is `other`: its draft gives the load's status and leaves a
 * line for the dispatcher (ruled 2026-11-24). Pure, so every rule is a test (`classify.test.ts`).
 */
const ASK_RULES: readonly [BrokerMailAskKind, RegExp][] = [
  ["tracking_link", /\b(macro\s?point|trucker\s?tools|four\s?kites|project\s?44|p44|tracking\s+(link|request|invite)|accept\s+(the\s+)?tracking)\b/i],
  ["pod", /\b(pod|proof\s+of\s+delivery|signed\s+(bol|bill\s+of\s+lading|paperwork))\b/i],
  ["appointment", /\b(appt|appointment|scheduled?\s+(time|delivery|pickup)|check[\s-]?in\s+time)\b/i],
  ["delay_reason", /\b(late|delay(ed)?|running\s+behind|behind\s+schedule|why\s+(is|has)n?'?t?)\b/i],
  ["location", /\b(where\s+is|where's|location|current\s+position|gps|whereabouts|ping)\b/i],
  ["eta", /\b(eta|e\.t\.a|arriv(e|al|ing)|how\s+far|when\s+will|update|status|any\s+news)\b/i],
];

export function askKindsIn(...texts: (string | null)[]): BrokerMailAskKind[] {
  const all = texts.filter((t): t is string => Boolean(t)).join("\n");
  const out = ASK_RULES.filter(([, re]) => re.test(all)).map(([k]) => k);
  return out.length ? out : ["other"];
}

export interface InboxVerdict {
  /** External: becomes a row. Internal: maybe a colleague's answer, never a row. */
  external: boolean;
  /** D-BMR6: external AND (a reference-shaped token in the subject OR a sender domain that matched before). */
  candidate: boolean;
  envelope: Omit<BrokerMailEnvelope, "body_was_read" | "tokens" | "ask_kinds"> & { tokens: string[] };
  /** Graph's own id, for shape 3 — kept only for this cycle. */
  graphId: string | null;
}

export function classifyInbox(
  msg: GraphMessage,
  ctx: { mailbox: string; mailDomains: readonly string[]; knownSenderDomains: ReadonlySet<string> },
): InboxVerdict | null {
  const internetMessageId = str(msg.internetMessageId);
  const receivedAt = str(msg.receivedDateTime);
  if (!internetMessageId || !receivedAt) return null; // a draft or a malformed item — nothing to date
  const from = addressOf(msg.from);
  const subject = str(msg.subject);
  const tokens = tokensIn(subject);
  const external = from !== null && !isInternal(from, ctx.mailDomains);
  const recipients = [...list(msg.toRecipients), ...list(msg.ccRecipients)];
  const candidate = external && (tokens.length > 0 || ctx.knownSenderDomains.has(domainOf(from) ?? ""));
  return {
    external,
    candidate,
    graphId: str(msg.id),
    envelope: {
      mailbox: ctx.mailbox,
      internet_message_id: internetMessageId,
      conversation_id: str(msg.conversationId),
      from_address: from,
      received_at: receivedAt,
      subject,
      addressed_directly: recipients.includes(ctx.mailbox.toLowerCase()),
      was_candidate: candidate,
      tokens,
    },
  };
}

/**
 * D-BMR9's proof, as the database will check it: a later message on the conversation, in the
 * owner's own mailbox, with its recipients. A Sent Items message is the owner's answer; an internal
 * Inbox arrival is a colleague's — or the owner's, if the owner wrote it from another device.
 */
export function answerFrom(msg: GraphMessage, ctx: { mailbox: string; folder: "inbox" | "sent" }): BrokerMailAnswer | null {
  const conversationId = str(msg.conversationId);
  const at = ctx.folder === "sent" ? str(msg.sentDateTime) ?? str(msg.receivedDateTime) : str(msg.receivedDateTime);
  if (!conversationId || !at) return null;
  const recipients = [...list(msg.toRecipients), ...list(msg.ccRecipients)];
  if (recipients.length === 0) return null;
  const from = addressOf(msg.from);
  const by = ctx.folder === "sent" || from === ctx.mailbox.toLowerCase() ? "owner" : "colleague";
  return { mailbox: ctx.mailbox, conversation_id: conversationId, answered_at: at, by, recipients: recipients.slice(0, 500) };
}

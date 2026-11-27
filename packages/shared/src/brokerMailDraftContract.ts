import { z } from "zod";
import { recordId } from "./recordId.js";
import {
  BROKER_MAIL_ASK_KINDS,
  BROKER_MAIL_DRAFT_FACTS,
  BROKER_MAIL_DRAFT_STATES,
  BROKER_MAIL_DRAFT_TEXT_MAX,
  BROKER_MAIL_PERSON_CLOSES,
  type BrokerMailDraftFact,
} from "./brokerMailContract.js";

/**
 * The Broker mail page's email panel and its reply draft (BROKER-MAIL-READER-PLAN P4, D-BMR11).
 *
 * ── WHERE A DRAFT'S WORDS COME FROM ────────────────────────────────────────────────────────────
 * The load's facts, read by the API from the Dispatch board's own rows (`readLoadStatusFacts` in
 * livemap) — the same truck, trailer, next stop, ETA and miles a dispatcher sees there — plus the
 * closed list of what the broker asks (`ask_kinds`). NOTHING a broker wrote: no body, no subject, no
 * sender's name. The model words the answer and computes nothing; `draftFactCheck` then refuses any
 * number or state code the facts do not contain. A missing fact is said as missing.
 *
 * ── THE DISPATCHER DECIDES ─────────────────────────────────────────────────────────────────────
 * Compose returns a proposal; the dispatcher reads it, may edit it, and presses "Put draft in Outlook".
 * Even then 360 never sends: the text becomes a reply DRAFT in their own Outlook, and they press Send
 * there (owner ruling 2026-11-23). An edited text is not fact-checked again — those are their words.
 */

const id = recordId();
const instant = z.string();

/** One load's facts as the draft may state them. Every field the board cannot answer is null. */
export const brokerMailLoadFactsSchema = z.object({
  loadRef: z.string().nullable(),
  customerName: z.string().nullable(),
  /** McLeod's own word for the load (`loads.external_status`), or 360's status for a load not from McLeod. */
  status: z.string().nullable(),
  /** The load came from McLeod (`source = 'tms'`). A tracking request's answer must say so (ruling 2026-11-23). */
  inMcleod: z.boolean(),
  /** On a truck now: McLeod's approved/in transit, or a 360 load accepted/in transit (`isLoadOnTruck`). */
  accepted: z.boolean(),
  truckUnit: z.string().nullable(),
  trailerUnit: z.string().nullable(),
  /** The truck's last GPS place and how old it is, in minutes. */
  location: z.object({ place: z.string(), ageMinutes: z.number().int() }).nullable(),
  nextStop: z.object({
    kind: z.enum(["pickup", "delivery", "stop"]),
    city: z.string().nullable(),
    state: z.string().nullable(),
    appointment: z.string().nullable(),
    arrived: z.boolean(),
  }).nullable(),
  /** The board's ETA to the next stop, in the carrier's clock ("2:30 PM CT"), and when it was worked out. */
  eta: z.object({ at: z.string(), computedAt: instant }).nullable(),
  milesToNextStop: z.number().int().nullable(),
  onTime: z.enum(["on_time", "at_risk", "late", "unknown"]).nullable(),
});
export type BrokerMailLoadFacts = z.infer<typeof brokerMailLoadFactsSchema>;

export const brokerMailDraftSchema = z.object({
  id,
  state: z.enum(BROKER_MAIL_DRAFT_STATES),
  requestedAt: instant,
  inOutlookAt: instant.nullable(),
  composedBy: z.enum(["model", "edited"]),
});
export type BrokerMailDraft = z.infer<typeof brokerMailDraftSchema>;

/** `GET /api/broker-mail/messages/:id` — the panel. */
export const brokerMailDetailSchema = z.object({
  id,
  receivedAt: instant,
  fromAddress: z.string().nullable(),
  subject: z.string().nullable(),
  threadState: z.string(),
  askKinds: z.array(z.enum(BROKER_MAIL_ASK_KINDS)),
  load: z.object({ id, ref: z.string().nullable() }).nullable(),
  facts: brokerMailLoadFactsSchema.nullable(),
  /** The newest draft for this email, if any. */
  draft: brokerMailDraftSchema.nullable(),
  /** Whether the caller may compose and close: only the mailbox's owner — it is their Outlook. */
  isOwner: z.boolean(),
  /** Whether 360 can write drafts at all yet (the mail scope's write permission is Microsoft's side). */
  draftsAvailable: z.boolean(),
});
export type BrokerMailDetail = z.infer<typeof brokerMailDetailSchema>;

/** `POST /messages/:id/compose` → a proposal; nothing is stored but the cost ledger row. */
export const brokerMailComposeSchema = z.object({
  text: z.string().min(1).max(BROKER_MAIL_DRAFT_TEXT_MAX),
  factsIncluded: z.array(z.enum(BROKER_MAIL_DRAFT_FACTS)),
  /** SHA-256 of `text`, handed back with the queue request so the API can tell an edited text. */
  textSha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type BrokerMailCompose = z.infer<typeof brokerMailComposeSchema>;

/** `POST /messages/:id/draft` — the text the dispatcher approved, to be put in their Outlook. */
export const brokerMailQueueDraftSchema = z.object({
  text: z.string().trim().min(1).max(BROKER_MAIL_DRAFT_TEXT_MAX),
  factsIncluded: z.array(z.enum(BROKER_MAIL_DRAFT_FACTS)).max(BROKER_MAIL_DRAFT_FACTS.length),
  /** The proposal's SHA-256; a different text is `edited`. */
  composedSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
});
export type BrokerMailQueueDraft = z.infer<typeof brokerMailQueueDraftSchema>;

/** `POST /messages/:id/close` — the mockup's "Not for us" / "Handled by phone". */
export const brokerMailCloseSchema = z.object({ how: z.enum(BROKER_MAIL_PERSON_CLOSES) });
export type BrokerMailClose = z.infer<typeof brokerMailCloseSchema>;

/** What a broker asks, in a dispatcher's words: the panel's badges. */
export const BROKER_MAIL_ASK_LABELS: Record<(typeof BROKER_MAIL_ASK_KINDS)[number], string> = {
  eta: "ETA", location: "Where the truck is", tracking_link: "Tracking request", appointment: "Appointment",
  pod: "POD / signed BOL", delay_reason: "Why it is late", other: "Something else",
};
/** The same, as short as a text message needs ("asks ETA, tracking"). */
export const BROKER_MAIL_ASK_SHORT: Record<(typeof BROKER_MAIL_ASK_KINDS)[number], string> = {
  eta: "ETA", location: "location", tracking_link: "tracking", appointment: "appointment",
  pod: "POD", delay_reason: "why late", other: "a question",
};

/** The Broker mail page with one email's panel open — what the dispatcher's text links to. */
export function brokerMailEmailPath(messageId: string): string {
  return `/broker-mail?email=${encodeURIComponent(messageId)}`;
}

/** The words the panel prints for a draft's state. One home. */
export const BROKER_MAIL_DRAFT_STATE_LABELS: Record<(typeof BROKER_MAIL_DRAFT_STATES)[number], string> = {
  queued: "Going to your Outlook…",
  claimed: "Going to your Outlook…",
  in_outlook: "In your Outlook — open it and press Send",
  answered_first: "Not made: the email was answered first",
  person_draft_found: "Not made: you already started a reply in Outlook",
  not_found: "Not made: the email is no longer in your mailbox",
  refused: "Not made: Microsoft does not let 360 write drafts yet",
  failed: "Not made: something went wrong — try again",
  expired: "Not made: the mail reader did not run in time — try again",
  removed: "Removed: you answered in your own words",
  sent_or_gone: "Sent or deleted in Outlook",
};

/**
 * The fact check (D-BMR11): every number in a model's draft must be one the facts contain, and every
 * two-letter state code too. A draft that names a time, a mile count or a reference the board did not
 * give is refused rather than shown — the model words, it never computes. Pure, shared, so the API
 * refuses and the tests pin the same rule. An EDITED text is not checked: it is the dispatcher's.
 *
 * Its limit, stated: a city written out in words is not checked (a closed list of US cities does not
 * exist in 360). The facts hand the model only the next stop's city, and the prompt forbids any other.
 */
const US_STATES = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" "));

export function draftFactCheck(text: string, facts: BrokerMailLoadFacts): { ok: true } | { ok: false; unknown: string[] } {
  const source = JSON.stringify(facts);
  const known = new Set(source.match(/\d+/g) ?? []);
  const states = new Set((source.match(/\b[A-Z]{2}\b/g) ?? []).filter((s) => US_STATES.has(s)));
  const unknown = [
    ...(text.match(/\d+/g) ?? []).filter((n) => !known.has(n)),
    ...(text.match(/\b[A-Z]{2}\b/g) ?? []).filter((s) => US_STATES.has(s) && !states.has(s)),
  ];
  return unknown.length ? { ok: false, unknown: [...new Set(unknown)] } : { ok: true };
}

/** Which facts a text states — what P5 compares a sent reply against. */
export function factsStated(facts: BrokerMailLoadFacts, claimed: readonly BrokerMailDraftFact[]): BrokerMailDraftFact[] {
  const has: Record<BrokerMailDraftFact, boolean> = {
    status: facts.status !== null, accepted: true, truck: facts.truckUnit !== null, trailer: facts.trailerUnit !== null,
    location: facts.location !== null, eta: facts.eta !== null, miles_left: facts.milesToNextStop !== null,
    appointment: facts.nextStop?.appointment != null, next_stop: facts.nextStop !== null,
  };
  return [...new Set(claimed)].filter((f) => has[f]);
}

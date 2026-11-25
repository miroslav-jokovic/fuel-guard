import { z } from "zod";
import { recordId } from "./recordId.js";
import { BROKER_MAIL_MATCH_STATES, BROKER_MAIL_ROSTER_REASONS, BROKER_MAIL_THREAD_STATES, MAIL_GATEWAY_MAILBOX_STATES, MAIL_GATEWAY_PROBE_RESULTS } from "./brokerMailContract.js";

/**
 * The Broker mail page and Settings › Broker mail — the API's wire with the web (BROKER-MAIL-READER-PLAN
 * §9 P2). `brokerMailContract.ts` is the gateway's wire with the database; this is what a PERSON is
 * sent, so it is shaped for reading, and nothing here is a field the gateway may set.
 *
 * ── WHOSE ROWS (Q-BM9, analysis §6.2) ──────────────────────────────────────────────────────────
 * A row belongs to the dispatcher whose mailbox received it. The API filters on `owner_user_id` =
 * the caller, unless the caller holds the named permission `dispatch.broker_mail_all`
 * (`rolePermissions.ts`), which only the admin holds until an admin switches it on for a role. The
 * filter is the boundary — the tables are deny-all and the service role bypasses RLS.
 */

/** The page's three queues, in strip order (the mockup's Waiting / Needs a load / Handled). */
export const BROKER_MAIL_TABS = ["waiting", "needs_load", "handled"] as const;
export type BrokerMailTab = (typeof BROKER_MAIL_TABS)[number];

export const BROKER_MAIL_TAB_LABELS: Record<BrokerMailTab, string> = {
  waiting: "Waiting",
  needs_load: "Needs a load",
  handled: "Answered",
};

/**
 * How far back each queue looks. An unanswered broker email older than a week is history, not work;
 * "Answered" is the last day's, so a dispatcher can see what closed itself. Rows live 90 days
 * (Q-BMR6) whatever the page shows.
 */
export const BROKER_MAIL_OPEN_DAYS = 7;
export const BROKER_MAIL_ANSWERED_HOURS = 24;
/** Per response. A queue longer than this is a gateway or matching problem the admin should see. */
export const BROKER_MAIL_PAGE_LIMIT = 500;

/** `broker_mail_settings.answer_within_minutes`'s CHECK (0649) and default (Q-BM7). */
export const BROKER_MAIL_ANSWER_MIN = 5;
export const BROKER_MAIL_ANSWER_MAX = 240;
export const BROKER_MAIL_ANSWER_DEFAULT = 20;
/** `broker_mail_settings.backup_after_minutes`'s CHECK (0651) and default (Q-BM7: "+5"). */
export const BROKER_MAIL_BACKUP_MIN = 1;
export const BROKER_MAIL_BACKUP_MAX = 120;
export const BROKER_MAIL_BACKUP_DEFAULT = 5;
/** At most this many backups per dispatcher — a notice to the whole office is not a backup. */
export const BROKER_MAIL_MAX_BACKUPS = 5;

/**
 * Can a person be texted (P3)? `ready`: a confirmed number, not stopped. `stopped`: they replied STOP —
 * honoured whatever Q-BM11 says, so the admin sees it in red. `unconfirmed` / `none`: no number to text yet.
 */
export const BROKER_MAIL_TEXT_STATES = ["ready", "stopped", "unconfirmed", "none"] as const;
export type BrokerMailTextState = (typeof BROKER_MAIL_TEXT_STATES)[number];

const id = recordId();
const instant = z.string();

export const brokerMailRowSchema = z.object({
  id,
  receivedAt: instant,
  fromAddress: z.string().nullable(),
  fromDomain: z.string().nullable(),
  subject: z.string().nullable(),
  matchState: z.enum(BROKER_MAIL_MATCH_STATES),
  /** The one load the references matched (`match_state = 'one'`), with its reference. */
  load: z.object({ id, ref: z.string().nullable() }).nullable(),
  /** References that hit more than one load, or the one that hit — what the gateway recognised. */
  matchedRefs: z.array(z.string()),
  threadState: z.enum(BROKER_MAIL_THREAD_STATES),
  answeredAt: instant.nullable(),
  /** false: the email reached the mailbox through a list or a shared address (Q-BMR4). */
  addressedDirectly: z.boolean(),
  ownerUserId: id,
  /** Only filled when the caller sees every dispatcher's rows. */
  ownerName: z.string().nullable(),
});
export type BrokerMailRow = z.infer<typeof brokerMailRowSchema>;

export const brokerMailListSchema = z.object({
  tab: z.enum(BROKER_MAIL_TABS),
  rows: z.array(brokerMailRowSchema),
  /** Each queue's size, so the strip's counts answer before the other tabs are opened. */
  counts: z.object({ waiting: z.number().int(), needs_load: z.number().int(), handled: z.number().int() }),
  answerWithinMinutes: z.number().int(),
  /** The caller may see every dispatcher's rows (and filter by one). */
  seesAll: z.boolean(),
  /** The dispatchers the caller may filter by — empty unless `seesAll`. */
  dispatchers: z.array(z.object({ userId: id, name: z.string() })),
  /**
   * Is the CALLER's own mailbox read, and if not, why (the roster's reason, 0649). `not_dispatcher`:
   * no active McLeod login is linked to them. `off`: the company's mail reading is switched off.
   */
  myMailbox: z.object({
    read: z.boolean(),
    reason: z.enum([...BROKER_MAIL_ROSTER_REASONS, "not_dispatcher", "off"]).nullable(),
  }),
  /** P3: whether the company's texts are on, whether the caller can be texted, and who backs them up (read-only, Q-BM10). */
  texts: z.object({
    on: z.boolean(),
    me: z.enum(BROKER_MAIL_TEXT_STATES),
    myBackups: z.array(z.string()),
  }),
});
export type BrokerMailList = z.infer<typeof brokerMailListSchema>;

export const brokerMailSettingsSchema = z.object({
  answerWithinMinutes: z.number().int().min(BROKER_MAIL_ANSWER_MIN).max(BROKER_MAIL_ANSWER_MAX),
  /** P3: texts on or off. Switching on stores the moment (texts_on_since), so the backlog is never texted. */
  textsOn: z.boolean(),
  backupAfterMinutes: z.number().int().min(BROKER_MAIL_BACKUP_MIN).max(BROKER_MAIL_BACKUP_MAX),
});
export type BrokerMailSettings = z.infer<typeof brokerMailSettingsSchema>;

/** One line of the admin's mailbox list (D-BMR14): a roster row and what Graph last said about it. */
export const brokerMailMailboxSchema = z.object({
  /** null: a McLeod login linked to nobody. */
  userId: id.nullable(),
  /** P3: can this dispatcher be texted, and who backs them up. */
  textState: z.enum(BROKER_MAIL_TEXT_STATES).nullable(),
  backups: z.array(z.object({ userId: id, name: z.string() })),
  name: z.string().nullable(),
  email: z.string().nullable(),
  mcleodLogins: z.array(z.string()),
  /** null: the gateway reads this mailbox. */
  reason: z.enum(BROKER_MAIL_ROSTER_REASONS).nullable(),
  /** What Graph last said, when the gateway has tried it; null = never tried. */
  state: z.enum(MAIL_GATEWAY_MAILBOX_STATES).nullable(),
  lastReadAt: instant.nullable(),
});
export type BrokerMailMailbox = z.infer<typeof brokerMailMailboxSchema>;

export const brokerMailAdminSchema = z.object({
  settings: brokerMailSettingsSchema,
  gateway: z.object({
    /** `GET /api/version`'s word (gatewayHealth.ts): off, ok, stale, stopped, unknown. */
    state: z.enum(["off", "ok", "stale", "stopped", "unknown"]),
    configured: z.boolean(),
    enabled: z.boolean(),
    bodyReading: z.boolean(),
    mailDomains: z.array(z.string()),
    lastCycleAt: instant.nullable(),
    canaryResult: z.enum(MAIL_GATEWAY_PROBE_RESULTS).nullable(),
    canaryCheckedAt: instant.nullable(),
    disabledReason: z.string().nullable(),
  }),
  mailboxes: z.array(brokerMailMailboxSchema),
  /** P3: the office members an admin may choose as a backup (anyone who can open the page once it is on). */
  members: z.array(z.object({ userId: id, name: z.string() })),
  /** Mailboxes that left the roster but still open — IT has not taken them out of the mail group. */
  stillConnected: z.array(z.object({ mailbox: z.string(), unlinkedAt: instant.nullable(), lastProbeAt: instant.nullable() })),
});
export type BrokerMailAdmin = z.infer<typeof brokerMailAdminSchema>;

export const brokerMailLeftOutSchema = z.object({ leftOut: z.boolean() });

/** `PUT /api/broker-mail/mailboxes/:userId/backups` — the whole list for one dispatcher (Q-BM10: admin only). */
export const brokerMailBackupsSchema = z.object({ backupUserIds: z.array(id).max(BROKER_MAIL_MAX_BACKUPS) });
export type BrokerMailBackups = z.infer<typeof brokerMailBackupsSchema>;
export type BrokerMailLeftOut = z.infer<typeof brokerMailLeftOutSchema>;

/** The words the page and the admin list print for a roster reason. One home, both screens. */
export const BROKER_MAIL_REASON_LABELS: Record<(typeof BROKER_MAIL_ROSTER_REASONS)[number] | "not_dispatcher" | "off", string> = {
  not_linked: "McLeod login not linked to a 360 user",
  not_member: "Not a member of this company",
  suspended: "Suspended in 360",
  no_email: "No sign-in email",
  other_domain: "Sign-in email is not a company address",
  left_out: "Left out on purpose",
  not_dispatcher: "No McLeod dispatcher login is linked to you",
  off: "Broker mail reading is switched off",
};

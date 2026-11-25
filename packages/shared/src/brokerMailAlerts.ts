/**
 * Broker mail's two alerts (BROKER-MAIL-READER-PLAN P3; analysis Q-BM7, Q-BM11, Q-BM12), spread into
 * `ALERT_CATALOGUE` (alertRouting.ts) — one catalogue, written in two files only because that one sits
 * at its line budget. Their texts are drained in the `mail` scheduler lane by the broker-mail module
 * (`ownDrain`), never by home time's drain.
 *
 *  · `broker_mail_waiting` — the dispatcher whose Outlook received the email: a full text and a bell at
 *    the company's answer-by time. MANDATORY (Q-BM11): sent at night too, and its own routes cannot be
 *    saved off. A STOP reply is still honoured at the door.
 *  · `broker_mail_backup` — the backups an admin chose for that dispatcher (Q-BM10): a short text a few
 *    minutes later, only if still unanswered and freshly checked (Q-BMR7). At night it is held to the
 *    start of working hours, and checked again before it leaves (Q-BM12).
 *
 * Both are about the Broker mail page, so only people who can open it receive them. The page starts
 * off for every role, so no dispatcher is texted before the admin turns the page on for them.
 * Literal routes, not alertRouting.ts's `on()`: that file imports this one.
 */
const R = (recipientKey: "mailbox_owner" | "dispatcher_backup", channel: "sms" | "bell") =>
  ({ recipientKind: "relation", recipientKey, channel, enabled: true }) as const;

export const BROKER_MAIL_ALERTS = [
  {
    key: "broker_mail_waiting",
    label: "Broker email unanswered",
    description: "A broker email in a dispatcher's own Outlook has no answer after the company's time. Day and night; it cannot be switched off.",
    action: "Open Dispatch > Broker mail in Silvicom 360.",
    section: "dispatch",
    surface: "dispatch.broker-mail",
    plural: "emails",
    relations: ["mailbox_owner"],
    defaults: [R("mailbox_owner", "sms"), R("mailbox_owner", "bell")],
    mandatory: true,
    ownDrain: true,
  },
  {
    key: "broker_mail_backup",
    label: "Broker email unanswered (backup)",
    description: "The same email is still unanswered a few minutes later: a short notice to that dispatcher's backups. Held until working hours at night.",
    action: "Open Dispatch > Broker mail in Silvicom 360.",
    section: "dispatch",
    surface: "dispatch.broker-mail",
    plural: "emails",
    relations: ["dispatcher_backup"],
    defaults: [R("dispatcher_backup", "sms")],
    ownDrain: true,
  },
] as const;

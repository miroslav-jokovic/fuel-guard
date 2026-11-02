import { z } from "zod";

/**
 * The messages an applicant is sent, and the parts of each a carrier may write (HIRING-WORKFLOW-AUDIT
 * §12, MT2; stored by 0551 `recruiting_message_wording`).
 *
 * ── THE CATALOGUE IS HERE, NOT IN SQL (D-MT5) ─────────────────────────────────────────────────
 * 0551 checks a key's SHAPE only. Which messages exist is this list — §10 D-CE3's rule: a CHECK naming
 * keys would be a second catalogue. A stored key this list does not have is ignored on read.
 *
 * ── FOUR PARTS, AND WHAT IS NEVER A PART (D-MT2) ──────────────────────────────────────────────
 * A carrier writes, each optionally: the email's subject, its heading, its paragraph, and the text's
 * lead sentence. The link, the button, the pasted-out link, the expiry sentence, "your earlier link no
 * longer works", the text's leading carrier name and its rates / HELP / STOP are not parts: they live in
 * the render functions (`applicantMessages.ts`), outside anything a carrier can write, because each is a
 * rule (CTIA §5.1.2.1, the rotation that kills the old link) or what makes the message work.
 *
 * ── THE STANDARD WORDS ARE THE CATALOGUE'S ────────────────────────────────────────────────────
 * `standardParts` is the product's wording of each part — the very strings the emails and texts said
 * before §12, moved here so that the sender, the Settings preview and the editor's "leave empty to use"
 * hint all read one definition (D-MT7). A null part in a saved wording means exactly this.
 */

export const MESSAGE_PLACEHOLDERS = ["first_name", "carrier", "days"] as const;
export type MessagePlaceholder = (typeof MESSAGE_PLACEHOLDERS)[number];

export const RECRUITING_MESSAGE_KEYS = ["invitation", "application_ready", "reminder", "videos", "travel"] as const;
export type RecruitingMessageKey = (typeof RECRUITING_MESSAGE_KEYS)[number];

export const isRecruitingMessageKey = (k: string): k is RecruitingMessageKey =>
  (RECRUITING_MESSAGE_KEYS as readonly string[]).includes(k);

/** One message's four parts, written out. In a saved wording each may be null: "the standard words". */
export interface MessageParts {
  emailSubject: string;
  /** The reminder has no heading as the product writes it; a carrier may give it one. */
  emailHeading: string | null;
  emailParagraph: string;
  textLead: string;
}

/** What a carrier saved for one message. Null part = `standardParts`' words for that part. */
export interface MessageWording {
  emailSubject: string | null;
  emailHeading: string | null;
  emailParagraph: string | null;
  textLead: string | null;
}

export const STANDARD_WORDING: MessageWording = Object.freeze({
  emailSubject: null, emailHeading: null, emailParagraph: null, textLead: null,
});

/** What a message is rendered with. `days` is null for a message without an expiry. */
export interface MessageVars {
  carrier: string;
  firstName: string | null;
  days: number | null;
}

export interface RecruitingMessage {
  key: RecruitingMessageKey;
  label: string;
  /** When it goes, in the office's words — shown under the label in Settings. */
  sentWhen: string;
  /** D-MT3: the placeholders this message's parts may use. */
  placeholders: readonly MessagePlaceholder[];
  standardParts: (v: MessageVars) => MessageParts;
}

export const RECRUITING_MESSAGES: readonly RecruitingMessage[] = [
  {
    key: "invitation",
    label: "The invitation",
    sentWhen: "The first link, when you invite an applicant.",
    placeholders: ["first_name", "carrier", "days"],
    standardParts: ({ carrier }) => ({
      emailSubject: `Your driver application for ${carrier}`,
      emailHeading: `${carrier} has sent you a driver application`,
      emailParagraph: "Open it whenever suits you. Your answers save as you go, so you can close the page and come back to it.",
      textLead: "Fill it in here:",
    }),
  },
  {
    key: "application_ready",
    label: "The application is ready",
    sentWhen: "When you press Send application, after the permissions are signed.",
    placeholders: ["first_name", "carrier", "days"],
    standardParts: ({ carrier }) => ({
      emailSubject: `${carrier}: your driver application is ready`,
      emailHeading: `Your application with ${carrier} is ready`,
      emailParagraph: `Thank you for signing the permissions. ${carrier} has sent you the application itself. `
        + "Your answers save as you go, so you can close the page and come back.",
      textLead: "Your driver application is ready. Fill it in here:",
    }),
  },
  {
    key: "reminder",
    label: "The reminder",
    sentWhen: "Once, to an applicant who stopped part of the way through.",
    placeholders: ["first_name", "carrier"],
    standardParts: ({ carrier }) => ({
      emailSubject: `Your ${carrier} application is saved`,
      emailHeading: null,
      emailParagraph: `You started an application for ${carrier} and it is still saved.`,
      textLead: "Your driver application is saved. Pick up where you left off:",
    }),
  },
  {
    key: "videos",
    label: "The orientation videos",
    sentWhen: "When you press Send the videos on an applicant's checklist.",
    placeholders: ["first_name", "carrier", "days"],
    standardParts: ({ carrier }) => ({
      emailSubject: `Your ${carrier} orientation videos`,
      emailHeading: `${carrier} has sent your orientation videos`,
      emailParagraph: "Please watch them before you come in. When you have, tick \"I watched these\" and type your "
        + "name — it shortens your day in the office.",
      textLead: "Please watch your orientation videos before you come in:",
    }),
  },
  {
    key: "travel",
    label: "The trip",
    sentWhen: "When you press Send the trip on an applicant's travel step.",
    placeholders: ["first_name", "carrier"],
    standardParts: ({ carrier }) => ({
      emailSubject: `Your trip to ${carrier}`,
      emailHeading: `Your trip to ${carrier} is booked`,
      emailParagraph: "Here are the details. If anything here is wrong, or your plans change, call the office.",
      textLead: "Your trip is booked.",
    }),
  },
];

export const recruitingMessage = (key: RecruitingMessageKey): RecruitingMessage => {
  const m = RECRUITING_MESSAGES.find((x) => x.key === key);
  if (!m) throw new Error(`unknown recruiting message ${key}`);
  return m;
};

// ── the limits (D-MT4) — 0551 checks the lengths and line breaks too ─────────────────────────────

export const MESSAGE_PART_LIMITS = {
  emailSubject: 120,
  emailHeading: 120,
  emailParagraph: 1000,
  textLead: 120,
} as const satisfies Record<keyof MessageWording, number>;

/** The parts that are one line: a subject is a mail header, a heading a heading, a lead one sentence. */
const ONE_LINE: ReadonlySet<keyof MessageWording> = new Set(["emailSubject", "emailHeading", "textLead"]);

/**
 * GSM 03.38's basic set and its extension (each extension character costs two). One character outside
 * both — a curly quote, an emoji, an accented capital — turns the whole text into UCS-2, 70 characters a
 * part instead of 160, which is why a text's lead is held to this set (D-MT4).
 */
const GSM_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€";

export const isGsm7 = (s: string): boolean => [...s].every((c) => GSM_BASIC.includes(c) || GSM_EXTENDED.includes(c));

/** How many parts a text is sent as: GSM-7 160 / 153, otherwise UCS-2 70 / 67. */
export function textMessageParts(s: string): number {
  if (isGsm7(s)) {
    const n = [...s].reduce((a, c) => a + (GSM_EXTENDED.includes(c) ? 2 : 1), 0);
    return n <= 160 ? 1 : Math.ceil(n / 153);
  }
  const n = [...s].length;
  return n <= 70 ? 1 : Math.ceil(n / 67);
}

const PLACEHOLDER_RE = /\{([^{}]*)\}/g;

/** Fill a carrier's part: `{first_name}` → the name, or "there"; `{carrier}`; `{days}` → "14 days". */
export function fillPlaceholders(text: string, v: MessageVars): string {
  return text.replace(PLACEHOLDER_RE, (whole, name: string) => {
    if (name === "first_name") return v.firstName?.trim() || "there";
    if (name === "carrier") return v.carrier;
    if (name === "days" && v.days !== null) return `${v.days} ${v.days === 1 ? "day" : "days"}`;
    return whole;
  });
}

/** One message's parts as they go out: the carrier's where it wrote one (filled), the standard elsewhere. */
export function resolveMessageParts(key: RecruitingMessageKey, v: MessageVars, w: MessageWording = STANDARD_WORDING): MessageParts {
  const std = recruitingMessage(key).standardParts(v);
  const fill = (s: string | null): string | null => (s === null ? null : fillPlaceholders(s, v));
  return {
    emailSubject: fill(w.emailSubject) ?? std.emailSubject,
    emailHeading: fill(w.emailHeading) ?? std.emailHeading,
    emailParagraph: fill(w.emailParagraph) ?? std.emailParagraph,
    textLead: fill(w.textLead) ?? std.textLead,
  };
}

/**
 * What is wrong with one part, in the office's words, or null. A part may use only its message's
 * placeholders (D-MT3) and no other braces; the one-line parts no line break; the lead GSM-7 only.
 */
export function messagePartIssue(key: RecruitingMessageKey, part: keyof MessageWording, value: string): string | null {
  const allowed = recruitingMessage(key).placeholders as readonly string[];
  for (const m of value.matchAll(PLACEHOLDER_RE)) {
    if (!allowed.includes(m[1] ?? "")) {
      return `{${m[1]}} is not a placeholder this message has. Use ${allowed.map((p) => `{${p}}`).join(", ")}.`;
    }
  }
  if (/[{}]/.test(value.replace(PLACEHOLDER_RE, ""))) return "A { or } may only be part of a placeholder such as {first_name}.";
  if (ONE_LINE.has(part) && /[\r\n]/.test(value)) return "Keep this to one line.";
  if (part === "textLead" && !isGsm7(value)) {
    return "Texts take plain characters only — no curly quotes, emoji or special symbols — or each part holds 70 characters instead of 160.";
  }
  return null;
}

const part = (limit: number) =>
  z.string().trim().max(limit).transform((s) => (s === "" ? null : s)).nullable().transform((s) => s ?? null);

/** `PUT /api/recruitment/messages/:key`. An empty part is null: "the standard words" (D-MT2). */
export const messageWordingSaveSchema = z.object({
  emailSubject: part(MESSAGE_PART_LIMITS.emailSubject),
  emailHeading: part(MESSAGE_PART_LIMITS.emailHeading),
  emailParagraph: part(MESSAGE_PART_LIMITS.emailParagraph),
  textLead: part(MESSAGE_PART_LIMITS.textLead),
});
export type MessageWordingSave = z.infer<typeof messageWordingSaveSchema>;

/** Every issue in a save, by part — the route answers 400 with them, the editor shows them under each field. */
export function messageWordingIssues(key: RecruitingMessageKey, w: MessageWording): Partial<Record<keyof MessageWording, string>> {
  const out: Partial<Record<keyof MessageWording, string>> = {};
  for (const p of Object.keys(MESSAGE_PART_LIMITS) as Array<keyof MessageWording>) {
    const v = w[p];
    if (v === null) continue;
    const issue = messagePartIssue(key, p, v);
    if (issue) out[p] = issue;
  }
  return out;
}

/** `GET /api/recruitment/messages`: every catalogue message, with what the carrier saved last. */
export interface SavedMessageWording {
  key: RecruitingMessageKey;
  wording: MessageWording;
  /** Null when the carrier never saved one (the standard words). */
  savedAt: string | null;
  savedByName: string | null;
}

/** `GET /api/recruitment/messages`'s whole answer: the list, and the carrier's name as the senders write it. */
export interface MessageWordingView {
  messages: SavedMessageWording[];
  carrier: string;
}

import { z } from "zod";
import { escapeEmailHtml as esc, type RenderedEmail } from "./email.js";
import type { SmsHoldReason } from "./smsQuietHours.js";

/**
 * A one-time code that opens a saved application when the date of birth will not
 * (APPLICATION-FIX-PLAN.md F0b; migration 0585).
 *
 * ── WHY ───────────────────────────────────────────────────────────────────────────────────────
 * The saved application opens to the person who types the date of birth on file (D-APP16). When the
 * date ON FILE is wrong, the driver's own right answer never matches, and the only way out was a call.
 * A code sent to the invitation's own email, or to the number they agreed to be texted on, proves the
 * same thing the link's delivery did — the person holding the link holds that inbox or that phone —
 * and it is asked for by the driver, so a forwarded or gateway-scanned link (the reason D-APP16 exists)
 * still gets nothing without the inbox behind it.
 *
 * ⚠ **The code opens the application; it does not fix the date.** The office is told, on the review
 * drawer, that the date of birth on file did not match, and corrects it through Identity — the owner's
 * Q-AM13 ruling that the office has control of every mistake before signing.
 */

export const UNLOCK_CODE_LENGTH = 6;
/** Long enough to switch to the mail app and back on a truck-stop signal; short enough to be useless later. */
export const UNLOCK_CODE_TTL_MINUTES = 10;
/** Wrong codes one code takes before it is retired; 0585's CHECK holds the same five. */
export const UNLOCK_CODE_MAX_TRIES = 5;

export const UNLOCK_CODE_CHANNELS = ["email", "sms"] as const;
export type UnlockCodeChannel = (typeof UNLOCK_CODE_CHANNELS)[number];

export const UNLOCK_CODE_LANGUAGES = ["en", "es"] as const;
export type UnlockCodeLanguage = (typeof UNLOCK_CODE_LANGUAGES)[number];

/** `POST /api/public/application/:token/unlock-code` — send me a code. The address is the server's, never the page's. */
export const unlockCodeRequestSchema = z
  .object({
    channel: z.enum(UNLOCK_CODE_CHANNELS),
    language: z.enum(UNLOCK_CODE_LANGUAGES).default("en"),
  })
  .strict();
export type UnlockCodeRequest = z.infer<typeof unlockCodeRequestSchema>;

/** `POST /api/public/application/:token/unlock-code/verify` — the six digits, spaces and dashes forgiven. */
export const unlockCodeVerifySchema = z
  .object({
    code: z
      .string()
      .transform((v) => v.replace(/[\s-]/g, ""))
      .pipe(z.string().regex(/^\d{6}$/, "Enter the six digits from the message")),
  })
  .strict();
export type UnlockCodeVerify = z.infer<typeof unlockCodeVerifySchema>;

/**
 * Why a code did not go. Each is something the page can say in the driver's words, and none names an
 * address the driver did not already give. A text's reasons are the SMS sender's own (`SmsHoldReason`),
 * never restated here; the email adds its two.
 */
export type UnlockCodeHeld = SmsHoldReason | "no_address" | "mail_disabled";

export type UnlockCodeAnswer =
  | { outcome: "sent"; channel: UnlockCodeChannel; to: string; expiresInMinutes: number }
  | { outcome: "held"; channel: UnlockCodeChannel; held: UnlockCodeHeld };

/**
 * An address shown back masked — enough for the driver to know which inbox to open, too little to
 * teach a stranger holding the link anything: `m•••@gmail.com`, `•••-•••-0142`.
 */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.trim().split("@");
  if (!local || !domain) return "•••";
  return `${local.slice(0, 1)}•••@${domain}`;
}
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? `•••-•••-${digits.slice(-4)}` : "•••";
}

const COPY: Record<UnlockCodeLanguage, {
  subject: (carrier: string) => string;
  heading: string;
  body: (carrier: string) => string;
  life: string;
  unasked: string;
  sms: (carrier: string, code: string) => string;
}> = {
  en: {
    subject: (carrier) => `Your code for your ${carrier} application`,
    heading: "Your code",
    body: (carrier) => `Type this code on your ${carrier} application to pick up where you left off.`,
    life: `It works for ${UNLOCK_CODE_TTL_MINUTES} minutes. A newer code replaces this one.`,
    unasked: "If you did not ask for a code, ignore this message. Nobody can open your application without it.",
    sms: (carrier, code) =>
      `${code} is your code for your ${carrier} application. It works for ${UNLOCK_CODE_TTL_MINUTES} minutes. Reply STOP to opt out.`,
  },
  es: {
    subject: (carrier) => `Su código para su solicitud con ${carrier}`,
    heading: "Su código",
    body: (carrier) => `Escriba este código en su solicitud con ${carrier} para continuar donde la dejó.`,
    life: `Sirve por ${UNLOCK_CODE_TTL_MINUTES} minutos. Un código más nuevo reemplaza a este.`,
    unasked: "Si usted no pidió un código, ignore este mensaje. Nadie puede abrir su solicitud sin él.",
    sms: (carrier, code) =>
      `${code} es su código para su solicitud con ${carrier}. Sirve por ${UNLOCK_CODE_TTL_MINUTES} minutos. Responda STOP para no recibir más.`,
  },
};

/** The email. Pure, so the words are tested here and the API's mailer only carries them. */
export function renderUnlockCodeEmail(carrier: string, code: string, language: UnlockCodeLanguage): RenderedEmail {
  const c = COPY[language];
  const html =
    `<div style="font-family:system-ui,sans-serif;color:#111">`
    + `<h2 style="margin:0 0 8px">${esc(c.heading)}</h2>`
    + `<p style="color:#555">${esc(c.body(carrier))}</p>`
    + `<p style="margin:20px 0;font-size:28px;font-weight:700;letter-spacing:6px">${esc(code)}</p>`
    + `<p style="color:#888;font-size:12px">${esc(c.life)}</p>`
    + `<p style="color:#888;font-size:12px">${esc(c.unasked)}</p>`
    + `</div>`;
  const text = `${c.heading}: ${code}\n\n${c.body(carrier)}\n\n${c.life}\n\n${c.unasked}`;
  return { subject: c.subject(carrier), html, text };
}

/** The text. One message, the code first, so a phone's "copy code" suggestion finds it. */
export const renderUnlockCodeText = (carrier: string, code: string, language: UnlockCodeLanguage): string =>
  COPY[language].sms(carrier, code);

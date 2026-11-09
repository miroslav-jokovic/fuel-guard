import { checkClaims } from "./adClaims.js";
import type { AdClaim } from "./contracts.js";
import type { MetaFormLocale } from "./metaLeadForm.js";

/**
 * What an Instant Form shows around its questions, and how hard it is to send (ADS-LEAD-QUALITY-PLAN LQ1;
 * Q-AD47 ruled (a) 2026-11-09: always on, in code). Pure: the frozen brief and a language in, Meta's
 * `leadgen_forms` create parameters out, or a refusal.
 *
 * ── WHY EACH PARAMETER (Page leadgen_forms reference + Business SDK v26.0, read 2026-11-09) ──────
 *   · `is_optimized_for_quality: true` — Meta's "higher intent" form: "adds a step to the form submission
 *     flow where a person reviews and confirms their answers" (Lead Ads › Create). Every lead is called by
 *     a person, the case for which every practitioner source we read picks higher intent.
 *   · `is_phone_sms_verify_enabled: true` — "Whether the form requires phone sms verification when user
 *     submits". The form always carries Meta's PHONE question (`META_CONTACT_TYPES`). ⚠ The LeadgenForm
 *     object's READ fields do not include it (SDK `leadgenform.py`), so the publisher cannot verify it by
 *     reading the form back; how it is proven is Q-AD48 (the publisher contract suite records what the
 *     target answers when asked for it).
 *   · `context_card` — the intro: what the job needs, before anyone types. Every line is DERIVED from the
 *     brief (the catalogue's question keys and the brief's own claims), never written by a model, and
 *     passes `checkClaims` like any copy: a figure the brief does not hold cannot appear. No pay line —
 *     the ad states pay in the Copywriter's words, and there is no deterministic money wording in shared
 *     to restate it with (adding one is its own change).
 *   · `thank_you_page` — fixed words: a recruiter will call. No promised time: office hours are recorded
 *     nowhere, and "within 5 minutes" at 23:00 would be false. Button `NONE`: a call button needs
 *     `business_phone_number` + `country_code`, whose formats Meta does not document (Q-AD53).
 *
 * ── LIMITS ───────────────────────────────────────────────────────────────────────────────────────
 * Meta's help (Intro section): headline ≤ 60 characters, a list bullet ≤ 80. The thank-you headline's
 * limit is undocumented; a third-party guide says 60, and we hold ourselves to it (stricter is safe; the
 * L4 sandbox run reports Meta's answer). A line over its limit refuses the form — never trimmed, since a
 * cut sentence is a different sentence.
 */

export const META_INTRO_TITLE_MAX = 60;
export const META_INTRO_BULLET_MAX = 80;
export const META_THANK_YOU_TITLE_MAX = 60;

type Words = Record<MetaFormLocale, string>;

/** The intro's title and the thank-you screen: the four sentences the owner approves in the LQ1 PR. */
export const META_FORM_WORDS = {
  intro_title: { en: "What this job needs", es: "Lo que pide este trabajo" },
  thank_you_title: { en: "Thanks — a recruiter will call you", es: "Gracias — un reclutador le llamará" },
  thank_you_body: { en: "Please keep your phone nearby.", es: "Por favor, tenga su teléfono a la mano." },
} as const satisfies Record<string, Words>;

/** A requirement line per catalogue question that states one by itself (no number). */
const PLAIN_LINES: Readonly<Record<string, Words>> = {
  class_a_held: { en: "A valid Class A CDL", es: "Licencia CDL Clase A vigente" },
  hazmat_endorsement: { en: "Hazmat (H) endorsement", es: "Endoso de materiales peligrosos (H)" },
};

/** What the screens read from a brief (readonly: the publisher's input is). */
export interface FormScreensBrief { form_questions: readonly string[]; claims: readonly AdClaim[] }

const quantity = (claims: readonly AdClaim[], unit: "age" | "year"): number | null => {
  const c = claims.find((x): x is Extract<AdClaim, { kind: "quantity" }> => x.kind === "quantity" && x.unit === unit);
  return c ? c.value : null;
};

/** The intro's lines, in the form's question order, then age. Empty = no intro. */
export function introLines(brief: FormScreensBrief, locale: MetaFormLocale): string[] {
  const out: string[] = [];
  for (const key of brief.form_questions) {
    const plain = PLAIN_LINES[key];
    if (plain) out.push(plain[locale]);
    if (key === "class_a_years") {
      // The question is asked whenever the profile has a floor; the line needs the floor's number, which
      // only the brief's claim holds. No claim = no line (never a number we would have to invent).
      const years = quantity(brief.claims, "year");
      if (years !== null) out.push(locale === "en" ? `At least ${years} years of Class A driving` : `${years} años o más manejando con Clase A`);
    }
  }
  const age = quantity(brief.claims, "age");
  if (age !== null) out.push(locale === "en" ? `${age} or older` : `${age} años o más`);
  return out;
}

export interface MetaFormScreens {
  is_optimized_for_quality: true;
  is_phone_sms_verify_enabled: true;
  context_card?: { title: string; style: "LIST_STYLE"; content: string[] };
  thank_you_page: { title: string; body: string; button_type: "NONE" };
}

export type MetaFormScreensBuild = { ok: true; screens: MetaFormScreens } | { ok: false; refused: string[] };

export function metaFormScreens(brief: FormScreensBrief, locale: MetaFormLocale): MetaFormScreensBuild {
  const lines = introLines(brief, locale);
  const title = META_FORM_WORDS.intro_title[locale];
  const thanks = META_FORM_WORDS.thank_you_title[locale];
  const refused: string[] = [];
  if (title.length > META_INTRO_TITLE_MAX) refused.push("intro_title_too_long");
  if (lines.some((l) => l.length > META_INTRO_BULLET_MAX)) refused.push("intro_line_too_long");
  if (thanks.length > META_THANK_YOU_TITLE_MAX) refused.push("thank_you_title_too_long");
  // The same rule the overlay and the copy pass: every figure on the intro is one the brief holds.
  if (lines.some((l) => !checkClaims(l, { claims: [...brief.claims] }).ok)) refused.push("intro_claim_not_in_brief");
  if (refused.length) return { ok: false, refused };
  return {
    ok: true,
    screens: {
      is_optimized_for_quality: true,
      is_phone_sms_verify_enabled: true,
      ...(lines.length ? { context_card: { title, style: "LIST_STYLE" as const, content: lines } } : {}),
      thank_you_page: { title: thanks, body: META_FORM_WORDS.thank_you_body[locale], button_type: "NONE" },
    },
  };
}

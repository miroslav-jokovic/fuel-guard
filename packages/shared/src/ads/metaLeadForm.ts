/**
 * What a Meta Instant Form may ask a driver (ADS-AGENT-PLAN.md §4.2 `metaLeadForm.ts`; §1 "Meta
 * employment rules"; G12 / Q-AD8). Pure: the brief's `form_questions` keys in, Meta's question objects
 * out, or a refusal naming every key that may not be asked.
 *
 * ── WHAT IS ALLOWED, AND WHY ONLY THIS ───────────────────────────────────────────────────────────
 * Meta's employment rules: a form "may not ask age, gender, marital status, address, city or ZIP", and
 * no form may ask "criminal or arrest history, driver's licence numbers and health information"; at most
 * 15 questions. Counsel has not answered Q-AD8, so the catalogue below is the plan's FALLBACK, exactly:
 * Class A held (yes/no), years of Class A, hazmat endorsement (yes/no). A key outside the catalogue is
 * refused — never passed through as free text — because the catalogue IS the list counsel is asked to
 * approve. Widening it is an edit here, after counsel, that review sees.
 *
 * Contact comes from Meta's prefilled types (FULL_NAME, PHONE, EMAIL), never asked in our words.
 * `META_FORBIDDEN_QUESTION_TYPES` lists the prefilled types that would ask a prohibited fact; nothing
 * this file builds can carry one, and the test holds that over every output.
 *
 * Age is NOT a question: the ad says "must be 23 or older" in words (plan §1), and `leadMatch` returns
 * `unknown` on age for every Meta lead by design.
 */

export const META_FORM_MAX_QUESTIONS = 15;

/** Prefilled types that ask what an employment form may not (Page leadgen_forms reference, read 2026-11-02). */
export const META_FORBIDDEN_QUESTION_TYPES = [
  "DOB", "GENDER", "MARITIAL_STATUS", "RELATIONSHIP_STATUS", "CITY", "STATE", "ZIP", "POST_CODE", "STREET_ADDRESS",
  "ADDRESS_LINE_TWO", "PROVINCE", "COUNTRY", "MILITARY_STATUS",
  "ID_CPF", "ID_AR_DNI", "ID_CL_RUT", "ID_CO_CC", "ID_EC_CI", "ID_PE_DNI", "ID_MX_RFC",
] as const;

export const META_CONTACT_TYPES = ["FULL_NAME", "PHONE", "EMAIL"] as const;

export type MetaFormLocale = "en" | "es";
export const META_FORM_LOCALES: Record<MetaFormLocale, string> = { en: "EN_US", es: "ES_LA" };

export interface MetaFormQuestion {
  type: string;
  key: string;
  label?: string;
  options?: Array<{ key: string; value: string }>;
}

type Labels = Record<MetaFormLocale, string>;
interface CatalogueEntry {
  label: Labels;
  options: Array<{ key: string; value: Labels }>;
}

const YES_NO = [{ key: "yes", value: { en: "Yes", es: "Sí" } }, { key: "no", value: { en: "No", es: "No" } }];

/** The G12 fallback set — the only questions a form may add to contact (Q-AD8 open). */
export const META_FORM_CATALOGUE: Readonly<Record<string, CatalogueEntry>> = {
  class_a_held: {
    label: { en: "Do you hold a valid Class A CDL?", es: "¿Tiene una licencia CDL Clase A vigente?" },
    options: YES_NO,
  },
  class_a_years: {
    label: { en: "How many years of Class A driving experience do you have?", es: "¿Cuántos años de experiencia manejando con Clase A tiene?" },
    options: [
      { key: "lt1", value: { en: "Less than 1 year", es: "Menos de 1 año" } },
      { key: "1to2", value: { en: "1 to 2 years", es: "De 1 a 2 años" } },
      { key: "2to5", value: { en: "2 to 5 years", es: "De 2 a 5 años" } },
      { key: "5plus", value: { en: "More than 5 years", es: "Más de 5 años" } },
    ],
  },
  hazmat_endorsement: {
    label: { en: "Do you have a hazmat (H) endorsement?", es: "¿Tiene el endoso de materiales peligrosos (H)?" },
    options: YES_NO,
  },
};

export type MetaFormBuild =
  | { ok: true; locale: string; questions: MetaFormQuestion[] }
  | { ok: false; refused: string[] };

export function metaLeadFormQuestions(keys: readonly string[], locale: MetaFormLocale): MetaFormBuild {
  const refused = [...new Set(keys.filter((k) => !Object.hasOwn(META_FORM_CATALOGUE, k)))];
  if (new Set(keys).size !== keys.length) refused.push("duplicate_question");
  if (keys.length + META_CONTACT_TYPES.length > META_FORM_MAX_QUESTIONS) refused.push("too_many_questions");
  if (refused.length) return { ok: false, refused };
  const contact: MetaFormQuestion[] = META_CONTACT_TYPES.map((type) => ({ type, key: type.toLowerCase() }));
  const custom: MetaFormQuestion[] = keys.map((key) => {
    const q = META_FORM_CATALOGUE[key]!;
    return { type: "CUSTOM", key, label: q.label[locale], options: q.options.map((o) => ({ key: o.key, value: o.value[locale] })) };
  });
  return { ok: true, locale: META_FORM_LOCALES[locale], questions: [...contact, ...custom] };
}

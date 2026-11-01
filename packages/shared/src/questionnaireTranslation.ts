import {
  APPLYING_AS_QUESTION_ID,
  SILVICOM_DRIVER_V2,
  SILVICOM_DRIVER_V3,
  type QuestionnaireDefinition,
  type QuestionnaireQuestion,
} from "./questionnaireContract.js";

/**
 * The carrier's own questions in a second language (APPLICATION-FLOW-V2-PLAN Q-AW11 ruled EN+ES; C4).
 *
 * ── WHAT A TRANSLATION IS, AND IS NOT ─────────────────────────────────────────────────────────
 * A definition is versioned and its answers are filed against it (`QUESTIONNAIRES`, D-APP12), so a
 * translation is NEVER a second definition: same `id`, same `version`, same question ids, same
 * kinds, same `choices` values. It is an overlay of words keyed by question id, applied on the way
 * to the screen and nowhere else — the filed application and the office's review print the carrier's
 * English, which is what the paper says.
 *
 * ⚠ A `select`'s free `options` are NOT translated. Every select but `applying_as` stores the
 * option's own words as the answer (`QuestionChoice`'s header), so a translated option would file a
 * Spanish answer against an English form. `applying_as` stores a key, so its `choices` labels are.
 */

export interface QuestionTranslation {
  label: string;
  hint?: string;
  /** For a `select` with `choices`: label by stored value. */
  choices?: Record<string, string>;
  /** For a `table`: label by column id. */
  columns?: Record<string, string>;
  /** The `skip` choice's label (§9 P8). Its stored value stays the carrier's English words. */
  skip?: string;
}

export interface QuestionnaireTranslation {
  title: string;
  intro: string;
  questions: Record<string, QuestionTranslation>;
}

/** Silvicom's questions in Spanish. Drafted 2026-10-21 for the owner's review. */
export const SILVICOM_DRIVER_ES: QuestionnaireTranslation = {
  title: "Unas preguntas de la empresa",
  intro:
    "Estas son las preguntas propias de Silvicom. No forman parte de la solicitud federal que acaba de "
    + "llenar, y sus respuestas aquí se guardan junto con ella.",
  questions: {
    position: { label: "Puesto que solicita" },
    heard_from: { label: "¿Cómo se enteró de esta empresa?" },
    legally_work: { label: "¿Puede trabajar legalmente en los EE. UU.?" },
    proof_of_age: {
      label: "¿Tiene comprobante de edad?",
      hint: "La edad mínima federal es 21 años. La política propia de Silvicom es 23.",
    },
    may_contact_employers: {
      label: "¿Podemos comunicarnos con sus empleadores anteriores?",
      hint: "Estamos obligados a verificar su historial de desempeño en seguridad de todos modos; esto nos dice cómo preferiría usted que lo hiciéramos.",
    },
    education: {
      label: "Educación y capacitación",
      hint: "La más reciente primero.",
      columns: {
        school: "Escuela o universidad",
        years_completed: "Años completados",
        field_of_study: "Área de estudio",
        graduated: "Se graduó",
        graduated_when: "Cuándo",
      },
    },
    military_service: { label: "¿Ha servido alguna vez en las fuerzas armadas?" },
    military_when: { label: "Si es así, ¿cuándo?" },
    other_training: { label: "Cualquier otra capacitación que le ayudaría en este puesto" },
    references: {
      label: "Tres referencias personales",
      hint: "Que no sean familiares ni antiguos supervisores.",
      columns: {
        full_name: "Nombre completo",
        years_known: "Años de conocerse",
        phone: "Número de teléfono",
      },
    },
    [APPLYING_AS_QUESTION_ID]: {
      label: "¿Solicita como conductor de la empresa o como operador propietario?",
      hint: "Elija operador propietario si manejará un camión que es suyo o que arrienda, bajo contrato con Silvicom.",
      choices: {
        company_driver: "Conductor de la empresa",
        owner_operator: "Operador propietario",
      },
    },
  },
};

/**
 * v3's words (§9 P8): v2's, with the new intro, the plainer proof-of-age hint, and the skip labels.
 * Drafted 2026-11-01 for the owner's review, like v2's.
 */
const SKIP_ES = { rather: "Prefiero no decirlo", na: "No corresponde" };
export const SILVICOM_DRIVER_V3_ES: QuestionnaireTranslation = {
  ...SILVICOM_DRIVER_ES,
  intro: "Unas preguntas más sobre usted. Nos ayudan a asignarle el camión adecuado.",
  questions: {
    ...SILVICOM_DRIVER_ES.questions,
    proof_of_age: {
      label: SILVICOM_DRIVER_ES.questions.proof_of_age!.label,
      hint: "Silvicom contrata conductores de 23 años o más. Una licencia de conducir, un pasaporte o un acta de nacimiento muestran su edad.",
    },
    military_service: { ...SILVICOM_DRIVER_ES.questions.military_service!, skip: SKIP_ES.rather },
    military_when: { ...SILVICOM_DRIVER_ES.questions.military_when!, skip: SKIP_ES.rather },
    other_training: { ...SILVICOM_DRIVER_ES.questions.other_training!, skip: SKIP_ES.na },
    references: { ...SILVICOM_DRIVER_ES.questions.references!, skip: SKIP_ES.rather },
  },
};

/** By `id@version`, like `QUESTIONNAIRES`; a definition with no entry for a language is shown in English. */
export const QUESTIONNAIRE_TRANSLATIONS: Record<string, Record<string, QuestionnaireTranslation>> = {
  [`${SILVICOM_DRIVER_V2.id}@${SILVICOM_DRIVER_V2.version}`]: { es: SILVICOM_DRIVER_ES },
  [`${SILVICOM_DRIVER_V3.id}@${SILVICOM_DRIVER_V3.version}`]: { es: SILVICOM_DRIVER_V3_ES },
};

function translateQuestion(question: QuestionnaireQuestion, words: QuestionTranslation | undefined): QuestionnaireQuestion {
  if (!words) return question;
  return {
    ...question,
    label: words.label,
    ...(question.hint !== undefined ? { hint: words.hint ?? question.hint } : {}),
    ...(question.choices
      ? { choices: question.choices.map((c) => ({ ...c, label: words.choices?.[c.value] ?? c.label })) }
      : {}),
    ...(question.columns
      ? { columns: question.columns.map((col) => ({ ...col, label: words.columns?.[col.id] ?? col.label })) }
      : {}),
    ...(question.skip ? { skip: { ...question.skip, label: words.skip ?? question.skip.label } } : {}),
  };
}

/**
 * The definition with its words in `language`, or the definition itself for English or a language
 * it has no words in. Nothing but words changes: ids, kinds, values and limits are the definition's.
 */
export function translateQuestionnaire(definition: QuestionnaireDefinition, language: string): QuestionnaireDefinition {
  if (language === "en") return definition;
  const words = QUESTIONNAIRE_TRANSLATIONS[`${definition.id}@${definition.version}`]?.[language];
  if (!words) return definition;
  return {
    ...definition,
    title: words.title,
    intro: words.intro,
    questions: definition.questions.map((q) => translateQuestion(q, words.questions[q.id])),
  };
}

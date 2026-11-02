import type { Localized } from "../language";
import type { APPLY_QUESTIONS_COPY } from "../strings.questions";

/**
 * `strings.questions.ts` in Spanish (§9 P8, C4). Drafted 2026-11-01 for the owner's review, like the
 * rest of the Spanish page.
 */
export const APPLY_QUESTIONS_COPY_ES = {
  carrierQuestions: {
    yes: "Sí",
    no: "No",
    answerNeeded: "Responda esta pregunta.",
    answerOrSkip: (skip: string): string => `Respóndala, o elija "${skip}".`,
  },
  missing: {
    heading: (n: number): string => (n === 1 ? "Falta 1 respuesta" : `Faltan ${n} respuestas`),
    canStillSend: "Son opcionales. Puede enviar sin ellas.",
    mustAnswer: "Responda las marcadas como obligatorias antes de enviar.",
    required: "Obligatoria",
    optional: "Opcional",
  },
} satisfies Localized<typeof APPLY_QUESTIONS_COPY>;

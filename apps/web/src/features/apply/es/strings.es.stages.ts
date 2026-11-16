import { CMV_WINDOW_YEARS, EMPLOYMENT_WINDOW_YEARS, MVR_LOOKBACK_YEARS } from "@silvicom/shared";
import type { Localized } from "../language";
import { sentenceCase } from "../sentenceCase";
import type { APPLY_STAGES_COPY } from "../strings.stages";

/** `strings.stages.ts` in Spanish — a draft for the owner's review; the page is English only for now. */
export const APPLY_STAGES_COPY_ES = {
  stages: {
    label: "Su solicitud, en tres etapas",
    names: { today: "Hoy", history: "Su historial", signing: "Firma" },
    state: { done: "terminada", current: "usted está aquí", ahead: "después" },
  },
  expectations: {
    heading: "En qué consiste",
    lead: (carrier: string): string => `Esta es la solicitud de conductor de ${carrier}.`,
    howLong: "Se hace en tres etapas. Le enviamos un enlace nuevo para cada una, y el enlace anterior deja de funcionar. No tiene que terminar de una sola vez.",
    minutes: (minutes: number): string => `unos ${Math.max(5, Math.round(minutes / 5) * 5)} minutos`,
    stage: {
      today: {
        what: "Su licencia, unas preguntas y las autorizaciones para revisar su historial.",
        when: "Ahora, con su CDL en la mano.",
      },
      history: {
        what: "Dónde ha vivido y trabajado, y su historial de manejo.",
        when: (carrier: string): string => `Después de que ${carrier} revise su historial. Le enviamos un enlace nuevo por correo electrónico cuando esté lista, y puede hacerla cualquier día de esa semana.`,
      },
      signing: {
        what: "Usted lee la solicitud terminada y la firma.",
        when: (carrier: string): string => `Después de que ${carrier} la lea. Cuando usted venga, ${carrier} le envía el enlace para firmar a su teléfono.`,
      },
    },
    needHeading: "Qué tener a la mano",
    needs: [
      `Todas las direcciones en las que ha vivido en los últimos ${EMPLOYMENT_WINDOW_YEARS} años.`,
      `Todos los trabajos que ha tenido en los últimos ${EMPLOYMENT_WINDOW_YEARS} años, y todos los trabajos de manejo de los últimos ${CMV_WINDOW_YEARS}, con fechas.`,
      `Su licencia, y cualquier otra licencia o permiso que tenga o haya tenido en los últimos ${MVR_LOOKBACK_YEARS} años.`,
    ],
    photographHeading: "Y esto, para fotografiar si lo tiene:",
    signFirst: (carrier: string): string =>
      `${sentenceCase(carrier)} le pide primero los datos de su licencia y unas cuantas autorizaciones firmadas.`,
    savesItself: "Sus respuestas se guardan a medida que avanza, así que puede parar a la mitad y volver a abrir su enlace más tarde.",
    start: "Empezar",
  },
} satisfies Localized<typeof APPLY_STAGES_COPY>;

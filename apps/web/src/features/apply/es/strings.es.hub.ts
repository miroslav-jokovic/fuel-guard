import type { Localized } from "../language";
import type { APPLY_HUB_COPY } from "../strings.hub";

/**
 * `strings.hub.ts` in Spanish (Q-AW11, C4). The three rights and the how-to lines keep every limit
 * the regulation sets (30 days, 5 business days, 30 days to collect). Drafted 2026-10-21 for the
 * owner's review; whether a translation of the §391.23(i) notice needs counsel is memo Q-AW11's.
 */
export const APPLY_HUB_COPY_ES = {
  hub: {
    heading: "Su solicitud",
    intro: "Haga estas tareas en cualquier orden. Sus respuestas se guardan a medida que avanza, y puede volver a cualquiera.",
    status: {
      not_started: "Sin empezar",
      in_progress: "En curso",
      completed: "Completada",
      cannot_start: "Todavía no se puede empezar",
    },
    optional: "Opcional",
    answered: (done: number, total: number): string => `${done} de ${total} respondidas`,
    finishFirst: "Termine primero las tareas de arriba.",
    beforeYouSend: "Antes de enviar",
    backToList: "Volver a su solicitud",
    saveAndContinue: "Guardar y continuar",
    open: (task: string): string => `Abrir ${task}`,
  },
  employerCheck: {
    heading: "Antes de enviar: la verificación de sus empleadores anteriores",
    use: "La información que dé sobre los empleadores que tuvo en los últimos 3 años puede usarse, y se contactará a sus empleadores anteriores, para investigar su historial de desempeño en seguridad.",
    rightsIntro: "Si manejó para un empleador regulado por el DOT en los últimos 3 años, usted tiene estos derechos sobre la información que nos envíen:",
    rights: [
      "El derecho a revisar la información proporcionada por sus empleadores anteriores.",
      "El derecho a que el empleador anterior corrija los errores en la información y nos vuelva a enviar la información corregida.",
      "El derecho a que se adjunte una declaración de refutación a la información supuestamente errónea, si usted y el empleador anterior no logran ponerse de acuerdo sobre su exactitud.",
    ],
    howTo: [
      "Para verla, pídanosla por escrito, en cualquier momento, incluso ahora, o hasta 30 días después de que lo contraten o le digan que no.",
      "Se la daremos dentro de los 5 días hábiles siguientes a su solicitud, o dentro de los 5 días hábiles siguientes a recibirla si todavía no ha llegado.",
      "Si no la recoge dentro de los 30 días siguientes a que esté disponible, podemos considerar que retiró su solicitud.",
    ],
  },
} satisfies Localized<typeof APPLY_HUB_COPY>;

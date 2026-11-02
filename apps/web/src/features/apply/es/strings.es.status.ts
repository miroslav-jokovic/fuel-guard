import type { Localized } from "../language";
import { sentenceCase } from "../sentenceCase";
import type { APPLY_STATUS_COPY } from "../strings.status";

/** `strings.status.ts` in Spanish (§13 SP1). Same keys, checked by `satisfies`; the reasons are in the English file. */
export const APPLY_STATUS_COPY_ES = {
  status: {
    heading: "En qué va su solicitud",
    stages: {
      permissions: "Autorizaciones firmadas",
      application: "Solicitud llenada y enviada",
      review: (carrier: string): string => `${sentenceCase(carrier)} la revisa`,
      visit: "Visita a la oficina: prueba de manejo, orientación y firma",
    },
    stateWords: { done: "Listo", current: "Ahora", later: "Después" },
    owesHeading: "Lo que le toca hacer",
    owes: {
      drug_test: (carrier: string): string =>
        `Vaya a su prueba de drogas. ${sentenceCase(carrier)} le envió por mensaje de texto dónde y cuándo. Si no lo recibió, llámeles.`,
      videos: "Vea sus videos de orientación antes de ir a la oficina.",
      trip: (carrier: string): string =>
        `Su viaje a ${carrier} está reservado. Le enviamos los detalles por correo electrónico o mensaje de texto. Si no los recibió, llámeles.`,
    },
    videosLink: "Abrir los videos",
  },
} satisfies Localized<typeof APPLY_STATUS_COPY>;

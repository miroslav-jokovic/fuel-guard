import type { Localized } from "../language";
import { sentenceCase } from "../sentenceCase";
import type { APPLY_VIDEOS_COPY } from "../strings.videos";

/** `strings.videos.ts` in Spanish (Q-AW11, C4). The videos themselves are the carrier's. Drafted 2026-11-01. */
export const APPLY_VIDEOS_COPY_ES = {
  videos: {
    heading: "Videos de orientación",
    intro: (carrier: string): string =>
      `${sentenceCase(carrier)} le pide que vea estos videos antes de venir. Así su día en la oficina es más corto. Abra cada uno, véalo y después regrese a esta página.`,
    required: "Obligatorio",
    optional: "Opcional",
    minutes: (n: number): string => `${n} min`,
    open: "Ver",
    ticked: "Usted dijo que vio este video",
    none: (carrier: string): string =>
      `${sentenceCase(carrier)} todavía no ha agregado videos. Puede cerrar esta página.`,
    attestHeading: "Cuando los haya visto",
    attestLabel: "Vi estos videos",
    nameLabel: "Su nombre completo",
    submit: "Enviar",
    submitting: "Enviando…",
    done: (when: string): string => `Gracias. Usted dijo que vio estos videos el ${when}.`,
    allDone: "Ya vio todos los videos. No hay nada más que hacer aquí.",
    failed: "No se completó. Inténtelo de nuevo.",
    changed: "La lista de videos cambió. La página se actualizó; por favor revísela de nuevo.",
    backToApplication: "Abrir mi solicitud",
  },
} satisfies Localized<typeof APPLY_VIDEOS_COPY>;

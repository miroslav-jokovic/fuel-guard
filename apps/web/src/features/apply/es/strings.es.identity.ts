import type { Localized } from "../language";
import { sentenceCase } from "../sentenceCase";
import type { APPLY_IDENTITY_COPY } from "../strings.identity";

/** `strings.identity.ts` in Spanish (Q-AW11, C4). Drafted 2026-10-21 for the owner's review. */
export const APPLY_IDENTITY_COPY_ES = {
  identityStep: {
    heading: "Su licencia de conducir",
    intro: (carrier: string): string =>
      `${sentenceCase(carrier)} revisa su historial de manejo y de seguridad con estos datos antes de enviarle la solicitud. Escríbalos como aparecen en su licencia.`,
    dateOfBirth: "Fecha de nacimiento",
    number: "Número de licencia",
    state: "Estado que la emitió",
    stateHint: "Empiece a escribir para encontrarlo.",
    photosHeading: "Fotos de su licencia",
    photosIntro: "Los dos lados, si puede. Si su cámara no abre, continúe; la oficina puede pedírselas después.",
    action: "Continuar",
    working: "Guardando…",
    failed: "Eso no se guardó. Revise su señal e inténtelo de nuevo.",
    missing: {
      date_of_birth: "Escriba su fecha de nacimiento.",
      cdl_number: "Escriba el número de su licencia.",
      cdl_state: "Elija el estado que emitió su licencia.",
    },
    kept: (carrier: string): string =>
      `${sentenceCase(carrier)} ya tenía algunos de estos datos en su expediente, así que se conservaron. Si algo está mal, avise a ${carrier}.`,
    lockedHint: (carrier: string): string => `Para cambiar esto, comuníquese con ${carrier}.`,
  },
} satisfies Localized<typeof APPLY_IDENTITY_COPY>;

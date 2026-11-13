import type { Localized } from "../language";
import type { APPLY_SCREENS_COPY } from "../strings.screens";

/**
 * `strings.screens.ts` in Spanish (U7's gate, F4 PR 1). Drafted 2026-11-12 for the owner's review, like
 * the rest of the Spanish page.
 */
export const APPLY_SCREENS_COPY_ES = {
  placeholders: { optional: "Opcional", choose: "Seleccione…" },
  disclosure: {
    heading: "Lo que se le pedirá autorizar",
    draftIntro:
      "Estas son las revisiones que una compañía hace antes de contratar a un conductor. La redacción final todavía se está preparando, así que hoy no se firma nada de esto: se le pedirá firmar cada una por separado, y cada una es su propio documento. Léalas ahora para que nada le tome por sorpresa más adelante.",
    finalIntro: "Cada una se firma por separado, por sí sola, después de enviar esta solicitud.",
    notFinal: "No es definitiva",
  },
  signingWalk: {
    viewer: "La solicitud de la compañía",
    done: (signed: number, of: number, scope: string): string => `${signed} de ${of} ${scope} listos`,
    page: (n: number): string => `Página ${n}`,
    progress: (n: number): string => `Avance por ${n} lugares`,
    places: (n: number): string => `Los ${n} lugares donde se le pide firmar`,
    place: (index: number, page: number | null, what: string, state: string): string =>
      `Lugar ${index}${page ? `, página ${page}` : ""}. ${what} — ${state}`,
    signed: "firmado",
    signingNow: "el lugar que está firmando ahora",
    toCome: "todavía por firmar",
    elsewhere: (page: number, at: number): string =>
      `Está leyendo la página ${page}. El lugar que está firmando está en la página ${at}.`,
    takeMeBack: "Volver a donde firmo",
    documentPage: (label: string, n: number, of: number): string => `${label}, página ${n} de ${of}`,
    labelOnPage: (label: string, page: number): string => `${label}, página ${page}`,
  },
} satisfies Localized<typeof APPLY_SCREENS_COPY>;

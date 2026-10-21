import type { Localized } from "../language";
import { sentenceCase } from "../sentenceCase";
import type { APPLY_HANDBOOK_COPY } from "../strings.handbook";

/** `strings.handbook.ts` in Spanish (Q-AW11, C4). The handbook itself stays the carrier's English. Drafted 2026-10-21. */
export const APPLY_HANDBOOK_COPY_ES = {
  handbook: {
    heading: "El manual del conductor",
    filedThen:
      "Su solicitud está firmada y archivada. Los últimos lugares por firmar están en el manual del conductor, abajo.",
    intro:
      "Cada lugar se abre en su página. Léala, y después presione Firmar aquí sobre la línea. Firma con la firma que hizo cuando empezó su solicitud.",
    applying: "Su firma va en la línea marcada Firmar aquí.",
    documentLabel: "El manual del conductor",
    unavailable: "El manual no cargó en este momento. Puede firmar de todos modos; pida a la empresa una copia en papel para leerlo.",
    place: (n: number, total: number): string => `Lugar ${n} de ${total}`,
    sign: "Firmar aquí",
    signing: "Firmando…",
    signFailed: "Esa firma no se completó. Inténtelo de nuevo.",
    allSigned: (carrier: string): string =>
      `Firmó todos los lugares. ${sentenceCase(carrier)} lo firma ahora por su parte, y una copia se archiva con su solicitud.`,
    filed: "Su manual del conductor está firmado y archivado.",
    download: "Descargar su manual firmado",
    downloadFailed: "No se abrió en este momento. Inténtelo de nuevo en un momento, o pida a la empresa una copia en papel.",
  },
} satisfies Localized<typeof APPLY_HANDBOOK_COPY>;

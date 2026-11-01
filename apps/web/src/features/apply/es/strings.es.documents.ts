import type { Localized } from "../language";
import type { APPLY_DOCUMENTS_COPY } from "../strings.documents";

/** `strings.documents.ts` in Spanish (Q-AW11, C4; the list's new words drafted 2026-11-01, §9 P9). */
export const APPLY_DOCUMENTS_COPY_ES = {
  documents: {
    intro: "Envíe lo que tenga ahora; puede llevar el resto a la oficina.",
    optional: "Cada uno puede ser una foto o un PDF. Ninguno le impide enviar la solicitud.",
    fromLicenceStep: "Recibido con su licencia",
    upload: "Subir un archivo",
    uploadAgain: "Elegir otro archivo",
    addAnother: "Agregar otro",
    numbered: (label: string, n: number): string => `${label} ${n}`,
    pdfDone: "PDF recibido",
    tooLarge: "Ese archivo pesa más de 8 MB. Envíe una copia más pequeña, o llévelo a la oficina.",
    take: "Tomar foto",
    retake: "Tomarla de nuevo",
    working: "Un momento…",
    done: "Recibido",
    failedHeading: "Esa foto no se envió",
    failed: "Revise su señal y tómela de nuevo. No se perdió nada.",
    notIntact: "Esa foto no llegó completa. Tómela de nuevo.",
    rejected: {
      DOCUMENT_NOT_DETECTED: "No hay un documento en la imagen. Póngalo plano y llene el encuadre.",
      IMAGE_BLURRED: "Demasiado borrosa para leerla. No se mueva e inténtelo de nuevo.",
      GLARE_OVER_TEXT: "Hay un reflejo sobre el texto. Aléjese de la luz.",
      SHADOW_OVER_TEXT: "Una sombra tapa el texto. Muévase para que su mano no quede encima.",
      RESOLUTION_TOO_LOW: "Demasiado pequeña para leerla. Tómela más de cerca para que el documento llene el encuadre, o elija una imagen más grande.",
      LENS_DIRTY: "El lente parece manchado. Límpielo e inténtelo de nuevo.",
      PAGE_INCOMPLETE: "Parte del documento quedó fuera del encuadre. Incluya las cuatro esquinas.",
      LOW_CONTRAST: "Demasiado desvaída para leerla. Pruebe en un lugar con más luz.",
      UNDER_OR_OVER_EXPOSED: "Demasiado oscura o demasiado brillante. Pruebe en un lugar con luz pareja.",
      TEXT_ILLEGIBLE: "El texto no se puede leer. Acérquese e inténtelo de nuevo.",
      OCR_UNAVAILABLE: "No se pudo revisar la foto en este teléfono. Inténtelo de nuevo.",
      SCANNER_MODULE_UNAVAILABLE: "No se pudo abrir la cámara. Inténtelo de nuevo.",
      UNSUPPORTED_DEVICE: "Este teléfono no puede tomar la foto aquí. Puede enviársela a la empresa después.",
      CAPTURE_CANCELLED: "No se tomó ninguna foto.",
      PROVIDER_ERROR: "No pudimos abrir esa imagen. Tome una foto nueva, o elija otro archivo.",
    },
  },
} satisfies Localized<typeof APPLY_DOCUMENTS_COPY>;

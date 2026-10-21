import type { Localized } from "../language";
import { sentenceCase } from "../sentenceCase";
import type { APPLY_PERMISSIONS_COPY } from "../strings.permissions";
import { APPLY_FLOW_COPY_ES } from "./strings.es.flow";

/** `strings.permissions.ts` in Spanish (Q-AW11, C4). Drafted 2026-10-21 for the owner's review. */
const packet = APPLY_FLOW_COPY_ES.packet;

export const APPLY_PERMISSIONS_COPY_ES = {
  permissions: {
    adoption: {
      ...packet,
      adoptHeading: "Su firma",
      adoptHeadingWithInitials: "Su firma y sus iniciales",
      adoptIntro: (carrier: string, count: number): string =>
        `${sentenceCase(carrier)} necesita que firme ${count} autorizaciones antes de poder revisar su historial. Cada una es un documento aparte. Haga su firma y sus iniciales una sola vez abajo; después le mostramos cada documento y dónde firmarlo.`,
      initialsHint:
        "Algunas páginas de su solicitud piden sus iniciales en lugar de su nombre completo. Las guardamos para esas.",
      adoptHint: "Escríbalo como aparece en su licencia. Este es el nombre con el que se firma cada documento.",
      stylePreviewLabel: "Así se verá su firma",
      uploadPreviewLabel: "Así se verá su firma",
      drawHint: "Use el dedo. Su nombre escrito también queda registrado con ella.",
      confirmHeading: "Revise su firma antes de empezar",
      confirmBody:
        "Su firma va en cada documento exactamente como se ve aquí. Una vez firmado un documento no se "
        + "puede cambiar, así que tómese un momento ahora.",
      confirmInitialsWhere: (_pages: number[]): string =>
        "Se guardan para las páginas de su solicitud que piden iniciales.",
      initialsCarriedOver: "La imagen de sus iniciales está guardada para las páginas de su solicitud que piden iniciales.",
      initialsFailed:
        "No pudimos guardar la imagen de sus iniciales, así que se usarán sus iniciales escritas. Continúe.",
      confirmAction: "Está bien — empezar a firmar",
      changeIntro: "Cambie su firma. Lo que ya firmó queda como está.",
      markLocked: (_kind: "signature" | "initials", places: number): string =>
        `Su firma ${places === 1 ? "ya está en 1 documento" : `ya está en ${places} documentos`}, así que ya no se puede cambiar.`,
      resumed: (n: number): string =>
        n === 1 ? "Ya firmó 1 documento." : `Ya firmó ${n} documentos.`,
      resumedBody: "La hizo cuando empezó. La seguiremos usando en los documentos que faltan.",
      markCarriedOver: "La imagen de su firma está guardada. La seguiremos usando en los documentos que faltan.",
      drawFailed:
        "No pudimos guardar la imagen de su firma, así que se usa su nombre escrito. "
        + "Todo lo que firme cuenta igual; continúe.",
    },
    counter: (n: number, total: number): string => `Documento ${n} de ${total}`,
    signHere: "Firme aquí",
    working: "Firmando…",
    signedHere: "Firmado",
    next: "Siguiente documento",
    loading: "Obteniendo el documento…",
    unavailable: "El documento no se pudo mostrar aquí, así que su texto está abajo. Léalo y firme.",
    signAction: "Acepto — firmar esto",
    readAsText: "Leer este documento como texto",
    notFinal:
      "Esta empresa todavía no ha publicado el texto definitivo de este documento, así que hoy no se puede firmar. Ya se les avisó.",
    failed: "Eso no se completó. Revise su señal e inténtelo de nuevo.",
  },
} satisfies Localized<typeof APPLY_PERMISSIONS_COPY>;

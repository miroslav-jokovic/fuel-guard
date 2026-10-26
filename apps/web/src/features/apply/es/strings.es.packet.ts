import type { Localized } from "../language";
import { sentenceCase } from "../sentenceCase";
import type { APPLY_PACKET_COPY } from "../strings.packet";

/**
 * `strings.packet.ts` in Spanish (Q-AW11, C4). Same keys, checked by `satisfies` against the English
 * shape; the WHY of every sentence is in the English file and is not repeated here. Drafted
 * 2026-10-21 for the owner's review; "usted" throughout; the carrier's name is the argument it is in
 * English.
 */
export const APPLY_PACKET_COPY_ES = {
  packet: {
    adoptHeading: "Su firma en la solicitud",
    adoptHeadingWithInitials: "Su firma y sus iniciales en la solicitud",
    adoptIntro: (carrier: string, count: number, handbook: number): string =>
      `${sentenceCase(carrier)} aprobó su solicitud. Ahora necesita su firma en ${count} lugares de su propio formulario, `
      + `y después en ${handbook} lugares de su manual del conductor. Haga su firma una sola vez abajo; luego lo llevamos a cada `
      + "lugar, uno por uno, y le mostramos lo que está firmando.",
    styleLabel: "¿Cómo quiere firmar?",
    styleStyled: "Elegir un estilo",
    styleDrawn: "Dibujarla",
    styleUploaded: "Subir una imagen",
    styleChooseLabel: "Elija la letra que más se parezca a la suya",
    styleSampleName: "Juan Pérez",
    stylePreviewLabel: "Esto es lo que va en el formulario",
    styleInitialsPreviewLabel: "Y esto va en las páginas que piden sus iniciales",
    uploadLabel: "Suba una imagen de su firma",
    uploadHint:
      "Una foto o un escaneo. Firme en una hoja blanca con tinta oscura, tómele una foto, y nosotros recortamos el papel.",
    uploadInitialsLabel: "Suba una imagen de sus iniciales",
    uploadInitialsHint:
      "Lo mismo otra vez, con solo sus iniciales en la hoja. Van en las páginas que piden iniciales.",
    uploadInitialsNeeded: "Elija arriba una imagen de sus iniciales, o elija un estilo.",
    uploadChoose: "Elegir una imagen",
    uploadReplace: "Elegir otra imagen",
    uploadReading: "Leyendo…",
    uploadPreviewLabel: "Esto es lo que va en el formulario",
    uploadNeeded: "Elija una imagen arriba, o elija un estilo.",
    uploadFailed: {
      too_large: "Esa imagen es demasiado grande para leerla en un teléfono. Pruebe con una más pequeña, o dibuje su firma.",
      unreadable: "No pudimos leer esa imagen. Pruebe con una foto o un escaneo en PNG o JPEG.",
      blank: "No encontramos una firma en esa imagen. Firme en una hoja blanca con tinta oscura y fotografíela con buena luz.",
    },
    adoptLabel: "Escriba su nombre completo",
    adoptHint: "Escríbalo como aparece en su licencia. Esto es lo que va en el formulario.",
    initialsLabel: "Escriba sus iniciales",
    initialsHint: "Tres páginas piden sus iniciales en lugar de su nombre completo. Estas van en esas tres.",
    initialsNeeded: "Escriba sus iniciales arriba para continuar.",
    drawLabel: "Dibuje su firma",
    drawHint: "Use el dedo. Esto es lo que va en el formulario; su nombre escrito también queda en él.",
    drawClear: "Borrar",
    drawNeeded: "Dibuje su firma arriba, o elija un estilo.",
    drawInitialsLabel: "Ahora dibuje sus iniciales",
    drawInitialsHint: "Solo sus iniciales. Van en las páginas que las piden en lugar de una firma.",
    drawInitialsNeeded: "Dibuje sus iniciales arriba, o elija un estilo.",
    adoptAction: "Usar esta y empezar",
    resumedHeading: "La firma con la que está firmando",
    resumedBody: "La adoptó cuando empezó. La seguiremos usando en los lugares que faltan.",
    resumedInitialsLabel: "Sus iniciales",
    resumedAction: "Seguir firmando",
    adoptedHeading: "Esta es su firma",
    adoptedBody:
      "La hizo cuando empezó su solicitud. Úsela aquí, o haga una nueva; la nueva se usará de aquí en adelante.",
    adoptedAction: "Usarla",
    remakeAction: "Hacer una nueva",
    markCarriedOver: "La imagen de su firma está guardada. La seguiremos poniendo en las páginas que faltan.",
    initialsCarriedOver:
      "La imagen de sus iniciales está guardada. La seguiremos poniendo en las páginas que piden iniciales.",
    confirmHeading: "Revise sus marcas antes de empezar",
    confirmBody:
      "Van en el formulario exactamente como se ven aquí. Una vez que una marca está en el formulario no se puede "
      + "cambiar, así que tómese un momento ahora.",
    confirmSignatureLabel: "Su firma",
    confirmInitialsLabel: "Sus iniciales",
    confirmInitialsWhere: (pages: number[]): string =>
      pages.length === 1
        ? `Estas van en la página ${pages[0]}.`
        : `Estas van en las páginas ${pages.slice(0, -1).join(", ")} y ${pages[pages.length - 1]}.`,
    confirmChange: "Cambiar",
    confirmAction: "Están bien — empezar a firmar",
    changeIntro:
      "Cambie una marca que todavía no está en el formulario. Lo que ya firmó queda como está.",
    changeMark: "Cambiar",
    markLocked: (kind: "signature" | "initials", places: number): string =>
      `${kind === "signature" ? "Su firma" : "Sus iniciales"} ${places === 1 ? "ya está en 1 lugar" : `ya está en ${places} lugares`} `
      + "del formulario, así que ya no se puede cambiar.",
    counter: (n: number, total: number): string => `Lugar ${n} de ${total}`,
    page: (n: number): string => `Página ${n} de la solicitud`,
    signAction: "Firmar aquí",
    initialAction: "Iniciales aquí",
    working: "Guardando…",
    applyingTyped: "Pondremos esto en la página:",
    applyingDrawn: "Pondremos su firma en la página:",
    applyingInitials: "Pondremos sus iniciales en la página:",
    drawFailed:
      "No pudimos guardar la imagen de su firma, así que en el formulario va su nombre escrito. "
      + "Todo lo que firme cuenta igual; continúe.",
    initialsFailed:
      "No pudimos guardar la imagen de sus iniciales, así que en esas páginas van sus iniciales escritas. "
      + "Todo lo que firme cuenta igual; continúe.",
    resumed: (n: number): string =>
      n === 1 ? "Ya firmó 1 lugar." : `Ya firmó ${n} lugares.`,
    doneHeading: "Ese es el último lugar de la solicitud",
    doneBody:
      "Su firma ya está en todos los lugares que pide el formulario. Envíe su solicitud abajo, y después firme los "
      + "lugares del manual del conductor.",
    failed: "Eso no se completó. Revise su señal e inténtelo de nuevo.",
    tooFast:
      "Eso fue más rápido de lo que pudimos registrarlo. Espere alrededor de un minuto y vuelva a presionar el botón; "
      + "nada de lo que ya firmó se pierde.",
  },
} satisfies Localized<typeof APPLY_PACKET_COPY>;

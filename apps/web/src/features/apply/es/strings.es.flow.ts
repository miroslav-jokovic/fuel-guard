import type { Localized } from "../language";
import { sentenceCase } from "../sentenceCase";
import type { APPLY_FLOW_COPY } from "../strings.flow";
import { APPLY_PACKET_COPY_ES } from "./strings.es.packet";

/**
 * `strings.flow.ts` in Spanish (Q-AW11, C4). Same keys, checked by `satisfies`; the reasons are in
 * the English file. Drafted 2026-10-21 for the owner's review.
 */
export const APPLY_FLOW_COPY_ES = {
  permissionsReceived: {
    heading: "Tenemos sus autorizaciones",
    body: (carrier: string): string =>
      `Gracias. ${sentenceCase(carrier)} revisará su historial de manejo y de seguridad, y después le enviará la solicitud.`,
    note: "Por ahora no hay nada más que hacer. Le enviaremos por correo electrónico un enlace nuevo para la solicitud; este dejará de funcionar cuando llegue.",
  },

  handoff: {
    send: (carrier: string): string => `Enviar a ${carrier}`,
    sending: "Enviando…",
    failed: "No se envió. Revise su señal e inténtelo de nuevo; nada de lo que escribió se pierde.",
    waitingHeading: "Tienen su solicitud",
    waitingBody: (carrier: string): string =>
      `${sentenceCase(carrier)} la está leyendo. Cuando terminen, se comunicarán con usted para que vaya a su oficina, donde la firmará.`,
    waitingNote:
      "Por el momento no hay nada más que hacer. Le avisaremos por correo electrónico cuando terminen; este enlace "
      + "le mostrará en qué va todo.",
  },

  signInOffice: {
    heading: "Su solicitud fue aprobada",
    body: (carrier: string): string =>
      `${sentenceCase(carrier)} leyó su solicitud. La firmará en su oficina, en la misma visita que su prueba de manejo y la orientación; se comunicarán con usted para que vaya, y le enviarán un enlace a su teléfono cuando esté allí.`,
    note: "Por ahora no hay nada más que hacer en este enlace. Nada de lo que llenó se ha perdido.",
  },

  signOff: {
    heading: "Lista para su firma",
    intro: (carrier: string): string =>
      `${sentenceCase(carrier)} leyó su solicitud. Revísela una vez más y fírmela; esta es la versión que va a su expediente.`,
    changedHeading: "Lo que cambió la empresa",
    changedIntro:
      "Corrigieron esto al revisar su solicitud. Léalo antes de firmar; si algo está mal, dígaselo antes de firmar.",
    changedNothing: "No cambiaron ninguna de sus respuestas.",
    was: "Usted puso",
    now: "Ahora dice",
    blank: "nada",
    ssnNote:
      "Su número de Seguro Social no se guarda con el resto de sus respuestas, por eso se lo pedimos aquí: va directamente a su expediente cuando firma.",
    sign: "Firmar y enviar",
    signing: "Enviando…",
  },

  done: {
    heading: "Su solicitud fue entregada",
    body: (carrier: string): string =>
      `${sentenceCase(carrier)} la tiene, certificada a su nombre. Se comunicarán con usted sobre lo que sigue.`,
    reopen:
      "Puede cerrar esta página. Su enlace seguirá abriendo este mensaje, y no se puede usar para enviar una segunda solicitud.",
    download: "Descargar su copia",
    downloading: "Preparando su copia…",
    downloadNote:
      "Todo lo que llenó, todo lo que firmó, y un registro de cuándo y cómo lo firmó.",
    downloadFailed:
      "No se abrió en este momento. Inténtelo de nuevo en un momento, o pida a la empresa que le envíe una copia.",
    certificate: "Descargar su certificado de la prueba de manejo",
    certificateDownloading: "Preparando su certificado…",
    certificateNote: (testedOn: string): string =>
      `De su prueba de manejo del ${testedOn}. Guárdelo: es su copia del certificado de la empresa.`,
    certificateFailed:
      "No se abrió en este momento. Inténtelo de nuevo en un momento, o pida a la empresa una copia en papel.",
  },

  dead: {
    heading: "Este enlace no es válido",
    body: "Puede haber vencido, o la empresa puede haberlo reemplazado. Pida uno nuevo a la empresa que lo invitó.",
    finished: {
      heading: "Este enlace venció",
      body:
        "Usted completó todo lo que este enlace le pedía, y la empresa lo tiene: sus datos, sus documentos y sus autorizaciones. "
        + "Aquí no le quedaba nada más por hacer. La empresa se comunicará con usted sobre el siguiente paso; "
        + "si no ha sabido nada de ellos, pregunte a la persona que lo invitó.",
    },
    replaced: {
      heading: "Abra el enlace más reciente de la empresa",
      body:
        "Este enlace dejó de funcionar porque la empresa le envió uno más nuevo, como hace cuando su solicitud pasa a la siguiente parte. "
        + "Abra el mensaje de texto o correo más reciente de la empresa y continúe allí; no se pierde nada de lo que ya envió. "
        + "Si no encuentra un mensaje más nuevo, pregunte a la persona que lo invitó.",
    },
  },

  notOpen: {
    banner: (carrier: string): string =>
      `${sentenceCase(carrier)} todavía está terminando el texto de los documentos que acompañan esta solicitud, así que aún no se puede enviar. Llene lo que pueda; todo lo que escriba se guarda, y este enlace seguirá aquí.`,
    cannotSend:
      "Todavía no puede firmar esto, y la solicitud no se puede enviar hasta que la empresa publique el texto definitivo. Pregunte a la persona que lo invitó cuándo será.",
    sendLabel: "Todavía no se puede enviar",
  },

  consent: {
    heading: "Antes de empezar",
    intro: (carrier: string): string =>
      `${sentenceCase(carrier)} quiere enviarle esta solicitud, y tomar su firma en ella, de forma electrónica. La ley dice que usted tiene que aceptar eso primero, y que antes de hacerlo se le debe informar lo siguiente.`,
    action: "Acepto — continuar",
    working: "Un momento…",
    draftNotice:
      "Esta empresa todavía no ha publicado su texto definitivo, así que hoy no hay nada que aceptar. Puede seguir directamente con su solicitud.",
    failed: "Eso no se completó. Revise su señal e inténtelo de nuevo.",
  },

  ...APPLY_PACKET_COPY_ES,

  unlock: {
    heading: "Continúe donde se quedó",
    body: (carrier: string): string =>
      `Usted ya empezó esta solicitud para ${carrier}. Confirme su fecha de nacimiento y sus respuestas vuelven.`,
    label: "Su fecha de nacimiento",
    failed: "Eso no coincide con esta solicitud. Inténtelo de nuevo, o pida a la empresa un enlace nuevo y empiece de cero.",
    attemptsLeft: (n: number): string =>
      `Eso no coincide con esta solicitud. ${n === 1 ? "Una respuesta equivocada más" : `${n} respuestas equivocadas más`} y este enlace dejará de funcionar.`,
    lockedOut: (carrier: string): string =>
      `Esa fecha de nacimiento no coincidió demasiadas veces, así que este enlace dejó de funcionar. Nada de lo que hizo se pierde; pida a ${carrier} que le envíe de nuevo el enlace para firmar.`,
    checking: "Comprobando…",
    action: "Continuar",
  },
} satisfies Localized<typeof APPLY_FLOW_COPY>;

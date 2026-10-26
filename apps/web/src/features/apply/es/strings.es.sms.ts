import type { Localized } from "../language";
import { sentenceCase } from "../sentenceCase";
import type { APPLY_SMS_COPY } from "../strings.sms";

/**
 * `strings.sms.ts` in Spanish (Q-AW11, C4). The consent itself is the served document and stays
 * English (counsel's words); these are the frame around it. Drafted 2026-10-21 for the owner's review.
 */
export const APPLY_SMS_COPY_ES = {
  sms: {
    heading: "Reciba un mensaje de texto cuando sea su turno",
    optional: "Opcional",
    intro: (carrier: string): string =>
      `${sentenceCase(carrier)} puede enviarle un mensaje de texto cuando su solicitud esté lista para llenar, y sobre su solicitud después de eso. El correo electrónico llega de todos modos.`,
    phoneLabel: "Número de celular",
    phoneHint: "Un número de celular de EE. UU. que pueda recibir mensajes de texto.",
    phoneInvalid: "Escriba un número de celular de EE. UU. de 10 dígitos.",
    consentLabel: "Lo que está aceptando",
    terms: "Términos de los mensajes de texto",
    privacy: "Política de privacidad",
    action: "Activar los mensajes de texto",
    working: "Guardando…",
    failed: "Eso no se guardó. Revise su señal e inténtelo de nuevo.",
    numberStopped: "Este número nos envió STOP. Responda START a cualquier mensaje que le hayamos enviado, y luego vuelva a activar los mensajes aquí.",
    tooManyNumbers: (max: number): string =>
      `Los mensajes de texto se pueden activar para ${max} números distintos en una solicitud. Avise a la oficina si su número cambió.`,
    onHeading: "Los mensajes de texto están activados",
    onBody: (last4: string): string => `Le enviaremos mensajes sobre su solicitud al número que termina en ${last4}.`,
    confirmationSent: "Acabamos de enviarle un mensaje de confirmación.",
    confirmationHeld: "Su mensaje de confirmación llegará durante el día; no enviamos mensajes de noche.",
    stopHint: "Puede responder STOP a cualquier mensaje, o desactivarlos aquí.",
    stop: "Desactivar los mensajes de texto",
    stopping: "Desactivando…",
    offHeading: "Los mensajes de texto están desactivados",
    offBody: "No le enviaremos mensajes de texto. Puede volver a activarlos abajo si cambia de opinión.",
  },
} satisfies Localized<typeof APPLY_SMS_COPY>;

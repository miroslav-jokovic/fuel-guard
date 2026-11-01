import {
  CMV_WINDOW_YEARS,
  EMPLOYMENT_WINDOW_YEARS,
  MVR_LOOKBACK_YEARS,
  type ApplicationCaptureSlot,
  type ApplicationSection,
} from "@silvicom/shared";
import type { ApplyCopy } from "../strings";
import { sentenceCase } from "../sentenceCase";
import { APPLY_FLOW_COPY_ES } from "./strings.es.flow";
import { APPLY_HANDBOOK_COPY_ES } from "./strings.es.handbook";
import { APPLY_DOCUMENTS_COPY_ES } from "./strings.es.documents";
import { APPLY_HISTORY_COPY_ES } from "./strings.es.history";
import { APPLY_HUB_COPY_ES } from "./strings.es.hub";
import { APPLY_IDENTITY_COPY_ES } from "./strings.es.identity";
import { APPLY_PART_ONE_COPY_ES } from "./strings.es.partOne";
import { APPLY_PERMISSIONS_COPY_ES } from "./strings.es.permissions";
import { APPLY_SMS_COPY_ES } from "./strings.es.sms";

/**
 * Every word the applicant reads, in Spanish (APPLICATION-FLOW-V2-PLAN Q-AW11 ruled EN+ES; AW13, C4).
 *
 * ── THE SAME OBJECT, THE SAME KEYS ────────────────────────────────────────────────────────────
 * `strings.ts`'s header promised that a second language would be "a second object", and this is it:
 * one file per English file, the same keys in the same order, each checked by `satisfies` against the
 * English shape so a key missing or invented here fails `vue-tsc`. `strings.test.ts` walks this object
 * as it walks the English one — no citation, every phrase function callable — and
 * `language.test.ts` pins the parity at runtime too. The WHY of every sentence lives beside the
 * English and is not repeated here.
 *
 * ── THE VOICE ─────────────────────────────────────────────────────────────────────────────────
 * "Usted" throughout; the fact, then the next action; a sensitive question says why in the same
 * breath, as the English does. US trucking Spanish: "CDL" stays "CDL", "DOT" stays "DOT",
 * "Clearinghouse" stays "Clearinghouse", the medical card is "la tarjeta médica". Drafted
 * 2026-10-21 for the owner's review; nothing here is a legal instrument (those stay English, see
 * `language.ts`).
 */

/** `APPLICATION_SECTION_LABELS` in Spanish — the section vocabulary is a database value; only its words change. */
export const APPLICATION_SECTION_LABELS_ES: Record<ApplicationSection, string> = {
  identity: "Sobre usted",
  addresses: "Dónde ha vivido",
  licence: "Su licencia",
  employment: "Dónde ha trabajado",
  safety: "Su historial de manejo",
  questions: "Las preguntas de la empresa",
  documents: "Sus documentos",
  review: "Revise sus respuestas",
  certify: "Fírmela",
};

/** `APPLICATION_CAPTURE_SLOT_LABELS` in Spanish — what each photograph is called where the page names one. */
export const APPLICATION_CAPTURE_SLOT_LABELS_ES: Record<ApplicationCaptureSlot, string> = {
  cdl_front: "Frente de su licencia",
  cdl_back: "Reverso de su licencia",
  medical_card: "Certificado del examinador médico",
  ssn_card: "Tarjeta de Seguro Social",
  signature_mark: "Su firma",
  initials_mark: "Sus iniciales",
  selfie: "Una foto de usted",
  other: "Cualquier otra cosa",
  twic: "Tarjeta TWIC",
  passport: "Pasaporte",
  work_authorization: "Tarjeta de residencia o permiso de trabajo",
  hazmat_endorsement: "Endoso de materiales peligrosos",
  road_test_certificate: "Certificado de prueba de manejo de un trabajo anterior",
  training_certificate: "Certificado de capacitación",
};

export const APPLY_COPY_ES = {
  page: {
    title: "Solicitud de conductor",
    subtitle: (carrier: string): string => `Para ${carrier}.`,
    opening: "Abriendo su solicitud…",
    stepOf: (n: number, total: number): string => `Paso ${n} de ${total}`,
    employingCarrier: (carrier: string, address: string): string => `Empresa empleadora: ${carrier}, ${address}`,
  },

  progress: {
    here: "Usted está aquí",
    savesItself: "Sus respuestas se guardan a medida que avanza",
    comeBack: "Puede cerrar esta página y volver a abrir su enlace más tarde.",
    minutes: (n: number): string => `${n} min`,
  },

  expectations: {
    heading: "En qué consiste",
    lead: (carrier: string): string => `Esta es la solicitud de conductor de ${carrier}.`,
    howLong: (screens: number, minutes: number): string =>
      `${screens} pantallas, unos ${Math.round(minutes / 5) * 5} minutos en total.`,
    stepsHeading: "Las pantallas",
    needHeading: "Qué tener a la mano",
    needs: [
      `Todas las direcciones en las que ha vivido en los últimos ${EMPLOYMENT_WINDOW_YEARS} años.`,
      `Todos los trabajos que ha tenido en los últimos ${EMPLOYMENT_WINDOW_YEARS} años, y todos los trabajos de manejo de los últimos ${CMV_WINDOW_YEARS}, con fechas, direcciones y números de teléfono.`,
      `Su licencia, y cualquier otra licencia o permiso que tenga o haya tenido en los últimos ${MVR_LOOKBACK_YEARS} años.`,
    ],
    photographHeading: "Y esto, para fotografiar:",
    signFirst: (carrier: string): string =>
      `${sentenceCase(carrier)} le pide primero los datos de su licencia y unas cuantas autorizaciones firmadas. Después de revisar su historial, le envía la solicitud en sí; le enviaremos el enlace por correo electrónico.`,
    afterwards: (carrier: string): string =>
      `Cuando la envíe, ${carrier} la lee. La firmará en su oficina, cuando vaya a su prueba de manejo.`,
    savesItself: "Sus respuestas se guardan a medida que avanza, así que puede parar a la mitad y volver a abrir su enlace más tarde.",
    start: "Empezar",
  },

  nav: {
    back: "Atrás",
    next: "Siguiente",
    review: "Revisar mis respuestas",
    fix: "Ir a esta sección",
  },

  save: {
    saving: "Guardando…",
    saved: "Guardado. Puede cerrar esta página y volver después.",
    failed: "No se guardó; revise su señal. Sus respuestas siguen en esta pantalla.",
    conflict: "No se guardó; esta solicitud se cambió en otra pantalla.",
    conflictDetail:
      "Nada de lo que escriba aquí se guardará ahora. Recargue la página para continuar desde las respuestas más recientes. Lo que haya escrito en esta pantalla desde la última vez que se guardó se perderá.",
    reload: "Recargar la página",
    restored: "Recuperamos respuestas de este teléfono que todavía no se habían enviado. Se están guardando ahora.",
    dropped:
      "Algunas respuestas escritas en este teléfono nunca se enviaron, y su solicitud se cambió después de eso, así que no se recuperaron. Revise sus respuestas.",
  },

  issues: {
    heading: "Antes de poder continuar",
    headingFinal: "Antes de poder enviar esto",
    formPath: "formulario",
    sendFailed: "No se pudo enviar la solicitud.",
  },

  identity: {
    intro:
      "Su nombre y su fecha de nacimiento se comparan con su historial de manejo, así que escríbalos exactamente como aparecen en su licencia.",
    introPartOne: "Su nombre se compara con su historial de manejo, así que escríbalo exactamente como aparece en su licencia.",
    first_name: "Nombre",
    middle_name: "Segundo nombre",
    last_name: "Apellido",
    date_of_birth: "Fecha de nacimiento",
    email: "Correo electrónico",
    phone: "Teléfono",
    optional: "Opcional.",
    otherNames: "Otros nombres con los que lo hayan conocido",
    otherNamesHint:
      "Opcional. Apellidos de soltera y nombres legales anteriores. Lo preguntamos porque sus empleadores anteriores deben verificar sus últimos tres años, y no pueden encontrarlo con un nombre que no está en sus registros.",
    addOtherName: "Agregar un nombre",
    remove: "Quitar",
    ssn: "Número de Seguro Social",
    ssnHint:
      "Opcional. Está en la solicitud porque algunas verificaciones del historial de manejo se hacen con él. Solo los últimos cuatro dígitos se guardan de forma legible.",
  },

  addresses: {
    intro: `Todas las direcciones en las que ha vivido en los últimos ${EMPLOYMENT_WINDOW_YEARS} años. Deje el mes final en blanco en la dirección donde vive ahora.`,
    line1: "Dirección",
    line2: "Apartamento, unidad",
    city: "Ciudad",
    state: "Estado",
    postal_code: "Código postal (ZIP)",
    from: "Desde",
    fromHint: "Mes y año.",
    to: "Hasta",
    toHint: "En blanco si vive aquí ahora.",
    add: "Agregar otra dirección",
    remove: "Quitar",
    optional: "Opcional.",
    coverageHeading: "Los últimos tres años",
    coverageComplete: "Cada mes de los últimos tres años tiene una dirección.",
    gap: (from: string, to: string): string =>
      from === to ? `No hay dirección para ${from}. Agregue dónde vivía entonces.` : `No hay dirección de ${from} a ${to}. Agregue dónde vivía entonces.`,
    listHeading: "Sus direcciones",
    addFirst: "Agregue dónde vive ahora",
    change: "Cambiar",
    toNow: "actual",
    noDates: "Todavía sin fechas",
    needsAnswers: "Falta algo aquí. Elija Cambiar para completarlo.",
    drawerNew: "Agregar una dirección",
    drawerIntro: "Una dirección a la vez. Puede cambiarla después.",
    drawerSave: "Guardar esta dirección",
    drawerCancel: "Cancelar",
  },

  partOneFacts: {
    heading: "Del inicio de su solicitud",
    intro: "Nos dio estos datos al inicio, y con ellos revisamos su historial.",
    dateOfBirth: "Fecha de nacimiento",
    phone: "Celular",
    cdl: "Su CDL",
    otherLicences: "Otras licencias",
    noOtherLicences: "Ninguna",
    classLabel: (cdlClass: string): string => `Clase ${cdlClass}`,
    expires: (date: string): string => `vence el ${date}`,
    noExpiry: "sin fecha de vencimiento",
    expired: "vencida; se revisa, pero no aparece en la solicitud",
    currentAddress: "Dónde vive ahora",
    currentAddressNote: "Esta es la dirección que dio al inicio. Díganos abajo si está mal.",
    tellUs: "¿Algo está mal? Díganos",
    tellUsLabel: "Qué está mal, y cómo debería ser",
    tellUsHint: "Lo leemos antes de enviar su solicitud. Puede que lo llamemos al respecto.",
  },

  licence: {
    intro: `Todas las licencias y permisos que tiene, y cualquiera que haya tenido en los últimos ${MVR_LOOKBACK_YEARS} años, en cualquier estado. Empiece por la que usa para manejar.`,
    number: "Número de licencia",
    state: "Estado que la emitió",
    stateHint: "Empiece a escribir para encontrarlo.",
    class: "Clase",
    expires: "Vence",
    othersHeading: `Otras licencias y permisos, actuales o de los últimos ${MVR_LOOKBACK_YEARS} años`,
    othersIntro:
      `Si se mudó de otro estado en los últimos ${MVR_LOOKBACK_YEARS} años, agregue la licencia de ese estado, aunque ya la haya entregado. Agregue también los permisos y endosos emitidos por separado. Solo se puede tener una licencia comercial a la vez.`,
    issuingAuthority: "Autoridad que la emitió",
    issuingAuthorityHint: "El estado o la agencia que la emitió.",
    otherNumber: "Número",
    otherKind: "Qué es",
    otherKindHint: "Opcional; por ejemplo, endoso de materiales peligrosos.",
    addOther: "Agregar otra licencia o permiso",
    remove: "Quitar",
    optional: "Opcional.",
  },

  ...APPLY_HISTORY_COPY_ES,

  questions: {
    addRow: "Agregar otro",
    addFirstRow: "Agregar uno",
    removeRow: "Quitar",
  },

  review: {
    intro:
      "Esto es todo lo que está por enviar. Revíselo, y vuelva a cualquier sección que necesite cambios.",
    empty: "Sin responder",
    none: "Ninguno declarado",
    count: (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`,
  },

  certify: {
    heading: "Su certificación",
    intro: "Escribir su nombre es su firma.",
    statement:
      "Esto certifica que esta solicitud fue completada por mí, y que todas las entradas y la información en ella son verdaderas y completas a mi leal saber y entender.",
    signedName: "Su nombre completo",
    dateNote: "La fecha se registra por usted cuando firma.",
  },

  fields: {
    addresses: "Dónde ha vivido",
    employers: "Dónde ha trabajado",
    gaps: "Tiempo entre trabajos",
    questionnaire: "Las preguntas de la empresa",
    employerRecord: "El registro de este empleador",
    gapFrom: "Desde",
    gapTo: "Hasta",
    gapWhat: "Qué hacía",
    nouns: {
      other_names: "Nombre",
      addresses: "Dirección",
      additional_licences: "Licencia",
      employers: "Empleador",
      employment_gaps: "Hueco",
      equipment_experience: "Equipo",
      accidents: "Accidente",
      violations: "Condena",
    },
    certifyOverride: "Marque la casilla para certificar que sus respuestas son verdaderas.",
    addOne: "Agregue al menos uno.",
    needed: "Esto es necesario.",
    notEmail: "Esto no parece una dirección de correo electrónico.",
    fromCalendar: "Elíjalo en el calendario.",
    tooLong: "Esto es demasiado largo.",
    tooShort: "Esto es demasiado corto.",
    check: "Revise esta respuesta.",
  },

  layout: {
    untitled: "Solicitud de conductor",
    theCarrier: "la empresa",
    collectedFor: "Esta solicitud se recopila para",
    processedBy: "y la procesa en su nombre Silvicom 360. Sus respuestas se comparten únicamente con la empresa.",
    /** The OTHER language's name, in that language: what pressing the switch gives. */
    switchTo: "English",
    switchLabel: "Cambiar el idioma de esta página",
  },

  englishDocuments:
    "Los documentos legales de esta página (los consentimientos, las autorizaciones, el formulario y el manual) se muestran en inglés, y el texto en inglés es el que usted firma. Si necesita ayuda para entender alguno, pida a la persona que lo invitó antes de firmarlo.",

  ...APPLY_FLOW_COPY_ES,
  ...APPLY_IDENTITY_COPY_ES,
  ...APPLY_PART_ONE_COPY_ES,
  ...APPLY_HUB_COPY_ES,
  ...APPLY_PERMISSIONS_COPY_ES,
  ...APPLY_SMS_COPY_ES,
  ...APPLY_HANDBOOK_COPY_ES,
  ...APPLY_DOCUMENTS_COPY_ES,
} satisfies ApplyCopy;

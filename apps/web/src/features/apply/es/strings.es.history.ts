import { CMV_WINDOW_YEARS, EMPLOYMENT_WINDOW_YEARS } from "@silvicom/shared";
import type { Localized } from "../language";
import type { APPLY_HISTORY_COPY } from "../strings.history";

/**
 * `strings.history.ts` in Spanish (Q-AW11, C4). The regulation's limits the English keeps — the
 * three years, the ten, "convicted or forfeited bond", "denied, revoked or suspended" — are kept
 * here too. Drafted 2026-10-21 for the owner's review.
 */
export const APPLY_HISTORY_COPY_ES = {
  employment: {
    intro: `Anote todos los trabajos, de manejo o no, de los últimos ${EMPLOYMENT_WINDOW_YEARS} años. De los ${CMV_WINDOW_YEARS - EMPLOYMENT_WINDOW_YEARS} años anteriores, anote solo los trabajos en los que manejó un vehículo comercial. El tiempo en que no manejaba no es un hueco que tenga que explicar.`,
    none: "No he tenido empleo durante este periodo",
    employer: "Empleador",
    usdot: "Número USDOT",
    usdotHint: "Si lo sabe.",
    address: "Dirección",
    addressHint: "Tenemos que registrar adónde escribimos.",
    city: "Ciudad",
    state: "Estado",
    phone: "Teléfono",
    phoneHint: "Para poder comunicarnos con ellos.",
    email: "Correo electrónico",
    emailHint: "Si lo sabe.",
    position: "Puesto",
    from: "Desde",
    to: "Hasta",
    toHint: "En blanco si todavía trabaja ahí.",
    reason: "Motivo de salida",
    reasonHint: "Por qué se fue.",
    operatedCmv: "En este trabajo manejé un vehículo comercial",
    dotRegulated: "Este empleador estaba regulado por el DOT",
    subjectToFmcsr: "En este trabajo, ¿le aplicaban las Regulaciones Federales de Seguridad de Transportistas (FMCSR)?",
    subjectToFmcsrHint: "Las reglas federales de seguridad para las empresas de transporte y sus conductores.",
    safetySensitive: "¿Era un trabajo sensible para la seguridad que requería pruebas de drogas y alcohol del DOT?",
    safetySensitiveHint:
      "Cualquier trabajo en el que el DOT hace pruebas de drogas y alcohol, en cualquier industria que regula: camiones, autobuses, aviación, ferrocarril, transporte público o ductos.",
    jobNeedsAnswers: "Faltan algunas respuestas. Elija Cambiar para completarlas.",
    add: "Agregar otro empleador",
    remove: "Quitar",
    experience: "Experiencia de manejo",
    experienceHint: "Opcional: equipo, rutas, años.",
    equipmentHeading: "Equipo que ha manejado",
    equipmentIntro:
      "Qué tipos de vehículo ha operado. Agregue una línea por cada uno, o descríbalo arriba, lo que le sea más fácil.",
    equipmentClass: "Clase de equipo",
    equipmentType: "Tipo",
    equipmentTypeHint: "Caja seca, cisterna, plataforma, etcétera.",
    equipmentFrom: "Desde",
    equipmentMonthHint: "Mes y año.",
    equipmentTo: "Hasta",
    equipmentToHint: "En blanco si todavía lo maneja.",
    equipmentMiles: "Millas totales aproximadas",
    equipmentMilesHint: "Un número aproximado está bien.",
    addEquipment: "Agregar equipo",

    jobsHeading: "Sus trabajos",
    addFirstJob: "Agregue su primer trabajo",
    addJob: "Agregar otro trabajo",
    editJob: "Cambiar",
    removeJob: "Quitar",
    jobNoDates: "Todavía sin fechas",
    jobToNow: "actual",
    coverageHeading: "Cuánto tiene cubierto",
    coverage: (percent: number, years: number): string =>
      `Tiene cubierto el ${percent}% de los últimos ${years} años.`,
    coverageComplete: (years: number): string => `Los últimos ${years} años están cubiertos.`,
    coverageEmpty: (years: number): string =>
      `Todavía nada. Agregue los trabajos que ha tenido en los últimos ${years} años.`,
    gap: (from: string, to: string): string =>
      `De ${from} a ${to} no está cubierto. Si trabajaba entonces, agregue ese trabajo. Si no, diga qué hacía.`,
    gapExplanation: "¿Qué hacía en ese tiempo?",
    gapsHeading: "Tiempo entre trabajos",
    gapExplanationHint: "Por ejemplo: buscando trabajo, estudiando, licencia médica, cuidando a la familia.",
    employerHint: "El nombre como lo recuerda está bien; nosotros lo confirmamos.",
    moreAboutJob: "Más sobre este trabajo (opcional)",
    moreAboutJobHint: "Agregue lo que sepa. Le preguntaremos después si necesitamos el resto.",
    drawerNew: "Agregar un trabajo",
    drawerIntro: "Un trabajo a la vez. Puede cambiarlo después.",
    drawerSave: "Guardar este trabajo",
    drawerCancel: "Cancelar",
    aboutThisJob: "Sobre este trabajo",
  },

  safety: {
    intro: "Tres preguntas sobre su historial de manejo. Las listas se abren solo cuando la respuesta es sí.",
    accidentsQuestion: "En los últimos 3 años, ¿estuvo involucrado en algún accidente de vehículo de motor?",
    violationsQuestion:
      "En los últimos 3 años, ¿fue declarado culpable de infringir una ley de tránsito, o perdió una fianza o garantía por una infracción?",
    violationsQuestionHint: "Las multas de estacionamiento no cuentan.",
    deniedQuestion:
      "¿Alguna vez le han negado, revocado o suspendido una licencia, un permiso o el privilegio de manejar un vehículo de motor?",
    accidentsHeading: "Accidentes",
    noAccidents: "No he tenido accidentes en los últimos 3 años",
    accidentDate: "Fecha",
    accidentNature: "Qué pasó",
    fatalities: "Muertes",
    injuries: "Heridos",
    hazmatSpill: "Hubo derrame de materiales peligrosos",
    addAccident: "Agregar un accidente",
    violationsHeading: "Condenas de tránsito",
    noViolations: "No he tenido condenas de tránsito ni he perdido fianzas en los últimos 3 años",
    violationDate: "Fecha",
    offence: "Infracción",
    violationState: "Dónde ocurrió",
    violationStateHint: "Opcional: con el estado basta.",
    penalty: "Sanción",
    penaltyHint: "Opcional.",
    addViolation: "Agregar una condena",
    licenceHeading: "Historial de licencias",
    everDenied: "Me han negado, revocado o suspendido una licencia, un permiso o un privilegio de manejar",
    denialDetail: "Qué pasó",
    denialDetailHint: "El motivo por el que ocurrió.",
    priorTestHeading: "Pruebas de drogas y alcohol",
    priorTestIntro:
      "Todas las empresas tienen que hacer esta pregunta, y un sí no termina su solicitud. Significa que tenemos "
      + "que ver los papeles que muestren que completó el proceso de regreso al trabajo (return-to-duty) antes de que pueda manejar.",
    priorTest:
      "En los últimos dos años, solicité un trabajo de conductor que no obtuve, y di positivo o "
      + "me negué a una prueba como parte de esa solicitud",
    priorTestHint: "Esto es sobre trabajos que solicitó, no sobre trabajos que tuvo.",
    remove: "Quitar",
  },
} satisfies Localized<typeof APPLY_HISTORY_COPY>;

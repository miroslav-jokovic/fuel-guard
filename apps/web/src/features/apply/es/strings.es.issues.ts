import type { Localized } from "../language";
import type { APPLY_ISSUES_COPY } from "../strings.issues";

/**
 * `strings.issues.ts` in Spanish (U7). Drafted 2026-11-12 for the owner's review, like the rest of the
 * Spanish page. Usted, as everywhere on it; dates arrive already written (MM/DD/AAAA, Q-AM12).
 */
export const APPLY_ISSUES_COPY_ES = {
  ruleIssues: {
    accidents_listed: () => "Indique cada accidente de los últimos 3 años, o confirme que no tuvo ninguno",
    violations_listed: () => "Indique cada infracción de los últimos 3 años, o confirme que no tuvo ninguna",
    employers_listed: () => "Indique sus empleadores, o confirme que no ha tenido empleo",
    experience_given: () => "Describa su experiencia de manejo, o indique el equipo que ha manejado",
    denial_described: () => "Explique la negación",
    suspension_described: () => "Explique la suspensión o revocación",
    question_answered: (p: { question: string }) => `Responda la pregunta "${p.question}"`,
    job_drove_truck: () => "Diga si manejó un camión en este trabajo",
    job_dot_regulated: () => "Diga si este empleador estaba regulado por el DOT",
    job_ends_before_start: () => "La fecha de fin no puede ser anterior a la fecha de inicio",
    job_saved_again: () => "Abra este empleador y guárdelo otra vez",
    job_address: () => "Indique la calle, la ciudad y el estado de este empleador",
    job_reason_for_leaving: () => "Diga por qué dejó este trabajo",
    job_fmcsr: () => "Diga si las Regulaciones Federales de Seguridad de Autotransportes (FMCSR) le aplicaban en este trabajo",
    job_drug_testing: () => "Diga si este trabajo estaba sujeto a pruebas de drogas y alcohol del DOT",
    address_gap_month: (p: { month: string }) => `Díganos dónde vivió en ${p.month}`,
    address_gap: (p: { from: string; to: string }) => `Díganos dónde vivió del ${p.from} al ${p.to}`,
    employment_gap: (p: { from: string; to: string }) => `Díganos qué hacía del ${p.from} al ${p.to}`,
    prior_test_answered: () =>
      "Diga si en los últimos dos años dio positivo o se negó a una prueba para un trabajo de manejo que solicitó",
    suspension_answered: () => "Diga si alguna vez le suspendieron o revocaron una licencia, permiso o privilegio",
    violation_state: () => "Indique el estado donde ocurrió",
    violation_penalty: () => "Indique la sanción: una multa, puntos, una suspensión",
    accident_hazmat: () => "Diga si se derramaron materiales peligrosos",
    seven_day_hours: () => "Indique sus horas de servicio de cada uno de los últimos siete días: 0 para un día que no trabajó",
    last_relieved_at: () => "Indique la fecha y la hora en que quedó libre de servicio por última vez",
    license_expiration: (p: { state: string }) => `Indique la fecha de vencimiento de su licencia de ${p.state}`,
    birth_date_not_real: () => "Esa fecha no existe",
    birth_date_future: () => "La fecha de nacimiento no puede ser en el futuro",
    birth_date_under_18: () => "Un conductor debe tener al menos 18 años",
    birth_date_over_120: () => "Revise el año: esa fecha de nacimiento es de hace más de 120 años",
  },
} satisfies Localized<typeof APPLY_ISSUES_COPY>;

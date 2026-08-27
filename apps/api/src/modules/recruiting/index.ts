/**
 * recruiting — the hiring harness, eleventh module (carved 2026-08-27, docs/ARCHITECTURE.md §4).
 *
 * The applicant's whole path in one place: invitation → public application (wizard, drafts,
 * captures, e-sign consent, SMS) → packet PDF → screening readiness → employment history and
 * employer inquiries → disposition → hire. Owns `driver_applications`, `application_drafts`,
 * `application_invitations`, `application_captures`, `applicant_dispositions`,
 * `employer_inquiries`, `driver_employment_history`, `esign_consents`, `sms_consents`, and
 * `seven_day_statements` (whose roster-route write stays pinned until it migrates here).
 *
 * The two evidence writes the evidence carve-out pinned (`applicationPdf/file.ts`,
 * `employerInquiry.ts`) now flow as the recorded `recruiting -> evidence` edge — filing into the
 * DQ record through the owner's interface. Everything here except SMS remains legally inert
 * until counsel clears the instruments (COUNSEL-REVIEW-PACKAGE): code-complete is not launched,
 * and the gates that hold that line live in the routes, not in this comment.
 */
export { recruitmentRouter } from "./routes/index.js";
export { publicApplicationRouter } from "./routes/publicApplication.js";
export { runApplicationNudgesOnce } from "./applicationNudgeSweep.js";
export { loadScreeningReadiness } from "./screeningReadiness.js";
export { dobCsvTemplate, importDriverDob } from "./dobImport.js";
export { handleInboundSms } from "./applicationSms.js";
export { returnToDutyBlocked } from "./returnToDuty.js";

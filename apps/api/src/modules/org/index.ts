/**
 * org — identity and platform machinery, seventeenth and last planned module of the re-founding
 * (carved 2026-08-27, docs/ARCHITECTURE.md §3).
 *
 * Owns `organizations`, `memberships`, `invites`, `org_modules`, `org_integrations`, `saved_views`,
 * `integration_credentials`, `org_usage_month`, `audit_logs` (append-only), `jobs`, and
 * `migration_markers`. The surface: invite/member routes with delivery, the audit-log route,
 * the job-queue bookkeeping every scheduler leans on (start/finish/heartbeat/reclaim — the
 * FOR UPDATE SKIP LOCKED contract), data retention (which knows what it may NEVER touch —
 * RETENTION_FORBIDDEN is evidence's law, enforced here), the daily digest, the boot-time schema
 * probe, and storage backup/reconcile. The queue RUNTIME (`queue/`) deliberately stays
 * outside: it is the process fabric every module's handlers register into, not one module's own.
 */
export { invitesRouter } from "./routes/invites.js";
export { deliverInvite, type InviteDelivery } from "./inviteDelivery.js";
export { membersRouter } from "./routes/members.js";
export { savedViewsRouter } from "./routes/savedViews.js";
export { auditRouter } from "./routes/audit.js";
export { sectionAccessRouter, toOverrides } from "./routes/sectionAccess.js";
export { surfaceAccessRouter, toSurfaceOverrides, surfaceClaimFor } from "./routes/surfaceAccess.js";
// The carrier's own identity, read by any module rendering a filing that must name it (0282).
export { carrierCityStateZip, getCarrierIdentity } from "./carrierIdentity.js";
export type { CarrierIdentity } from "./carrierIdentity.js";
export { jobsRouter } from "./routes/jobs.js";
export * from "./jobs.js";
export { runDataRetention } from "./dataRetention.js";
export { generateAndSendDigest } from "./digest.js";
export { startDigestScheduler } from "./digestScheduler.js";
export { runSchemaCheck } from "./schemaCheck.js";
export { startStorageReconcileScheduler } from "./storageReconcileScheduler.js";
export { stampIntegrationSynced } from "./integrationSync.js";
export { displayNameFor } from "./displayName.js";

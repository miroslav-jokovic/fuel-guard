/**
 * messaging — office↔driver threads and the notification fabric, twelfth module (carved
 * 2026-08-27, docs/ARCHITECTURE.md §4).
 *
 * Owns `message_threads`, `messages`, `message_reports`, `thread_participants`,
 * `notification_events`, `notification_preferences`, `notification_reads` — and
 * `device_push_tokens`, corrected here from the doc's driver-app parking: its writers are the
 * notification machinery, and the manifest is the enforcement. The root rule survives the move
 * unchanged: `notify()` → the `emit_notification` RPC (entitlement, mutes, quiet hours, dedupe)
 * — never hand-inserted rows — and it reaches the driver app only; office-facing delivery stays
 * email until a web inbox exists.
 *
 * Nearly every module tells somebody something, so the inbound edges (`* -> messaging`) are the
 * most-shared interface in the graph: evidence's DQ alerts, roster's credential issuance, fuel's
 * transaction alerts, efs's processing results, recruiting's nudges.
 */
export { messagesRouter } from "./routes/messages.js";
export { notificationsRouter } from "./routes/notifications.js";
export { notify, revokePushTokens } from "./notify.js";
export { notifyForTransaction } from "./notifications.js";
export { startNotificationPushScheduler } from "./notificationPush.js";
export { loginForDriver } from "./notify.js";

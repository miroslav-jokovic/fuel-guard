-- 0465 — a notification category for a Med-Stop result the DER must hear about (MEDSTOP-PLAN.md §6 F-5).
--
-- ── WHY ITS OWN FILE ────────────────────────────────────────────────────────────────────────────
-- 0464 is the medstop module's tables; `notification_events` is messaging's, and one migration
-- touches one module's tables (`lint:table-writers`). They ship in the same merge — neither reads the
-- other — and before the code that emits the category (0397's reasoning, below).
--
-- `drug_alcohol_result`: a verified POSITIVE, a REFUSAL, or a NEGATIVE-DILUTE on a test Med-Stop
-- closed. Sent to admin + safety_manager only — the roles that may read testing records — and its
-- text names no substance and no result beyond what those roles may see. The CHECK widens here; the
-- emitter follows in the next merge (0397's reasoning). Mirrors `NOTIFICATION_CATEGORIES` in
-- packages/shared/src/notificationsContract.ts; the two lists move together or not at all.
alter table public.notification_events drop constraint if exists notification_events_category_check;
alter table public.notification_events add constraint notification_events_category_check check (category in (
  'load_offered', 'load_changed', 'load_canceled', 'message_received',
  'duty_auto_closed', 'performance_week', 'training_due', 'system',
  'hazmat_review', 'hazmat_cleared', 'hazmat_rejected',
  'fuel_alert', 'declined_alert', 'efs_processing_failed', 'efs_feed_stale',
  'dq_expiring', 'dq_expired', 'dq_missing', 'dq_license_status', 'dq_mvr_received',
  'application_stalled',
  'card_status_changed',
  'drug_alcohol_result'
));

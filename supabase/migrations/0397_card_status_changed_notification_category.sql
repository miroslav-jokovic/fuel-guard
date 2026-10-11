-- 0397 — a notification category for a fuel card whose status changed at EFS without us.
--
-- ── WHY (EFS audit, 2026-09-30) ─────────────────────────────────────────────────────────────────
-- The card mirror swept once a day, so a card locked in the WEX portal — or put on hold by EFS
-- itself — kept its old status on our page for up to 24 hours, with nothing saying so. The status
-- poll (efsCardStatusPoll.ts) now notices within minutes and writes a `card.status_changed_externally`
-- audit row. This category is how the office HEARS about it: the audit row is the record, the
-- notification is the tap on the shoulder.
--
-- ── WHY ITS OWN CATEGORY, NOT `system` ──────────────────────────────────────────────────────────
-- `system` is non-mutable ("Service updates") and means "the product is telling you something about
-- itself". A card going on hold is fleet news, and a fuel manager who watches the WEX portal all day
-- may reasonably mute the in-app copy — which `system` would forbid. Filing it there would be the
-- mislabel the no-workarounds rule names.
--
-- ── WHY IT SHIPS ALONE ──────────────────────────────────────────────────────────────────────────
-- The CHECK widens here; the code that EMITS the category lands in a later merge. A merge can be
-- served before or after its migration applies (CLAUDE.md, the deploy window), and an emit against
-- the old CHECK fails outright — so the schema goes first and the writer follows once it is live.
--
-- Mirrors `NOTIFICATION_CATEGORIES` in packages/shared/src/notificationsContract.ts; the two lists
-- move together or not at all.
alter table public.notification_events drop constraint if exists notification_events_category_check;
alter table public.notification_events add constraint notification_events_category_check check (category in (
  'load_offered', 'load_changed', 'load_canceled', 'message_received',
  'duty_auto_closed', 'performance_week', 'training_due', 'system',
  'hazmat_review', 'hazmat_cleared', 'hazmat_rejected',
  'fuel_alert', 'declined_alert', 'efs_processing_failed', 'efs_feed_stale',
  'dq_expiring', 'dq_expired', 'dq_missing', 'dq_license_status', 'dq_mvr_received',
  'application_stalled',
  'card_status_changed'
));

-- Silvicom 360 — 0602 office chat on the phone: two more reasons a device stops receiving
-- (docs/plans/messaging/CHAT-WEB-PUSH-PLAN.md WP4; D-WP9, D-WP10)
--
-- 0599 gave a device four ways to stop: the person turned it off there, signed out there, the push service
-- said the browser dropped it, or the person was offboarded. WP4 adds the two a person cannot do from the
-- device itself:
--
--   unused   no page load from it in 90 days (D-WP9). Every signed-in page load refreshes `last_seen_at`,
--            so a device that has not been seen for that long is an old phone in a drawer or a browser
--            profile nobody opens; pushing chat lines at it is noise on somebody else's lock screen at
--            worst. Retired by the API at the moment it would have been pushed (`chatPush.ts`), so no
--            scheduler is involved. Revoked, never deleted: the person's device list and the row's
--            history stay; opening the app there again turns it back on, because the person's own
--            choice is still stored in that browser.
--   removed  the person took it off their device list from ANOTHER device (D-WP10) — the lost phone.
--            Unlike `unused`, a removed device does NOT come back by itself: that browser still holds
--            the subscription and the choice, and its next page load is refused (`chatPush.ts` routes,
--            409 `device_removed`) instead of reviving the row. Pressing Turn on there again is a new,
--            deliberate choice and is honoured.
--
-- WHY THE OLD CODE MEETS THIS SAFELY: the constraint only widens. Code that writes neither value is
-- unaffected; the new code's two writers fail their update (logged, nothing else) on a database this has
-- not reached yet, and neither runs before a device is 90 days old or a person presses Remove.
--
-- Rollback: put back 0599's four values — after revoking nothing new, i.e. only once no row holds either
-- value (`select count(*) from web_push_subscriptions where revoked_reason in ('unused','removed')`).

alter table web_push_subscriptions drop constraint if exists web_push_subscriptions_revoked_reason_check;
alter table web_push_subscriptions add constraint web_push_subscriptions_revoked_reason_check
  check (revoked_reason in ('turned_off', 'signed_out', 'gone', 'revoked_all', 'unused', 'removed'));

**2026-11-06 · Track G · monitor-alerts (#PR)**: ADS-RUNBOOK Gaps 3 and 4. No migration. No scorecard level moved.

**Built**
- **Gap 4: a dead token rings from the jobs that meet it.** The hourly insights pull, the leads backfill and
  reconcile each call `alertIfTokenRefused` (`alerts/connectionAlerts.ts`) with their failure reasons. It is the
  SAME alert as pause and create: `ads_token_expiring`, the connection marked `failing`, deduped
  `ads_token_expiring:<connection>:<day>`. So the three jobs and the pause path make one bell per connection per
  outage day, and a second run rings nothing new. The job still fails: the alert tells a person, it does not turn
  the run green. Reconcile calls it for its own reads too, not only through the pull inside it.
- **Gap 3: a Meta-rejected ad is detected.** `monitor/adReview.ts`, called by reconcile: each ad of every
  `launching`/`live` campaign is read with `GET /{ad}?fields=id,effective_status,ad_review_feedback`. A
  `DISAPPROVED` (critical) or `WITH_ISSUES` (warning) verdict is one `ads_actions` row of kind `external_change`,
  keyed `ad_review:<connection>:<ad>:<status>`, with Meta's `ad_review_feedback.global` reasons, plus one
  `ads_rejected` bell on the same key. A failed ad read is a failure of the run. Reconcile still never POSTs.
- **FakeMeta**, add-only: `reviewAd(adId, verdict)` and `AdReviewVerdict` / `reviewedAd` in `fakeMetaFaults.ts`. Meta's
  pages are cited there (read 2026-11-06, OUR reading until L4). It is NOT a `FakeMetaFault` case, because adding
  to that union breaks Track W's contract `faultProxy.ts`, and a verdict is lasting state, not a one-call fault.
- Lead goldens: `connection_bells` (schema, runner). `an-outage-past-the-window-closes-itself.yaml` now expects 2:
  its two refusing runs are 72 h apart, so two days and two bells. The connection's `failing` write is the alert's,
  no longer counted as a stray write.
- The registry pins six new titles at Monitor L2. `pnpm gen:ads-readiness` left the generated file unchanged,
  because no level moved.
- ADS-RUNBOOK procedures 2 and 4 are rewritten. Gaps 3 and 4 are struck.

**Not built**
- The warning BEFORE a token expires: still Q-AD24 (b), Stage 2.
- Ad review on `paused` campaigns: a paused ad spends nothing; it is read again once launched.

**Mutants:** 16, all killed by a named test:
- token alerting (6): never recognised; insights silent; backfill silent; reconcile's own reads silent; dedupe per
  run instead of per day; alert turns the pull green;
- lead goldens' bell count (1);
- ad review (9): paused campaigns read; any status a rejection; key without status; no bell; failed read
  swallowed; reconcile drops the review's failures; reconcile reviews nothing; reasons dropped; WITH_ISSUES critical.

**Traps:** a transient fault on an ad read waits out the client's real 1 s + 4 s backoff. The test uses a
non-retried refusal on that ad.

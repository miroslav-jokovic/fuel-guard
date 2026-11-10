**2026-11-10 · owner · enterprise-controls audit (docs only)**

- Owner asked whether the ads and leads automation follows "all best enterprise grade practices of SAP software
  and logics". There is no single SAP checklist, so the measure was SAP's control ideas: change documents, release
  strategy, segregation of duties, availability control, exactly-once posting, reconciliation, period close,
  retention, transport path, interface monitoring.
- Read from main `9d16b1c`: `0537_ads_foundation.sql` (triggers AX010–AX031), `guard/approvals.ts`,
  `guard/budgetGuard.ts`, `campaigns/campaignDoors.ts`, `routes/guard.ts`, `monitor/reconcile.ts`,
  `recruiting/leads/leadPurge.ts`, `org/dataRetentionPolicy.ts`, `org/dataRetentionForbidden.ts`,
  `scripts/ads-certifications.json`, `shared/ads/settingsContract.ts`.
- Meets: append-only ledgers enforced in the database, the spend fence and kill switch, single-use approvals
  that must cover the amount, idempotent actions and store-once leads, the daily reconcile that never adopts,
  frozen creatives and briefs, the release train with the L4 launch gate, failed-jobs card and alerts.
- Does not meet, opened as **Q-AD69–Q-AD73** in ADS-AGENT-PLAN §9, each with candidates and a recommendation:
  Q-AD69 no maker-checker (and `second_approver_above_cents` defaults to `null`) · Q-AD70 spend reconciled to
  Meta's reporting, never to an invoice or the ledger · Q-AD71 no period close for spend · Q-AD72 no time-based
  retention for leads · Q-AD73 everything is proven on the fake platform only (certifications empty).
- Not confirmed: whether a lead carries a stored consent / privacy-notice record. Left as a note under the
  questions, not a finding.
- Nothing built. No ruling changed.

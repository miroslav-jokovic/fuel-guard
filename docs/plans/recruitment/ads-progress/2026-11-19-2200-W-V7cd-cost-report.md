**2026-11-19 · Track W · V7c + V7d: which ad a lead came from, and the cost report**

- **Read** `recruiting_leads.raw` keeps Meta's `ad_id` on both intake roads (`LEAD_FIELDS` in `leadFetch.ts` and
  `backfill.ts`); `platform_refs.ads[]` only grows (`addCampaignAds` appends); a preset version's `recipe` names its
  hook and scene. So the angle is derived on read; nothing is stored twice (Q-APX25 (a)).
- **Shared** `leadCostReport.ts` (`foldLeadCostReport`, `countsAsQualified`, `angleLabel`, `AdsLeadCostView`),
  `LeadSources` and `leadSourceOutcomeSchema` in `leadOutcomes.ts`.
- **API** `recruitingLeadSources` (one reading with `readLeadOutcomes`), `ads/report/leadCostView.ts`,
  `routes/report.ts` (`GET /api/ads/report/leads`), wired at `app.ts`; both route ledgers.
- **Web** `AdsLeadCostCard.vue` on Ads › Overview, `useAdsLeadCost`.
- **Proved** 18 planted faults, 17 red; the one that stayed green deleted a branch no input reaches (a no-op), and the
  branch was removed. Faults: converted not counted, the total's guard, no spend read as 0, a typed-in lead put in an
  angle, a cost divided by zero, spend with no lead hidden, the window's end ignored, a non-digit ad id passed on,
  ad-only reading widened, the hour window's end, two currencies summed, a retired ad's hours lost, UTC days, a
  backwards range, an over-long range, $0 for no spend, the URL's days ignored.

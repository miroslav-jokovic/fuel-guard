**2026-11-20 · Track W · V7e: Meta's qualified-lead goal, measured; the feed sends each lead**

- **Read** Meta's Conversion Leads pages (overview, CRM steps 3–6, payload spec; the "requirements" URL and the
  Business Help page 404). No page names the goal's API value or mentions EMPLOYMENT, so Q-AD17 stays the sandbox's.
- **Gap found and closed** coverage needs an event per lead; the feed sent stages only. 0637 + `OUTCOME_STAGES` gain
  `lead`, sent at the lead's arrival (`outcomeCandidates`). Outcome feed tests, the L3 sweep (now 8 inserts, 8 updates,
  4 batches) and the simulator feed updated; two pinned titles repointed in `ads-readiness.registry.mjs`.
- **Readiness** shared `conversionLeads.ts`; api `report/conversionLeadsView.ts`, `routes/conversionLeads.ts`; web
  `AdsConversionLeadsCard.vue` on Ads › Automation. No switch.
- **Proved** 11 planted faults, all red (volume off by one, feed without a dataset, coverage by any id, the 28-day
  limit, the 40 % bound, Q-AD17 guessed, the lead event dropped, sent at now, other channels counted, unsent events
  counted, the cohort window). `ads-foundation` matrix 138/138 with 0637.

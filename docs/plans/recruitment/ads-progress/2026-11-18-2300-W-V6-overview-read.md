**2026-11-18 · Track W · V6's Overview read (plan §0.3 step 3)**

- **`GET /api/ads/overview`** (view, like the spend and health reads): running campaigns, this month's spend and
  leads, every open campaign with its month figures, a "Needs you" list, and the action ledger a page at a time.
  Contract and folds in shared `adsOverview.ts`; reads in `overview/overviewView.ts`.
- **One fold, not two.** Month spend is the guard's platform month, taken from `adsSpendView`, so the Overview, the
  spend card and the launch check cannot disagree. The spend read gains `month_spend_cents` and `month_leads` per
  campaign for it. Leads are the platform's count on our hourly rows: what Meta says the ads produced, not what reached
  the Leads page (Recruitment's ledger, which ads does not read, D-AD17). The contract says so.
  - Found on the way: comparing an hour to the month's start as strings is wrong, because PostgREST writes `+00:00` and
    `monthContext` writes `Z`. The month fold compares instants; a test puts an hour on each side of 1 November in
    Central and fails on the string compare.
- **"Needs you" is derived, not listed.** `CAMPAIGN_STATES_AWAITING_PERSON` comes from the machine: a state with a next
  step that no agent may take (kill, archive and platform rows don't count as next steps). Today that is plan_review,
  review, paused and failed. A paused campaign is left off only when its newest move into `paused` was a pause or kill
  a **person** asked for. That decision is already made, and listing it would teach the office to ignore the list.
  Created-and-never-launched, a rule's pause, the platform's pause or rejection, a failed launch, and a pause with no
  row at all are all listed. The list also carries: the kill switch, a platform with no monthly cap, and a failing
  connection or a token in warn or bad (the health read's `foldConnections`). A state the machine newly hands to a
  person is listed as "waiting", never dropped.
- **Ledger.** `ads_actions` newest first, 50 a page, addressed the way the Audit log is (D-US12): `?before=` is the
  page's `older`, `?after=` its `newer`, and there are no page numbers. The keyset is (started_at, id), because a kill
  writes several rows in one instant and started_at alone would skip or repeat rows. A newer read walks up from the
  cursor in ascending order and is turned back to newest first. The cursor keeps the timestamp exactly as Postgres
  wrote it, because a JS Date would cut microseconds and move the boundary. The route refuses (400) a malformed
  cursor, or both directions at once, before any read.
- Route sweep (cross-carrier) and gate table carry the new route.
- Mutations, each alone, each red: the derived rule, the person check, the cursor's timestamp check, the
  instant compare, the org filter on the ledger, on the paused transitions and on the ready count, the next-page
  cursor, the name read for an archived campaign; then the ascending newer read, its reversal, the both-directions
  refusal, and each side of the page's two cursors.

**Not built:** the screens (V6 next). The web's `isWorking` set in `adsCampaignFlow.ts` is still a hand list beside
the machine. The Overview doesn't use it, but V6 should derive it the way this read derives "Needs you".

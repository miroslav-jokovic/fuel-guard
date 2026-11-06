**2026-11-06 · Track S · outcome-feed-switch (Q-AD40's screen)**

- **Step 0:** #2118's Q-AD46 now says where the setting lives: staging's API is on AWS and reads Parameter Store
  `/silvicom/staging/api`, where its schedulers run (both lanes held on `/api/version`). Railway uat is no longer
  named. Rebased on main; it merges once main is green (#2119).
- **The API was ready:** `PUT /api/ads/settings` (`routes/guard.ts`) parses with the shared `adsSettingsSchema`, which
  holds `outcome_feed` as optional (#2109), and the GET returns it. No settings-service change was needed.
- **Built:** an Outcome feed section on Settings › Ads control (`AdsOutcomeFeedSection.vue`), inside the one settings
  form, so it saves in the same version, admin + step-up as before. It has a switch and the dataset id. The help names
  the stages sent, read from `LEAD_OUTCOME_STAGES`, and the two never sent, read from `UNRECORDED_LEAD_STAGES` ("never
  sent, not even as a zero", Q-AD37). It also says only Meta's lead id goes with each stage, and that stages older
  than 7 days are skipped (`outcomeEvents.ts`). A refusal is the contract's own sentence.
- **The whole-object trap, pinned both ways** (`adsOutcomeFeed.test.ts`): a save of another section keeps the feed
  as it was, and a save of the feed keeps every other field as it was, in the form logic and through the mounted
  form's posted body. A version saved before the feed existed reads as off, and an unrelated save leaves it with
  no feed group. 11 mutants, each one exact string, all killed, every file restored byte-identical.
- **Browser pass:** failed, empty and saved states at 1280 and 390, with no page errors. On the empty page, switching
  the feed on with no dataset shows "Name the Meta dataset before turning the outcome feed on."; with a dataset the
  PUT carries `{ enabled: true, dataset_id: "990000000201" }`.
- **Trap:** 21 stray vitest workers from an earlier killed run put the load average at 36, and the web suite timed
  out at 5 s everywhere. Killing them made the "failures" pass alone (29/29).

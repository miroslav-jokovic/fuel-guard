**2026-11-19 · Track W · V5 parts 3 and 4: Assisted start, and who does each step on Ads › Automation**

- **The mode is a setting** (`modes.start_campaign`, shared `settingsContract.ts`): optional, absent = Manual, as
  `outcome_feed` is; the Settings form round-trips it (a save replaces the whole object) and writes it only once it was
  saved or changed. "Starting campaigns" sits with the other choices in Ads › Settings (an admin, fresh sign-in).
- **Assisted** finds the open openings with no standing campaign (`openingsAwaitingCampaign`, shared, pure) and lists
  them on the Overview's "Needs you" and on Campaigns. Start opens the form with the opening chosen; `?start=` is the
  Overview's link to it. Nothing is created until the person presses Start in the form — `start_campaign` is a
  person's in both modes, and a test holds the two modes to that act.
- **Read where the rule allows:** the openings are recruiting's and the campaigns are the ads', so both pages read
  them and the shared function decides — no new API source, no feature reaching into another (D-AD17).
- **Not guessed:** the campaign list door answers the newest 200 (`CAMPAIGN_LIST_LIMIT`, moved to shared). With 200,
  an older standing campaign could be missing, so nothing is offered rather than an opening offered twice.
- **Ads › Automation** opens with "Who does each step": the six steps, the mode in force from the saved settings, and
  every other mode open ("Change in Settings", for whoever may open it) or locked with what opens it — locked because
  `modeOpen` reads the authority table, so the screen cannot offer what the code would not run.
- **Found on the way:** an alerts test asserted "no select anywhere in the form" to mean "no person can be added";
  narrowed to the alert rows, and the positive case now asserts the same selector finds the pickers.
- Mutations, each alone, each red (8): the list limit ignored, an archived campaign holding its opening, the start
  mode hard-coded, the modes group always written, a closed opening chosen in the form, the page ignoring the mode,
  the Overview listing for someone who cannot start, the screen ignoring the table's locks.

**V5 is built.** The agent's own lower waits on Q-APX23. Nothing of V5 has been walked on staging.

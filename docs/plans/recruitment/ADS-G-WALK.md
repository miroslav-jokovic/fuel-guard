# Recruiting ads — the G-walk (staging walk script for the owner)

The owner's walk of the whole ads agent on staging, before any real spend: ADS-AGENT-BUILD-WORKFLOW.md §4, row
**G-walk** ("every line ticked by the owner"). One numbered line per act: the click path, then what you should
see. Written 2026-11-06 by Track S from a walk on `https://staging-api.360.silvicominc.com` (main `c04ee30`), so
each line is either one that was **walked** and seen, or marked:

- **⛔ Blocked (Q-AD41):** the step needs a fresh sign-in. On staging today every fresh sign-in fails, because the
  API cannot check a password (`POST /api/auth/step-up` → 503 `step_up_unavailable`, "Password verification is
  not configured on this deploy"). The line is written from the code and the browser tests; walk it once
  Q-AD41 is fixed.
- **Stage 2:** the simulator cannot show it; it needs Meta's sandbox or a real Meta test lead (from Mon 11/09).

**Who you sign in as.** Three staging test members (passwords in the owner's Keychain, service
`silvicom-staging-test-member`): `miki+staging-admin@…` (admin), `miki+staging-fleet-manager@…` (fleet manager,
who manages recruiting) and `miki+staging-dispatcher@…`. Lines say **[Admin]** or **[Manager]**. A manager is
anyone who manages recruiting: a fleet manager or a recruiter.

**Before you start.** The yellow **UAT** bar at the top says you are on staging. Nothing here reaches Meta or
spends money: the ad account is the **Simulator**.

---

## A. Who may see Ads control

1. **[Admin] ⛔** Settings › Permissions › Roles › **Fleet manager** › Screens › Settings › **Ads control** →
   switch it on → **Confirm it is you**: type your password → **Confirm**.
   *Should see:* the switch stays on after a reload. *Walked 11/06:* the password was refused with "Could not
   confirm your password. Check it and try again", though it was right; underneath, step-up answered 503
   (Q-AD41). This is why the 11/06 grant did not persist.
2. **[Manager]** Sign in as the fleet manager → Settings › Recruiting › **Ads control**.
   *Should see:* the page opens (after line 1), every field greyed, **no Save**, **Stop all ads** offered, **no
   Clear**, and the **Spend so far** card readable. *Walked 11/06:* the page sends the fleet manager to the home
   page, correct while line 1 is undone.

## B. Ads control (admin)

3. **[Admin]** Settings › Recruiting › **Ads control**.
   *Should see, walked 11/06:* **Kill switch — off** with a Reason box and **Stop all ads**. Below it, **Spend so
   far**: "No ad account is connected, so nothing has spent", then two red lines, "0 AI tokens used. No monthly
   budget is saved…" and "0 picture credits used…". Then **Ad accounts**, **Brand kits**, **Presets**, and the
   limits form.
4. **[Admin] ⛔** **Ad accounts** → **Connect the simulator** → confirm your password.
   *Should see:* a **Simulator** row, status connected. *Walked 11/06:* the password prompt appeared in the card;
   the connect itself answered `step_up_required` (Q-AD41).
5. **[Admin] ⛔** On the Simulator row → **Test**.
   *Should see:* one line saying every check passed.
6. **[Admin] ⛔** The limits form: a monthly cap for **Simulator** (e.g. $100), a daily budget most per campaign
   (e.g. $20), a lifetime most (e.g. $200), the auto-pause rules (the suggested benchmark values beside each
   box are fine), the AI tokens a month (e.g. 1,000,000) and picture credits a month (e.g. 500), and switch on
   **Draws the picture** (and the other agents) → **Save as a new version** → confirm your password.
   *Should see:* "Ads settings saved as version 1". In **Spend so far**, the Simulator line reads "$0 of $100 spent this
   month" and both red AI lines turn grey.
7. **[Admin]** **Brand kits** → **New brand kit**: Kit name, Company name, one colour (a name and a hex like
   `#C0392B`), drop a photo of a truck with **no lettering** into "Drop photos here", say what it shows →
   **Save brand kit**.
   *Should see, walked 11/06:* the photo row appears after the upload; the drawer closes with "Brand kit saved";
   the row reads "Version 1 · 1 photo · saved … by …" and is still there after a reload.
8. **[Admin]** **Presets** → **New preset**: Key `P1`, a name, a hook, four copy slots (e.g. `headline` 40,
   `cta` 25, `body` 200, `title` 40), then **Where the copy goes**: on the image `headline` and `cta`, beside it
   `body` and `title`; an image prompt with `{time_of_day}` and "no text, no logos, no lettering" → **Save
   preset**.
   *Should see, walked 11/06:* "P1 · … · In use · version 1". Choosing the same slot for the image and beside it
   is refused in words ("headline is drawn on the image; the platform's text is another slot").
9. **[Admin]** **Edit** the kit → change nothing → **Save as version 2**.
   *Should see:* the row reads "Version 2". (Ads made earlier keep the version they were made with.)

## C. A campaign, made and reviewed (manager)

10. **[Manager] ⛔** Recruitment (sidebar) › **Applicants** › **Campaigns** tab → **New campaign** → choose an
    open **Opening**; the **Ad account** (Simulator) and **Brand kit** are chosen already when there is one of
    each → **Start campaign**.
    *Should see:* "Campaign started", and the campaign drawer opens on **Making the ads**, saying the agent is
    working and the page updates by itself. *Walked 11/06:* the tab and the form open for the fleet manager, and
    the form says "A campaign needs a connected ad account and a saved brand kit", correct while lines 4 and 6
    are blocked.
11. **[Manager]** Wait for **Waiting for review** (minutes: the agent writes, draws and checks every ad).
    *Should see:* each ad with its pictures in every format and both languages (EN, ES), its words, and its
    **checks**: one row per format and language, each with **Words**, **Text on the picture** and **Picture**
    marked Passed, Failed or Not checked. A failed picture check shows the checker's sentence ("A logo on the
    cab door."); an ad that failed says why above its rows.
12. **[Manager]** On each ready ad → **Approve** (or **Reject**, which needs a reason).
    *Should see:* the ad reads **Approved**.
13. **[Manager]** In the drawer's footer → **Approve this campaign**, then **Create it paused** when it is offered.
    *Should see:* **Approved**, then **Creating on the platform**, then **Paused**.
14. **[Manager]** Close the drawer, then from the home page: **Recruitment** › **Applicants** › **Campaigns** › the
    row. *Should see:* the paused campaign open in **four clicks** (E3's done-when): the Recruitment group, Applicants, the
    Campaigns tab, the row. *Walked 11/06* on the tab
    with no campaign yet: three clicks reach the list.

## D. Launch, and the brake

15. **[Admin] ⛔** Open the paused campaign → **Launch**: Daily budget $5, Lifetime cap $50 → **Approve and
    launch** → confirm your password.
    *Should see:* "Campaign launching", then **Launching**, then **Live**. The simulator spends nothing.
16. **[Manager]** The same campaign as the fleet manager.
    *Should see:* no Launch form (Launch is an admin's).
17. **[Admin] Stage 2** A campaign on a **Meta** account (sandbox) → Approve and launch.
    *Should see, until every part has passed its sandbox run:* "Not launched. These parts of the ads agent have
    not passed a test run against the real platform yet:" with a list in plain words ("Making the pictures",
    "Putting the ads on the platform, on Meta (Facebook, Instagram)") and "Nothing was spent".
18. **[Manager]** Ads control → **Kill switch** → type a reason → **Stop all ads**. (No password: stopping is
    always allowed.)
    *Should see:* "Ads stopped", **Kill switch — on** with your reason, and within about a minute the live
    campaign reads **Pausing**, then **Paused**. *Not walked 11/06 on purpose:* line 19 is blocked, so the
    switch could not have been cleared, and staging would have been left with every ad stopped.
19. **[Admin] ⛔** **Clear the kill switch** → reason → confirm your password.
    *Should see:* "Kill switch cleared", **Kill switch — off**. Nothing relaunches by itself; a paused campaign stays paused.

## E. Leads, and what reconcile says

20. **[Admin] Stage 2** A **real Meta test lead** from Meta's lead ads testing tool, on the live sandbox
    campaign's form. *Should see:* within a minute, the bell's **New ad leads**, and the lead on
    Recruitment › **Leads**, naming the campaign it came from. *On staging today:* the simulator cannot be made
    to send one. Use Recruitment › Leads › **Add a lead** as the stand-in for lines 21–22.
21. **[Manager]** Recruitment › **Leads** → the lead → **Log a contact** (method, outcome) → **Save**.
    *Should see:* the lead leaves "waiting for contact"; the bell's "Ad leads waiting for contact" does not ring
    for it.
22. **[Manager]** On the lead → **Make applicant** → **Save**.
    *Should see:* the lead reads converted and the person is on **Applicants**.
23. **[Admin] Stage 2** **Reconcile**: change the live sandbox ad's budget in Meta's Ads Manager by hand, wait for
    the daily check.
    *Should see:* the bell's **Ads changed outside Silvicom**, and in **Spend so far** the daily-check line
    for the Meta account: when it last ran and "1 difference recorded since". The simulator has no daily check.
24. **[Admin]** Settings › **Data & sync** › **Failed background jobs** (E5).
    *Should see, walked 11/06:* the card, listing any job that failed every try it was allowed. As the fleet
    manager, Data & sync is not reachable (admin-only, owner's ruling 11/06).

---

**Where the evidence is.** Each walked line's screenshots and network log are in the walking chat's scratchpad,
not this repo. The walk's findings are in `ads-progress/2026-11-06-1100-S-staging-walk.md`.

# Recruiting ads — the G-walk (staging walk script for the owner)

The owner's walk of the whole ads agent on staging, before any real spend: ADS-AGENT-BUILD-WORKFLOW.md §4, row
**G-walk** ("every line ticked by the owner"). One numbered line per act: the click path, then what you should
see. Written 2026-11-06 by Track S from a walk on `https://staging-api.360.silvicominc.com` (main `c04ee30`), so
each line is either one that was **walked** and seen, or marked:

- **✅ Walked 11/06 (walk 2):** seen on staging after Q-AD41's fix, as written.
- **⛔ Blocked (Q-AD43):** the step needed an open opening, and no screen made one. Q-AD43 was built on 11/06
  (Recruitment › Openings), so these lines are now marked by what stops them today.
- **⛔ Blocked (Q-AD46):** staging's ads agent runs under the brake (`ADS_ENABLED` unset on uat), so a started
  campaign stays at **Starting**. The line is written from the code and the browser tests; walk it once Q-AD46 is
  ruled.
- **Stage 2:** the simulator cannot show it; it needs Meta's sandbox or a real Meta test lead (from Mon 11/09).

**Who you sign in as.** Three staging test members (passwords in the owner's Keychain, service
`silvicom-staging-test-member`): `miki+staging-admin@…` (admin), `miki+staging-fleet-manager@…` (fleet manager,
who manages recruiting) and `miki+staging-dispatcher@…`. Lines say **[Admin]** or **[Manager]**. A manager is
anyone who manages recruiting: a fleet manager or a recruiter.

**Before you start.** The yellow **UAT** bar at the top says you are on staging. Nothing here reaches Meta or
spends money: the ad account is the **Simulator**.

---

## A. Who may see Ads control

1. **[Admin] ✅** Settings › Permissions › Roles › **Fleet manager** › Screens › Settings › **Ads control** →
   switch it on → **Confirm it is you**: type your password → **Confirm**.
   *Should see, walked 11/06:* the switch stays on after a reload, and the fleet manager's sidebar gains Ads control.
   (Walk 1 found every "Confirm it is you" failing on staging, Q-AD41, fixed the same day.)
2. **[Manager] ✅** Sign in as the fleet manager → Settings › Recruiting › **Ads control**.
   *Should see, walked 11/06 at 1280 and 390:* the page opens; every field greyed (only the kill switch's Reason box
   takes typing); **no Save**; **Stop all ads** offered; **no Clear**; no New brand kit, New preset, Edit, Connect,
   Test or Disconnect; and **Spend so far** readable.

## B. Ads control (admin)

3. **[Admin] ✅** Settings › Recruiting › **Ads control**.
   *Should see, walked 11/06:* **Kill switch — off** with a Reason box and **Stop all ads**. Below it, **Spend so
   far**: "No ad account is connected, so nothing has spent", then two red lines, "0 AI tokens used. No monthly
   budget is saved…" and "0 picture credits used…". Then **Ad accounts**, **Brand kits**, **Presets**, and the
   limits form.
4. **[Admin] ✅** **Ad accounts** → **Connect the simulator** → confirm your password (the prompt opens inside the
   card).
   *Should see, walked 11/06:* a **Simulator** row marked **Connected**, "Account 990000000001 · Page 990000000101 ·
   Last tested …".
5. **[Admin] ✅** On the Simulator row → **Test** (no second password within five minutes of the first).
   *Should see, walked 11/06:* "Every check passed (7 of 7)."
6. **[Admin] ✅** The limits form: a monthly cap for **Simulator** (e.g. $100), a daily budget most per campaign
   (e.g. $20), a lifetime most (e.g. $200), the auto-pause rules (the suggested benchmark values beside each
   box are fine), the AI tokens a month (e.g. 1,000,000) and picture credits a month (e.g. 500), and switch on
   **Draws the picture** (and the other agents) → **Save as a new version** → confirm your password.
   *Should see:* "Ads settings saved as version 1" (walked 11/06: the save answered version 1; the toast was not
   caught on screen). In **Spend so far**: "Simulator: $0
   of $100 spent this month · On course for $0 if today's daily budgets run for the 25 days left", and the two red
   AI lines become "0 of 1,000,000 AI tokens used this month" and "0 of 500 picture credits used this month".
7. **[Admin] ✅** **Brand kits** → **New brand kit**: Kit name, Company name, one colour (a name and a hex like
   `#C0392B`), drop a photo of a truck with **no lettering** into "Drop photos here", say what it shows →
   **Save brand kit**.
   *Should see, walked 11/06:* the photo row appears after the upload; the drawer closes with "Brand kit saved";
   the row reads "Version 1 · 1 photo · saved … by …" and is still there after a reload.
8. **[Admin] ✅** **Presets** → **New preset**: Key `P1`, a name, a hook, four copy slots (e.g. `headline` 40,
   `cta` 25, `body` 200, `title` 40), then **Where the copy goes**: on the image `headline` and `cta`, beside it
   `body` and `title`; an image prompt with `{time_of_day}` and "no text, no logos, no lettering" → **Save
   preset**.
   *Should see, walked 11/06:* "P1 · … · In use · version 1". Choosing the same slot for the image and beside it
   is refused in words ("headline is drawn on the image; the platform's text is another slot").
9. **[Admin]** **Edit** the kit → change nothing → **Save as version 2**.
   *Should see:* the row reads "Version 2". (Ads made earlier keep the version they were made with.)

## C. A campaign, made and reviewed (manager)

9a. **[Admin] ✅** Recruitment › Applicants › **Openings** tab → **New opening**.
    *Should see, walked 11/06:* "No hiring profile yet", then the owner's starting requirements, read-only: age 23,
    a Class A CDL, 2 years of Class A, hazmat preferred, and the disqualifiers, each with its reason. Name it ("Class A
    regional") → **Save as the first hiring profile**. "Who qualifies" then shows "Class A regional · version 1",
    chosen already. Close the drawer.
9b. **[Manager] ✅** The same tab → **New opening**: Who qualifies, Title "Staging walk — Class A regional", pay
    0.62 to 0.70 per mile, Home weekly, Dry van, Lanes, Yard or town: type "Joliet, IL" and pick **Joliet, IL, United
    States**, radius 50, a reason → **Save opening**.
    *Should see, walked 11/06:* "Opening saved", and a row reading **Open · 1 · Staging Test — Fleet Manager · 11/06/2026
    12:42 PM**. Open it again and the button reads **Save as version 2**.

10. **[Manager] ✅ start / ⛔ (Q-AD46) after** Recruitment (sidebar) › **Applicants** › **Campaigns** tab → **New campaign** → choose an
    open **Opening**; the **Ad account** (Simulator) and **Brand kit** are chosen already when there is one of
    each → **Start campaign**.
    *Should see:* "Campaign started", and the campaign drawer opens on **Making the ads**, saying the agent is
    working and the page updates by itself. *Walked 11/06 (walk 3):* Recruitment group › Applicants › Campaigns tab ›
    New campaign is **4 clicks**. Opening offers "Staging walk — Class A regional", with the Simulator and "Staging walk
    kit" ready. **Start campaign** → "Campaign started", and the drawer opens. It read **Starting**, not "Making the
    ads", and still did after 15 minutes: the agent is braked on staging (Q-AD46). The brief it froze holds the
    opening's facts: 62¢ and 70¢ a mile, age 23, 2 years, home weekly, Joliet + 50 mi.
11. **[Manager] ⛔ (Q-AD46)** Wait for **Waiting for review** (minutes: the agent writes, draws and checks every ad).
    *Should see:* each ad with its pictures in every format and both languages (EN, ES), its words, and its
    **checks**: one row per format and language, each with **Words**, **Text on the picture** and **Picture**
    marked Passed, Failed or Not checked. A failed picture check shows the checker's sentence ("A logo on the
    cab door."); an ad that failed says why above its rows.
12. **[Manager] ⛔ (Q-AD46)** On each ready ad → **Approve** (or **Reject**, which needs a reason).
    *Should see:* the ad reads **Approved**.
13. **[Manager] ⛔ (Q-AD46)** In the drawer's footer → **Approve this campaign**, then **Create it paused** when it is offered.
    *Should see:* **Approved**, then **Creating on the platform**, then **Paused**.
14. **[Manager] ⛔ (Q-AD46)** Close the drawer, then from the home page: **Recruitment** › **Applicants** › **Campaigns** › the
    row. *Should see:* the paused campaign open in **four clicks** (E3's done-when): the Recruitment group, Applicants, the
    Campaigns tab, the row. *Walked 11/06:* three clicks reach the list; the fourth is owed until a campaign reaches
    Paused (Q-AD46).

## D. Launch, and the brake

15. **[Admin] ⛔ (Q-AD46)** Open the paused campaign → **Launch**: Daily budget $5, Lifetime cap $50 → **Approve and
    launch** → confirm your password.
    *Should see:* "Campaign launching", then **Launching**, then **Live**. The simulator spends nothing.
16. **[Manager] ⛔ (Q-AD46)** The same campaign as the fleet manager.
    *Should see:* no Launch form (Launch is an admin's).
17. **[Admin] Stage 2** A campaign on a **Meta** account (sandbox) → Approve and launch.
    *Should see, until every part has passed its sandbox run:* "Not launched. These parts of the ads agent have
    not passed a test run against the real platform yet:" with a list in plain words ("Making the pictures",
    "Putting the ads on the platform, on Meta (Facebook, Instagram)") and "Nothing was spent".
18. **[Manager] ✅** Ads control → **Kill switch** → type a reason → **Stop all ads**. (No password: stopping is
    always allowed.)
    *Should see:* "Ads stopped", **Kill switch — on** with your reason, and within about a minute the live
    campaign reads **Pausing**, then **Paused**. *Walked 11/06, with no campaign to pause:* no password asked; the
    card reads "Kill switch — on · Every campaign that was running is paused, and nothing can launch or raise its
    budget. Reason given: …", and the manager is offered no Clear. The Pausing → Paused half waits on Q-AD46.
19. **[Admin] ✅** **Clear the kill switch** → reason → confirm your password.
    *Should see, walked 11/06:* **Kill switch — off** after a reload. Nothing relaunches by itself; a paused campaign stays paused.

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
24. **[Admin] ✅** Settings › **Data & sync** › **Failed background jobs** (E5).
    *Should see, walked 11/06:* the card, listing any job that failed every try it was allowed. As the fleet
    manager, Data & sync is not reachable (admin-only, owner's ruling 11/06).

---

**Where the evidence is.** Each walked line's screenshots and network log are in the walking chat's scratchpad,
not this repo. The walks' findings are in `ads-progress/2026-11-06-1100-S-staging-walk.md` and
`ads-progress/2026-11-06-1110-S-staging-walk-2.md`.

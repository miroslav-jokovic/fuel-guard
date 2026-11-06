# Recruiting ads — on-call runbook

For the person on call in the office, not a developer. Each procedure is numbered steps: where to go, what
to press, and what you should see. Every step names, in *italics*, the file or route that does it, so an
engineer can check that the step is still true. (G-runbook, ADS-AGENT-BUILD-WORKFLOW.md Phase G; written
2026-11-06 against main `9850e18`.)

**Read this first.** Where a step needs a screen that does not exist yet, the runbook says so and points to
**Gaps** at the end, instead of describing a way around it.

**The campaign screen** is **Recruitment › Campaigns** (`/recruitment/campaigns`; *apps/web/src/pages/RecruitmentCampaignsPage.vue*).
Anyone who can see Recruitment sees it (`recruitment.campaigns`, *packages/shared/src/surfaceCatalogue.ts*). It lists the
carrier's newest 200 campaigns, newest first. The column **Where it is** gives each campaign's state, for example
*Live*, *Pausing* or *Paused*. Clicking a campaign opens its drawer: its ads, their checks, the moves a person may
make, and its last error. The list does **not** refresh by itself, so reload the page to see a change.

**Walking the whole agent on staging** (connect → limits → brand kit → campaign → review → launch → kill switch →
leads → reconcile) is the owner's checklist [`ADS-G-WALK.md`](ADS-G-WALK.md), not this runbook.

**Words used here**
- **Ads control**: *Settings › Ads control*, `/settings/recruiting/ads` (*apps/web/src/router/routes/settings.ts*).
- **The bell**: the notification bell at the top of every page. Each kind of ads alert goes to the people
  chosen for it in the *Alerts* section of Ads control. If nobody is chosen, or the chosen people have left,
  it goes to the carrier's admins (*apps/api/src/modules/ads/alerts/adsAlerts.ts*). The two lead alerts
  fall back to recruitment managers instead.
- **Fresh sign-in**: an admin is asked for their password again before acts that move money or hand over an
  account (*apps/api/src/middleware/requireFreshAuth.ts*).

---

## 1. Kill switch

**Use it when** spend looks wrong, an ad says something it should not, or you are told to stop all ads now.
It stops every ad of your carrier. It is safe to press: it only ever stops things.

### Press it
1. Open **Ads control**. Find the card **"Kill switch — off"** (*apps/web/src/features/ads/AdsKillSwitchCard.vue*).
2. Type a **Reason**. It is required: the next person reads it.
3. Press **Stop all ads**. Anyone who manages recruiting may press it, and there is no password prompt
   (*POST /api/ads/kill-switch*, gate `recruitment: manage*, apps/api/src/modules/ads/routes/guard.ts*).
4. You should see a toast **"Ads stopped"**. The card should read **"Kill switch — on"**, with your reason
   (*apps/api/src/modules/ads/guard/killSwitch.ts* saves a new settings version and one ledger row of kind `kill`).

### What stops, and when
- **At once:** no launch and no budget raise can happen. The database itself refuses them while the switch
  is on (*error AX021, supabase/migrations/0537_ads_foundation.sql*).
- **Within about a minute:** every campaign that is launching or live moves to *pausing*, and then to
  *paused* once Meta confirms. The orchestrator checks every minute (*apps/api/src/modules/ads/orchestrator/tick.ts,
  runner.ts* — "the kill switch's second half").
- **If a pause will not take** (Meta refuses, or the connection is dead), it is retried every minute. After
  three failures in a row the bell shows **"Ads that could not be paused"**, at most once an hour per
  campaign (*apps/api/src/modules/ads/alerts/pauseAlerts.ts*). That alert means an ad may still be spending.
  See §2 and §3.

### What keeps running (on purpose)
None of these read the kill switch, so they carry on:
- **Lead intake**: Meta's webhook and the hourly backfill. New leads keep arriving for recruiters
  (*apps/api/src/modules/ads/leads/leadgenWebhook.ts, backfillTick.ts*).
- **Monitor**: the hourly spend pull, the checks, and reconcile (*apps/api/src/modules/ads/monitor/insightsTick.ts, reconcileTick.ts*).
- **The daily brief** (*apps/api/src/modules/ads/workers/analyst/briefTick.ts*).
- **Building new ads, up to "paused"**: compose and create-paused spend nothing, so they continue; nothing
  launches (*runner.ts* acts on the kill switch only in `launching` and `live`).

### Check it worked
1. The card reads **"Kill switch — on"**.
2. Open **Recruitment › Campaigns** and reload it after a minute or two. In **Where it is**, every campaign
   that was *Live* or *Launching* should read **Paused**. **Pausing** means Meta has not confirmed yet; reload
   again (*runner.ts*: launching/live → pausing → paused).
3. A campaign still **Pausing** after a few minutes: open it. Its drawer shows why in its last error. The bell
   will also ring **"Ads that could not be paused"** after three failures in a row (§2 and §3 then apply).

### Clear it
1. Only an **admin** can clear it. Open **Ads control** and type a **Reason** (for example "Checked the
   account; spend is normal again").
2. Press **Clear the kill switch**. You are asked to sign in again. Do so (*POST /api/ads/kill-switch/clear*,
   `ads.spend` + fresh sign-in, *routes/guard.ts*).
3. You should see **"Kill switch cleared"**, and the card reads **"Kill switch — off"**.
4. **Clearing does not restart any ad.** Paused campaigns stay paused. Each one needs a new approval and
   Launch by an admin (*apps/api/src/modules/ads/guard/approvals.ts*: one approval is used once).

### For an engineer: every carrier at once
`ADS_ENABLED=false` on the API's Railway service puts the whole agent under the **brake**. Every carrier is
treated as killed, only pauses run, and the pauses still reach Meta (*apps/api/src/modules/ads/orchestrator/brake.ts;
docs/WORKER-DEPLOYMENT.md § Ads*). It is a deploy variable, not an office control.

---

## 2. The Meta connection stops working (expired or revoked token)

**How you find out.** We cannot read when a Meta token expires yet (**Q-AD24**,
*docs/plans/recruitment/ADS-AGENT-PLAN.md*): its expiry is stored as empty. A dead token shows up the next
time something uses it:
- the bell shows **"An ad account connection stopped working"** (category *Ad account connection expiring*),
  once a day per connection, whichever job meets the dead token first: a **pause**, a **create-paused**, the
  hourly **spend pull**, the hourly **lead backfill**, or **reconcile**. Its text names the job, for example
  "Bringing in new leads from Meta failed…" (*apps/api/src/modules/ads/alerts/connectionAlerts.ts*; since
  2026-11-06, *monitor/insightsPull.ts, leads/backfill.ts, monitor/reconcile.ts*). A second run on the same day
  rings nothing new, and the job still records its failure;
- the connection on Ads control turns **failing** (*apps/api/src/modules/ads/connections/connections.ts*, `markConnectionFailing`);
- or an admin presses **Test** and the report fails at its first check, **token**.

There is still no warning **before** a token expires (**Q-AD24**): the first bell comes on the first failure.

### Reconnect
1. An **admin** makes a new system-user token in Meta Business Settings, with all six permissions the test
   asks for (*apps/api/src/modules/ads/platforms/meta/connectionTest.ts*, `META_SCOPES`).
2. Open **Ads control › Ad accounts** and press **Connect Meta account** (*apps/web/src/features/ads/AdsConnectionsCard.vue*,
   *AdsMetaConnectForm.vue*).
3. Paste the token. Enter the same **Ad account id** and **Page id** as before, and press **Test and connect**.
   You are asked to sign in again (*POST /api/ads/connections/meta*, `ads.connection` + fresh sign-in).
4. You should see the connection report, one line per check: token, permissions, ad account, currency,
   spending limit, page, leadgen. A green row reads **connected**.
   - **"Meta does not accept this token. Nothing was saved."** The token is wrong. Make a new one.
   - Saved as **failing**: one check failed, and its line says what to fix in Meta. Fix it, then press **Test**.
     The token is kept, so you need not paste it again.
5. A new token for the **same** account and Page is always accepted, even while ads run. That is the fix
   for a dead token. Moving the slot to a **different** account is refused while a campaign on it may be
   delivering (*connections.ts*, "the reconnect rule").

### Test without reconnecting
- **Ads control › Ad accounts › Test** re-runs the same checks on the stored token. It is admin-only, with no
  password prompt (*POST /api/ads/connections/:id/test*).

### What happens to running ads meanwhile
- **They keep running at Meta.** A dead token does not stop Meta delivering. It stops *us* reaching Meta:
  our pause, the kill switch's pause and our spend checks cannot act until the connection works again.
- **Meta's own Automated Rules still act.** Every time limits are saved, we write them into Meta as
  Automated Rules. Meta checks them every 30 minutes and pauses an ad set itself, even while we cannot reach it
  (*packages/shared/src/ads/adsRulesSpec.ts; apps/api/src/modules/ads/settings/rulesSyncJob.ts*).
- **Leads are not lost.** The hourly backfill reads the last 48 hours, or back to its last good run. Once
  the connection works, missed leads come in by themselves (*docs/WORKER-DEPLOYMENT.md § Ads*, `ads-leads-backfill`).
- **Do not disconnect** to "stop" ads. A disconnect is refused while a campaign may be delivering,
  because pausing needs the connection (*connections.ts*, `disconnect`).

---

## 3. Meta is down, or slow ("too many requests")

### What the system does by itself
- **Throttled (429):** we obey the wait time Meta sends, and send nothing to that ad account until it
  passes. Hammering a throttled account makes Meta's block longer (*apps/api/src/modules/ads/platforms/meta/graphClient.ts*).
- **Meta errors or timeouts:** a read is retried twice (after 1 s and 4 s). A create is **never** re-sent
  blindly, because it may have happened. The next step reads what exists and carries on without making a
  second campaign (*graphClient.ts*, "retries"; *platforms/meta/publisher.ts*).
- **Pauses** are retried every minute until they take (*runner.ts*, `pauseStep`).
- **The hourly jobs** fail and run again next hour. Spend and leads for the missed hours are re-read, so the
  numbers fill in once Meta answers (*monitor/insightsPull.ts* re-reads the last days; the backfill, §2).
- **Meta's Automated Rules** keep enforcing your limits at Meta while we cannot reach it (§2).

### What the bell shows
- **"Ads that could not be paused"**, only if a pause fails three minutes in a row (§1).
- **"An ad account connection stopped working"** if Meta refuses the token, from whichever job met it (§2).
- Nothing for a failed spend pull or backfill for any other reason, such as Meta being down. Those are on
  the **Failed background jobs** card instead (below).

### Where failed jobs are listed
1. Open **Settings › Data & sync** (`/settings/data`). It is **admin-only by rule** (owner, 2026-11-06): it starts
   off for every role but admin (*apps/web/src/pages/DataSyncPage.vue*; `admin.settings.data`, `startsOnFor: []`, in
   *packages/shared/src/surfaceCatalogue.ts*). **The rule for on-call:** an admin turns it on in **Settings ›
   Permissions** for the role of whoever is on call for ads, before the first launch.
2. Scroll to the card **Failed background jobs** (*apps/web/src/features/jobs/FailedJobsCard.vue*, reading
   *GET /api/jobs/failed*, *apps/api/src/modules/org/routes/jobs.ts*). It lists the newest 50 jobs that failed
   every try, newest first.
3. Each row says, in plain words, **what failed** ("Reading ad spend from Meta", "Bringing in new leads from
   Meta", "Checking the ad account against our records"...), its area (**Recruiting ads**), the **ad account**
   or **campaign** it was for, **when**, **how many tries**, and **what to do**, with the system's own error
   text under it for an engineer. The words come from one catalogue (*packages/shared/src/jobKindCatalogue.ts*).
4. **"No background job has failed."** means nothing is waiting on you. **"Could not load the failed jobs."**
   with **Retry** means the list itself could not be read. It does not mean nothing failed.
5. A Meta outage shows as a run of failed ads rows that stops once Meta answers again. The jobs run again by
   themselves (above), so act only on what the row's advice says, or when the same row keeps coming back for a day.

### When to act
1. If Meta is down and **nothing is being paused**, wait. Everything catches up on its own.
2. If the bell shows **"Ads that could not be paused"**, an ad we decided to stop may still be spending:
   - if the reason is the connection (§2), reconnect;
   - if Meta itself is down, nothing of ours can reach it. Meta's Automated Rules are still enforcing the
     limits. An admin who can reach **Meta Ads Manager** may pause the ad there. Our reconcile will then
     report it as changed outside Silvicom (§6), which is expected.

---

## 4. An ad refused by Meta, or failing our own checks

### Our checks (before anything reaches Meta)
Every creative passes three checks before review: the claim check (no promise the opening does not make),
the length and safe-zone checks, and the picture check. A creative that fails is **check failed**, with its
reasons (*apps/api/src/modules/ads/compose/composeCampaign.ts*; states in *packages/shared/src/ads/contracts.ts*).
- If at least one creative passed, the campaign goes to review, and the failed ones are shown with their
  reasons.
- If none passed, the campaign stops as **compose failed**, with the reasons joined in its error.
- A person then presses **Regenerate**, which makes new creatives for the failed ones. The old ones are
  kept as a record (*POST /api/ads/campaigns/:id/moves* with `regenerate`, *routes/campaigns.ts*). Approving and
  rejecting are per creative (*POST /api/ads/campaigns/:id/creatives/:creativeId/decision*).
- **Where:** open the campaign on **Recruitment › Campaigns**. The drawer shows each ad with its checks:
  **Approve** or **Reject** an ad (a reason is required to reject), **Make new ads** to regenerate, and
  **Approve campaign** once at least one ad is approved (*apps/web/src/features/ads/AdsCampaignDrawer.vue,
  AdsCreativeReview.vue, adsCampaignFlow.ts*).

### Refused by Meta (after it is created)
Every hour, reconcile reads Meta's review verdict on each ad of every campaign that is launching or live
(*apps/api/src/modules/ads/monitor/adReview.ts*, since 2026-11-06). It reads only; it never changes anything at Meta.
1. The bell shows **"Ads rejected by the platform"**, with one of two titles:
   - **"Meta turned down an ad"** (critical): Meta will not show it (`DISAPPROVED`);
   - **"Meta found a problem with an ad"** (warning): Meta shows it with a problem (`WITH_ISSUES`).
   The text quotes Meta's reason when Meta gives one.
2. It rings **once** per ad and verdict. The same verdict the next hour rings nothing. If the ad comes back
   and Meta turns it down again with the other verdict, that is a new bell.
3. **What to do:** read Meta's reason. If our words or picture caused it, regenerate the ad (§4 above: the campaign's
   drawer, **Make new ads**). If you think Meta is wrong, ask Meta to review it again in Ads Manager. The rest of the
   campaign keeps running: another ad of the same campaign can still deliver.
4. The verdict is also on the ad's record as a ledger row of kind `external_change`, so an engineer can see when
   Meta decided.

---

## 5. Rolling back a release while ads are live

Production moves back only through **`release.yml` in rollback mode**: Actions › *release* › *Run workflow*,
mode **rollback**, the **tag** to return to (for example `v2026.10.06`) and a **reason**
(*.github/workflows/release.yml*, D-REL9). It never reverses a database migration. Never move the
`production` branch by hand (root `CLAUDE.md`).

### Ads first: stop them before the rollback
1. **Press the kill switch** (§1) for every carrier with ads, giving the rollback as the reason. An
   engineer can do all carriers at once with `ADS_ENABLED=false` (§1, "for an engineer").
2. Wait until every campaign is paused: on **Recruitment › Campaigns**, reload until no campaign reads *Live*,
   *Launching* or *Pausing* in **Where it is** (§1, "Check it worked"). Do not start the rollback while one
   still reads *Pausing*.
3. Run the rollback (above). Its summary email says whether it verified.
4. After it verifies, leave the kill switch **on** until the owner decides. The older release still
   honours it: the switch and the database refusal (AX021) date from the ads foundation (migration 0537).
   A release from before the ads module has no ads code at all. Clearing it relaunches nothing (§1).

---

## 6. Reconcile reports "Ads changed outside Silvicom"

**What it is.** Once an hour, reconcile compares what Meta has with what we recorded: each campaign's status,
daily budget and spending cap, any overrun of a cap, and campaigns on the account that are not ours. Each
difference is recorded **once**, as a ledger row of kind `external_change`, and rings the bell
**"Ads changed outside Silvicom"** (*apps/api/src/modules/ads/monitor/reconcile.ts*;
*packages/shared/src/ads/adsReconcile.ts*). A cap overrun rings **"Ad spend over a limit"** instead.

**We never copy Meta's change into ours**, and never undo it. A person reads the alert and decides
(*reconcile.ts*, "never adopted").

### What to do
1. Read the alert. It names the field, our value and Meta's.
2. **Someone changed one of our campaigns in Ads Manager** (status, budget or cap): ask who and why. If
   Meta's value is looser than ours (an ad turned back **on**, or a higher cap), it is marked **critical**:
   that spend was not approved here. Put it back in Ads Manager, or press the kill switch (§1).
3. **A campaign that is not ours** (its name does not follow our naming) is on the account. If it is
   **active**, it is critical, because it spends from the same account. Per the owner's ruling
   (**Q-AD33**, 2026-11-04) it stays one true alert per campaign. There is no "this one is mine" button
   yet (**Gap 5**), so the owner decides in Ads Manager.
4. **A campaign of ours missing at Meta** (deleted there): reported once. The jobs stop failing over it once
   it is on record (*apps/api/src/modules/ads/monitor/recordedGone.ts*, Q-AD35).
5. The same difference is not alerted twice. A new value on the same field is a new alert.

---

## 7. Certifying a worker after a sandbox run (opens Launch)

A real-platform Launch is refused until every worker the campaign uses is at **L4**, and L4 comes **only**
from a recorded passing sandbox run (*apps/api/src/modules/ads/campaigns/launchCertification.ts*;
ADS-AGENT-BUILD-WORKFLOW §4R). This one is for an engineer, by pull request.

0. **Before the first sandbox run (Stage 2), the owner adds the sandbox ad account's id** to staging's deploy
   setting `META_SANDBOX_AD_ACCOUNT_IDS` (AWS Parameter Store, `/silvicom/staging/api`), then staging is
   redeployed. Without it, staging refuses every Meta account, the sandbox included (§8, D-AD8). The sandbox
   account must have no payment method in Meta, or staging refuses it too.
1. **On a laptop, on main, with a clean tree:** `git fetch && git switch --detach origin/main`. The command
   refuses a dirty tree or a commit that is not on main, because the record carries the commit that ran.
2. **Put the sandbox values in `apps/api/.env`** (never in chat, never committed). The command refuses and
   lists every missing name, per worker, before it runs anything:
   - Publisher, Security, Orchestrator and Monitor: `META_SANDBOX_TOKEN`, `META_SANDBOX_PAGE_TOKEN`, `META_SANDBOX_AD_ACCOUNT_ID`,
     `META_SANDBOX_PAGE_ID`, and `META_SANDBOX_AD_ACCOUNT_IDS` (the same allowlist as step 0. D-AD8's own check,
     *guard/sandboxOnly.ts*, runs on the account before anything else, and refuses one that can pay).
   - Outcome feed: also `META_SANDBOX_DATASET_ID`, `META_SANDBOX_TEST_EVENT_CODE` (Events Manager → the
     dataset → Test events) and `META_SANDBOX_LEAD_ID` (a lead the Lead Ads Testing Tool made).
   - Lead intake: also `META_SANDBOX_LEAD_ID`. Make the lead first: developers.facebook.com → Tools → Lead Ads
     Testing Tool → the sandbox Page and any form on it → Create lead, and copy its id. Its form is read from Meta.
   - Nothing these runs make is ever made active. The Orchestrator's run creates one paused campaign, then deletes
     it and reads it back as deleted. The Monitor's run publishes one paused campaign the same way. Meta's sandbox
     cannot turn an ad down or kill a token on request, so the suites play both on the wire, in front of Meta.
3. **Rehearse first, on the fake:** `pnpm ads:certify all --target fake`. Same suites, nothing real is
   touched, and the draft it writes can never be committed: the gate refuses an L4 whose target is not the sandbox.
4. **Certify:** `pnpm ads:certify all --target sandbox`, or name one worker, e.g.
   `pnpm ads:certify "Outcome feed" --target sandbox`. Each worker prints one line:
   - **PASS:** its suites passed on the sandbox, and every *OUR reading* re-recorded there matches
     `platforms/meta/contract/readings.recorded.json`.
   - **FAIL:** each failed test, difference or leak is listed. A reading difference names the field and
     the fake to correct (for example `image-upload "hash is the md5 of the bytes": committed true, target
     answered false — correct platforms/simulator/fakeMetaAds.ts`). The fix is a PR that corrects the fake
     and re-records the file from it. Never edit a value to match. Merge it, then go back to step 1.
   - **NOT BUILT:** the worker's L4 run does not exist yet, and the line says what is missing. As of
     11/06 (stage2-kit-2c) that is Budget guard (Track G's suite) and the Claude and Higgsfield workers
     (stage2-kit 2b). The Checker also waits for the owner's threshold (Q-AD45). Nothing is certified for it.
5. **Each PASS is in `ads-certifications.draft.json`** at the repo root (gitignored): `{ worker, platform
   (Publisher only), level: "L4", target: "sandbox", run_date, sha, result: "pass", evidence }`. The
   draft has already passed the gate's own shape check. `evidence` is the run's
   `.ads-certify/<time>-<sha>/summary.json`. Its logs sit beside it and stay on the laptop.
   Copy the records into `scripts/ads-certifications.json`. A failed run may be recorded by hand with
   `"result": "fail"`. It is kept, and it opens nothing.
6. Run `pnpm gen:ads-readiness`. It rewrites `packages/shared/src/ads/launchReadiness.generated.ts`. Never
   edit that file by hand: `lint:ads-readiness` fails on any byte of difference (*scripts/check-ads-readiness.mjs*).
7. Run `pnpm ads:readiness`. The worker should now show **L4**.
8. Open the PR with `summary.json` pasted in the body (it holds verdicts and readings, never a token:
   Security's scrape checked the run's output). CI checks the record (known worker, full sha, L4 = sandbox,
   platform named for the Publisher). Merge when green.
9. **What opens Launch:** once **every** worker listed for Meta still ads in `CAMPAIGN_WORKERS`
   (*scripts/ads-readiness.registry.mjs*) is L4, a Meta Launch is allowed on the next **release** that
   carries the record. Until then, Launch answers which ones are missing, and the campaign shows the same
   sentence (409 `not_certified`).
   - Staging's **simulator** launches without any of this, and production refuses the simulator.

---

## 8. Who to call, and where the logs are

- **First:** the owner. For anything about spend, a refused ad or a connection, the owner decides.
- **For a technical fault** (a pause stuck for over an hour, a job on Settings › Data & sync's **Failed
  background jobs** card failing all day, a rollback): the
  developer on call. Give them the bell's text and the time.
- **Logs** (engineers, Railway access needed; no secret goes in a ticket or a chat). Ads lines start with a
  tag:
  `railway logs --service "@fleetguard/api" --environment production | grep -E "\[(ads-|meta-webhook|intake-alerts)"`
  Tags: `[ads-orchestrator]`, `[ads-insights]`, `[ads-reconcile]`, `[ads-leads-backfill]`,
  `[ads-daily-brief]`, `[ads-alerts]`, `[meta-webhook]`, `[intake-alerts]`. The ads jobs run on the
  scheduler lane's holder. Which service holds it is in `docs/DEPLOYMENT.md` § "Exactly one process runs each
  scheduler lane" and in `/api/version` → `schedulers`.
- **Who can log in where** (no password is written here; they are in the owner's Keychain):
  - **Production** (`https://360.silvicominc.com`): real office logins only. No test account exists there.
  - **Staging** (`https://staging-api.360.silvicominc.com`): three test members in staging's one org, for checks by
    role. `miki+staging-admin@silvicominc.com` is an **admin**: it sees Ads control, Data & sync, and Launch.
    `miki+staging-fleet-manager@silvicominc.com` is a **fleet manager**: it sees Recruitment › Campaigns, but
    not Data & sync (admin-only, §3). `miki+staging-dispatcher@silvicominc.com` is a **dispatcher**.
    **Staging spends nothing (D-AD8, the rule since 2026-11-06).** On staging, and on any host that is not production,
    a Meta ad account is used only if **both** hold: its id is on that host's list `META_SANDBOX_AD_ACCOUNT_IDS` (its
    deploy settings; empty = no Meta account at all), **and** Meta says the account has **no payment method**. Connect
    and Launch both ask (*apps/api/src/modules/ads/guard/sandboxOnly.ts*). Anything else is refused with **"Staging may
    only use a Meta sandbox ad account."** and the reason: not on the list, Meta says it can be billed, or Meta could
    not be asked. Production is not affected.
- **"The server can't confirm passwords right now. Tell your administrator."** This is what "Confirm it's you" says
  when the server cannot check any password. Saving Ads control, Connect, Launch and clearing the kill switch all
  ask for it, so none of them can be done until it is fixed. It is a missing server setting, not a wrong password;
  retyping does not help (Q-AD41, staging ran this way for two weeks until 2026-11-06). For the engineer: open
  `/api/version` on that host. `stepUp` is `"ready"`, or `"missing:"` and the setting names (only names, never
  values). Set those settings in AWS Parameter Store `/silvicom/<staging|production>/api` and redeploy. The deploy
  log's boot line starts `[step-up] ⚠`. `pnpm verify:live staging` and deploy-verify fail staging on it. On
  production they only warn, because a rollback cannot set a setting.
- **What logs never hold:** tokens, keys or secrets. A test fails the build if one appears
  (*apps/api/src/modules/ads/security/adsLogScrape.test.ts*). If you ever see one, tell the owner: the token
  must be replaced (§2).

---

## Gaps (steps on-call needs that have no code behind them)

Each one is reported, not worked around. The cost is a rough size of the honest fix.

1. ~~**No screen lists campaigns or their states.**~~ Closed 2026-11-06 (E3, #2071/#2095): **Recruitment ›
   Campaigns** (see "Read this first"); §1, §4 and §5 now use it.
2. ~~**No page shows failed jobs.**~~ Closed 2026-11-06 (E5): the **Failed background jobs** card on
   Settings › Data & sync (§3, "Where failed jobs are listed").
3. ~~**A Meta-rejected ad is not detected.**~~ Closed 2026-11-06 (monitor-alerts): reconcile reads each delivering
   ad's verdict (§4).
4. ~~**A dead token rings the bell only when a pause or a create meets it.**~~ Closed 2026-11-06 (monitor-alerts):
   the spend pull, the backfill and reconcile ring the same alert (§2). The advance warning before expiry is
   still **Q-AD24** (b), in Stage 2 once our app secret is sealed.
5. **No "this campaign is ours" mark for reconcile** (**Q-AD33** ruling: it "needs a new record"; nothing is
   built). **Fix:** a record of campaigns the owner runs by hand, which lowers their alert and keeps them
   counted. A migration plus about half a day. It is needed only once the owner actually runs one.

# Recruiting ads — on-call runbook

For the person on call in the office, not a developer. Each procedure is numbered steps: where to go, what
to press, and what you should see. Every step names, in *italics*, the file or route that does it, so an
engineer can check that the step is still true. (G-runbook, ADS-AGENT-BUILD-WORKFLOW.md Phase G; written
2026-11-06 against main `9850e18`.)

**Read this first.** Some things on-call needs have no screen yet. Where a step needs one, the runbook says
so and points to **Gaps** at the end, instead of describing a way around it. The biggest gap: no screen
lists campaigns or their states yet (Gap 1), so "is it paused?" cannot be answered on a page today.

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
- The card reads **"Kill switch — on"**. That is all a screen can show today. Seeing each campaign reach
  *paused* needs the campaign screen (**Gap 1**). Until then, watch the bell for **"Ads that could not be paused"**:
  if it stays quiet for ten minutes, every pause took.

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
1. Open **Settings › Data & sync** (`/settings/data`). **Admins** see it. Other roles see it only if the carrier
   turns it on for them in **Settings › Permissions**, because it starts off for every role but admin
   (*apps/web/src/pages/DataSyncPage.vue*; `admin.settings.data`, `startsOnFor: []`, in
   *packages/shared/src/surfaceCatalogue.ts*). Whoever is on call for ads needs it, so an admin should
   switch it on for that person's role before the first launch.
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
- **The screen for this is the campaign review screen (E3), not built yet** (**Gap 1**).

### Refused by Meta (after it is created)
Every hour, reconcile reads Meta's review verdict on each ad of every campaign that is launching or live
(*apps/api/src/modules/ads/monitor/adReview.ts*, since 2026-11-06). It reads only; it never changes anything at Meta.
1. The bell shows **"Ads rejected by the platform"**, with one of two titles:
   - **"Meta turned down an ad"** (critical): Meta will not show it (`DISAPPROVED`);
   - **"Meta found a problem with an ad"** (warning): Meta shows it with a problem (`WITH_ISSUES`).
   The text quotes Meta's reason when Meta gives one.
2. It rings **once** per ad and verdict. The same verdict the next hour rings nothing. If the ad comes back
   and Meta turns it down again with the other verdict, that is a new bell.
3. **What to do:** read Meta's reason. If our words or picture caused it, regenerate the ad (§4 above; the
   screen is **Gap 1**). If you think Meta is wrong, ask Meta to review it again in Ads Manager. The rest of the
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
2. Wait until every campaign is paused. **This cannot be checked on a screen today** (**Gap 1**). The
   closest signal is a quiet bell: no "Ads that could not be paused" for ten minutes.
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

1. Run the worker's contract suite against Meta's sandbox with `ADS_TARGET=sandbox` (§4R L4). Note the
   commit it ran on (the full 40-character sha), the date, and the CI run or PR link.
2. Add one record per worker to `scripts/ads-certifications.json`:
   `{ "worker": "<name exactly as in scripts/ads-readiness.registry.mjs>", "platform": "meta" (Publisher only),
   "level": "L4", "target": "sandbox", "run_date": "YYYY-MM-DD", "sha": "<40-hex>", "result": "pass",
   "evidence": "<link>" }`. Record a failed run too, with `"result": "fail"`. It is kept, and it opens nothing.
3. Run `pnpm gen:ads-readiness`. It rewrites `packages/shared/src/ads/launchReadiness.generated.ts`. Never
   edit that file by hand: `lint:ads-readiness` fails on any byte of difference (*scripts/check-ads-readiness.mjs*).
4. Run `pnpm ads:readiness`. The worker should now show **L4**.
5. Open the PR with the run's link in the body. CI checks the record (known worker, full sha, L4 = sandbox,
   platform named for the Publisher). Merge when green.
6. **What opens Launch:** once **all ten** workers listed for Meta still ads in `CAMPAIGN_WORKERS`
   (*scripts/ads-readiness.registry.mjs*) are L4, a Meta Launch is allowed on the next **release** that
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
- **What logs never hold:** tokens, keys or secrets. A test fails the build if one appears
  (*apps/api/src/modules/ads/security/adsLogScrape.test.ts*). If you ever see one, tell the owner: the token
  must be replaced (§2).

---

## Gaps (steps on-call needs that have no code behind them)

Each one is reported, not worked around. The cost is a rough size of the honest fix.

1. **No screen lists campaigns or their states.** On-call cannot see "paused" after the kill switch (§1,
   §5), and cannot review, regenerate or approve creatives (§4). The API exists
   (*GET /api/ads/campaigns*, *…/:campaignId*). **Fix:** E3, the campaign flow and review screen, already
   in Track S's queue. About 2 days.
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

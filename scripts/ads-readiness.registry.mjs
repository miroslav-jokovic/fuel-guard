/**
 * What each ads worker must show at each readiness level (ADS-AGENT-BUILD-WORKFLOW.md §4R), and the tests
 * that show it. Read by `scripts/check-ads-readiness.mjs` — the gate (`lint:ads-readiness`) and the
 * scorecard (`pnpm ads:readiness`). That file's header says how a level is reached.
 *
 * One entry per worker in §4R's "What each worker must survive (L2) and score (L3)" table, by the name in
 * bold there; the gate refuses a worker the table lacks or a table row this list lacks. Each level lists
 * its `needs`, written from that table and the levels table above it, and each need is EITHER pinned to
 * tests (`tests`: file + titles, and `scenarios`: golden scenario files) OR an open `gap` saying what is
 * missing and which step brings it. A gap is not a failure — it is the scorecard telling the truth. A
 * broken pin IS a failure: a pinned test renamed, skipped, focused, todo, failing-by-design, or a file
 * gone. Retiring a pin, or turning a gap into one, is an edit here that review sees.
 *
 * A title ending in "…" matches by prefix (a templated title such as `killed at each write to ${table}…`).
 */

const STAGE2 = "needs vendor credentials: the same contract suite re-run with ADS_TARGET=sandbox (Stage 2, from Mon 11/09)";
const CANARY = "one real campaign, small cap, created paused and launched by the owner; 72 h with zero unexplained reconcile rows";

const GOLDEN = "apps/api/src/modules/ads/orchestrator/golden.test.ts";
const RUNNER = "apps/api/src/modules/ads/orchestrator/runner.test.ts";
const TICK = "apps/api/src/modules/ads/orchestrator/tick.test.ts";
const TRANSITIONS = "apps/api/src/modules/ads/orchestrator/transitions.test.ts";
const MACHINE = "packages/shared/src/ads/campaignMachine.test.ts";
const GUARD = "apps/api/src/modules/ads/guard/budgetGuard.test.ts";
const BOUNDARY = "apps/api/src/modules/ads/guard/budgetGuard.boundary.test.ts";
const POLICY = "packages/shared/src/ads/adsPolicy.test.ts";
const REPORT = "packages/shared/src/ads/adsReport.test.ts";
const ROUTES = "apps/api/src/modules/ads/routes/guard.test.ts";
const PUBLISHER = "apps/api/src/modules/ads/platforms/meta/publisher.test.ts";
const PUBLISHER_CONTRACT = "apps/api/src/modules/ads/platforms/meta/publisher.contract.test.ts";
const META_ADAPTER = "apps/api/src/modules/ads/platforms/meta/metaAdapter.test.ts";
const META_PATH = "apps/api/src/modules/ads/orchestrator/metaPath.test.ts";
const RULES_SYNC = "apps/api/src/modules/ads/platforms/meta/rulesSync.test.ts";
const COPYWRITER = "apps/api/src/modules/ads/workers/copywriter/copywriter.test.ts";
const ART_DIRECTOR = "apps/api/src/modules/ads/workers/artDirector/artDirector.test.ts";
const RENDER = "apps/api/src/modules/ads/creative/higgsfield/render.test.ts";
const CHECKER = "apps/api/src/modules/ads/workers/checker/checker.test.ts";
const MONITOR_GOLDEN = "apps/api/src/modules/ads/monitor/golden.test.ts";
const LEAD_GOLDEN = "apps/api/src/modules/ads/leads/golden.test.ts";
const ANALYST = "apps/api/src/modules/ads/workers/analyst/analyst.test.ts";
const BRIEF = "packages/shared/src/ads/analystBrief.test.ts";
const DAILY_BRIEF = "apps/api/src/modules/ads/workers/analyst/dailyBrief.test.ts";
const BRIEF_FOLD = "apps/api/src/modules/ads/workers/analyst/briefFold.test.ts";
const SEC_LOGS = "apps/api/src/modules/ads/security/adsLogScrape.test.ts";
const SEC_SWEEP = "apps/api/src/modules/ads/security/adsRouteSweep.test.ts";
const SEC_GATES = "apps/api/src/modules/ads/security/adsRouteGates.test.ts";

export const SCENARIO_DIR = "packages/ads-golden/scenarios";

/** @type {Array<{ worker: string, levels: Record<"L1"|"L2"|"L3"|"L4"|"L5", Array<{ need: string, gap?: string, tests?: Array<{ file: string, titles: string[] }>, scenarios?: string[] }>> }>} */
export const READINESS = [
  {
    worker: "Orchestrator",
    levels: {
      L1: [
        {
          need: "the campaign machine is a well-formed table, and delivery starts only by an approver's launch",
          tests: [{ file: MACHINE, titles: [
            "every row names known states and events, and no (state, event) pair appears twice",
            "delivery starts only by an approver's launch from paused — the one move marked as spending",
            "nothing an agent or a person does moves a campaign into launching or live except through launch",
          ] }],
        },
        {
          need: "one writer of a campaign's state, which records every move and refusal",
          tests: [{ file: TRANSITIONS, titles: [
            "every (state, event, actor): a legal move advances with one succeeded row, an illegal one changes nothing and is recorded refused",
            "a person's move is recorded with their id; the machine's 'approver' is the ledger's person",
          ] }],
        },
        {
          need: "the runner takes one step per job; the tick only enqueues, keyed per campaign and state, in one lane",
          tests: [
            { file: RUNNER, titles: [
              "walks draft → composing → review, approved → creating → paused, launching → live, each with one transition row",
              "a worker not built yet leaves the campaign where it is, writing nothing",
            ] },
            { file: TICK, titles: [
              "an ads_step with the campaign and state in its payload, and dedup_key = campaign + state, never the (org, kind) slot",
              "is registered once, in the general lane (workflow §1.2-7)",
              // 2026-11-03 audit (M4): ADS_ENABLED off is a brake, not an off switch — the tick runs and
              // only pauses. The old pin asserted the opposite, which left live ads unpausable.
              "ticks with ADS_ENABLED off too, because the off flag is a brake, not the end of our pauses",
              "under the brake every org is read as killed and only the pause path is queued; the settings are not even read",
            ] },
          ],
        },
      ],
      L2: [
        {
          need: "process killed after every side effect, then restarted",
          tests: [
            { file: RUNNER, titles: [
              "compose done, crash before the move: the retry hands the worker the SAME key and moves once",
              "launch sent, crash before the move: the retry reads the guard's row and never launches twice",
              "a launch whose outcome is unknown (started, never completed) is paused, not marked stopped, and not re-sent",
              "pause sent, crash before the move: the retry reads the pause row and moves once",
            ] },
            { file: TRANSITIONS, titles: [
              "a crash between the move and its completion is settled from the campaign's own stamp at the next move",
              "a crash before the move: the row it left is reused by the retry, which moves once",
            ] },
            { file: GOLDEN, titles: ["killed at each write to …"] },
          ],
          scenarios: ["crash-after-the-create.yaml", "crash-after-the-launch-was-sent.yaml", "crash-loses-the-launch-outcome.yaml", "crash-after-the-pause-was-sent.yaml"],
        },
        {
          need: "the same job delivered twice",
          tests: [
            { file: TRANSITIONS, titles: [
              "a delivered-twice move finds its finished row and writes nothing more",
              "a stale read of an earlier stint of the SAME state loses: the stamp, not the state, is what the move compares",
            ] },
            { file: TICK, titles: ["a second tick while the first step is in flight is the queue saying 'already on it'"] },
          ],
          scenarios: ["delivered-twice.yaml", "launch-delivered-twice.yaml"],
        },
        {
          need: "two campaigns in one org at once (M4)",
          tests: [
            { file: RUNNER, titles: ["two campaigns in one org advance concurrently, neither waiting on the other"] },
            { file: TICK, titles: ["two campaigns of one org each get their own slot, keyed by campaign and state"] },
          ],
          scenarios: ["two-campaigns-one-org.yaml", "second-launch-over-the-month-cap.yaml"],
        },
        {
          need: "kill switch pressed in every state",
          tests: [{ file: RUNNER, titles: [
            "never launches; launching and live go to pausing; pausing pauses; every other state is unmoved by it",
            "a live campaign is paused within two ticks of the switch, with no platform worker needed for the first",
          ] }],
          scenarios: ["kill-switch-before-the-launch-step.yaml", "kill-switch-during-the-launch-call.yaml", "pause-refused-then-retried.yaml"],
        },
        {
          need: "approval missing",
          tests: [{ file: RUNNER, titles: ["a launch the guard refuses (no approval) goes back to paused with every refusal named, and nothing is sent"] }],
          scenarios: ["approval-missing.yaml"],
        },
        { need: "budget exhausted mid-step", scenarios: ["budget-exhausted-mid-step.yaml"] },
        { need: "settings changed mid-run", scenarios: ["settings-changed-mid-run.yaml"] },
      ],
      L3: [
        {
          need: "every (state, event) pair enumerated: legal ones advance, illegal ones refuse",
          tests: [
            { file: MACHINE, titles: ["all ${CAMPAIGN_STATES.length * CAMPAIGN_EVENTS.length * ACTORS.length} triples…"] },
            { file: TRANSITIONS, titles: ["every (state, event, actor): a legal move advances with one succeeded row, an illegal one changes nothing and is recorded refused"] },
          ],
        },
        {
          need: "0 duplicate vendor creates across all crash points",
          tests: [{ file: GOLDEN, titles: ["killed at each write to …", "the clean run is what the scenario says, and writes to both tables"] }],
        },
        {
          need: "golden scenarios green, the checker not vacuous, every §4R fault covered",
          tests: [{ file: GOLDEN, titles: [
            "ads golden scenarios — every one, through the real orchestrator",
            "a wrong final state, a missing ledger line and a wrong vendor count each fail",
            "every required fault has at least one scenario",
          ] }],
          scenarios: ["happy-path-draft-to-live.yaml"],
        },
        {
          // stage2-kit-2c (2026-11-06): the L4 suite itself, green on FakeMeta every CI run, so the sandbox run
          // under `pnpm ads:certify` is this file unchanged.
          need: "the L4 suite on either target: created paused, half-made, resumed without a duplicate, read back, deleted and read back deleted",
          tests: [{ file: "apps/api/src/modules/ads/orchestrator/orchestrator.contract.test.ts", titles: [
            "a run on the target: created PAUSED, half-made after a lost answer, resumed by a person without a duplicate, every object read back as asked",
          ] }],
        },
      ],
      L4: [{ need: "the orchestrator over the real adapters' sandbox runs", gap: STAGE2 }],
      L5: [{ need: "canary", gap: CANARY }],
    },
  },
  {
    worker: "Budget guard",
    levels: {
      L1: [
        {
          need: "every fence refuses with a row and no call; a passing launch is started, called once, completed",
          tests: [{ file: GUARD, titles: [
            "writes started before the call, calls the platform once, completes succeeded",
            "every query and write names the org",
            "the kill switch blocks a launch",
            "unset caps refuse",
            "an unreadable account limit refuses",
            "no approval refuses",
            "an approval of a smaller amount does not cover a larger launch",
            "an approval already used by an act does not launch again",
            "a withdrawn approval does not launch",
            "above the second-approver line, one person — or the same person twice — is not enough",
          ] }],
        },
        {
          need: "the spend rules (pure) and who may perform each act",
          tests: [{ file: POLICY, titles: [
            "the unset settings refuse every launch",
            // 2026-11-03 audit M1: the fence reads the HEADROOM Meta's lifetime limit leaves, and refuses zero; retitled.
              "the room the platform's account limit leaves must be read, be more than nothing, and be no looser than our cap (fence 3)",
            "launch, raise and an area change belong to an approver alone — never the agent",
          ] }],
        },
      ],
      L2: [
        {
          need: "cap −1 / 0 / +1",
          tests: [
            { file: POLICY, titles: ["one cent under the cap is allowed and one cent over is refused (cap −1 / 0 / +1)"] },
            { file: GUARD, titles: ["a forecast exactly at the monthly cap launches; one cent over is refused"] },
          ],
        },
        {
          need: "concurrent launches racing the cap",
          tests: [{ file: "apps/api/src/modules/ads/guard/budgetGuard.race.test.ts", titles: [
            "two campaigns launched at once, each fitting alone, never both reach the platform",
            "the second launch, asked after the first is sent, is refused by the first's daily budget",
          ] }],
        },
        {
          need: "a raise just over the limit",
          tests: [
            { file: GUARD, titles: ["a raise past the raise limit is refused"] },
            { file: POLICY, titles: ["the smaller of the two bounds wins: 25 % of $40 is $10, under the $50 bound", "the dollar bound binds when the percentage would allow more"] },
          ],
        },
        {
          need: "clock at the month boundary (Central time) — the guard's month is monthContext(now)",
          tests: [{ file: REPORT, titles: [
            "the last evening of October in Chicago is still October, though it is November in UTC",
            "November starts at 05:00Z (CDT) and ends at 06:00Z (CST) — DST lands inside the month",
            "December rolls into January of the next year",
          ] }],
        },
        {
          need: "kill switch pressed while a call is in flight",
          tests: [{ file: GUARD, titles: ["the kill switch pressed between the guard's read and the write (AX021) is a refusal, not a call"] }],
        },
      ],
      L3: [
        {
          need: "100 % of spend calls pass through it: a test fails if any adapter spend method is reached outside guard/",
          tests: [{ file: BOUNDARY, titles: [
            "no file outside modules/ads/guard and modules/ads/platforms names PlatformSpend or calls its methods",
            "the scan reads the guard itself, so it is looking at real files",
          ] }],
        },
      ],
      L4: [{ need: "the guard over a sandbox account's real limit", gap: STAGE2 }],
      L5: [{ need: "canary", gap: CANARY }],
    },
  },
  {
    worker: "Publisher (per adapter)",
    // Certified per platform (G-launch-gate): a Meta sandbox run certifies the Meta adapter, not TikTok's.
    perPlatform: true,
    levels: {
      L1: [
        {
          need: "the Meta Graph client it calls (B1a): one version, the token never in a URL, a create never re-sent, a throttle obeyed",
          tests: [{ file: "apps/api/src/modules/ads/platforms/meta/graphClient.test.ts", titles: [
            "calls the one Graph version FakeMeta answers, which is the version production calls",
            "sends the token as a Bearer header, never in the URL or the body",
            "never carries the token in a failure, even when the message would",
            "a create that met a server error is NEVER re-sent, and says its outcome is unknown — it may have happened",
            "a create that timed out is not re-sent either; a read that timed out is retried",
            "a throttle is rate_limited with Meta's regain time, not retried, and later calls are refused without asking Meta",
            "files every code the error-handling page lists where the page says it belongs",
          ] }],
        },
        {
          need: "create paused (B2a): an EMPLOYMENT campaign and a lead ad set, read back; no age/gender/ZIP sent; Meta's limits refused before a call",
          tests: [{ file: PUBLISHER, titles: [
            "creates a paused EMPLOYMENT campaign in the US with the spend cap, then a paused lead ad set on the Page, each read back",
            "the ad set targets a pin and a radius and nothing else — no age, gender, ZIP or exclusion is ever sent",
            "names come from naming.ts, the same on every attempt; a simulator connection's objects read SIM",
            "refuses before calling Meta: …",
            "FakeMeta holds Meta's employment rules: age, gender or a radius under 15 miles is a hard 2909035",
          ] }],
        },
        {
          need: "the Instant Form (B2b): only the counsel fallback questions, made with the Page's token, our privacy page, read back",
          tests: [
            { file: "packages/shared/src/ads/metaLeadForm.test.ts", titles: [
              "a key outside the counsel fallback catalogue is refused, never passed through as free text",
              "no output of any catalogue subset carries a prohibited question type, and age is never asked",
              "Spanish asks the same questions with the same option keys, in Spanish",
            ] },
            { file: PUBLISHER, titles: [
              "makes the form on the Page with the Page's token: contact, then the catalogue's questions, our privacy page, shown only from the ad",
              "the system user's token cannot make a form — FakeMeta holds the Page-token rule",
            ] },
            { file: "apps/api/src/modules/ads/platforms/registry.test.ts", titles: [
              "opens the Page token under its own purpose; the system user's sealed token does not open as a Page token",
              "hands out the simulator's Page client only on a positively non-production host",
            ] },
          ],
        },
        {
          need: "launch / pause / raise / area through the guard (B3a): the campaign is the master switch, activated last; every answer read back",
          tests: [
            { file: META_ADAPTER, titles: [
              "pause sets the campaign alone to PAUSED and answers from Meta's read-back; pausing a paused campaign succeeds",
              "launch sets the approved amounts, then the ad and the ad set ACTIVE, and the campaign LAST, read back ACTIVE",
              "a launch with no ad is refused before any call: an active campaign with nothing to show would only look live",
              "raise sets the ad set's daily budget only; an area change keeps Meta's 15–50 mile window",
              // 2026-11-03 audit M1: headroom = lifetime spend_cap − lifetime amount_spent; retitled.
              "the account's room is Meta's lifetime spend_cap less its lifetime amount_spent; …",
            ] },
            { file: META_PATH, titles: [
              "an approved launch goes through the guard to Meta: amounts set, campaign ACTIVE last, the campaign live",
              "without an approval the guard refuses and Meta is never asked to activate anything",
            ] },
          ],
        },
        {
          need: "settings → Meta Automated Rules (B3b): only our ad sets, each threshold in cents, a diff that never duplicates, U2's refusal survived",
          tests: [
            { file: "packages/shared/src/ads/adsRulesSpec.test.ts", titles: [
              "each rule fires at its threshold in cents: …",
              "every rule pauses only OUR ad sets — by the naming taxonomy — on a schedule, over one time window",
              "'pause when filled' is never a Meta rule: it depends on our opening, so the monitor owns it",
            ] },
            { file: RULES_SYNC, titles: [
              "writes every rule the settings want on an empty account, recorded as one succeeded rules_sync row",
              "running it again changes nothing on Meta: every rule unchanged, no write sent",
              "a changed threshold rewrites its rule in place — the same rule, never a second",
              "a threshold turned off disables our rule, and a rule someone else made is never touched",
              "Meta refusing the spend rule (2703, U2) is recorded refused; the other rules still land and the sync is not a failure",
              "a revoked token fails the sync with one failed row and no write",
              "two rules carrying our name are refused as duplicate_rule and left as they are",
            ] },
          ],
        },
        {
          need: "the creative and the ad (B2c1): per approved creative and language, the feed image, an ad creative opening that language's form, the ad PAUSED",
          tests: [{ file: PUBLISHER, titles: [
            "each language's ad is PAUSED in the one ad set and shows the feed image, the platform slots' words and that language's form",
            "a creative with no 4:5 image runs its 1:1",
            "a Spanish ad gets a Spanish form with the same question keys",
            "the ledger names the creative on its creative and ad rows; the ad's name is a pure function of the rows",
            "FakeMeta holds the lead ad's rules: an image not on the account, a link other than fb.me, or another Page's form is refused",
          ] }],
        },
        {
          need: "`createPaused` wired (B2c2): the runner's `creating` step publishes only approved creatives, and intake finds a lead on every language's form",
          tests: [
            { file: "apps/api/src/modules/ads/orchestrator/createPath.test.ts", titles: [
              "creating publishes the approved creative as two paused ads and moves the campaign to paused holding every id launch needs",
              "then an approved launch turns on exactly the ads it made, and the campaign last",
              "a creative still waiting for a person is never published: no approved creative fails the step before Meta is asked anything",
            ] },
            { file: "apps/api/src/modules/ads/leads/leadFetch.test.ts", titles: ["a lead on the campaign's Spanish form is found as that campaign's (B2c2: a form per language)"] },
            { file: "apps/api/src/modules/ads/leads/backfill.test.ts", titles: ["reads every language's form of a campaign: the Spanish form's leads come in beside the English one's (B2c2)"] },
            { file: "apps/api/src/modules/ads/routes/metaWebhook.test.ts", titles: ["a lead on a campaign's Spanish form finds its carrier like an English one (B2c2: a form per language)"] },
          ],
        },
      ],
      L2: [
        {
          need: "429/5xx/timeout on each create step; half-created campaign resumed, never duplicated; token revoked → stops",
          tests: [{ file: PUBLISHER, titles: [
            "a create Meta applied but answered 5xx is found by its name and taken, never sent twice",
            "half-created (campaign yes, ad set no): the next attempt adopts the campaign and creates only the ad set",
            "a 429 on …",
            "%s on the campaign create is an unknown outcome: one create sent, and the next stint creates exactly one",
            "a revoked token stops the step at its first read: token_invalid, and no create is sent",
            "a crash between a create and its ledger row: the next delivery adopts the object and never creates a second",
            "the same step delivered twice at once creates each object once",
            "two objects carrying our name are refused, never a guess; one found active is refused, never adopted",
            "half-created (campaign and ad set yes, form no): the next attempt adopts both and makes one form",
            "a form create Meta applied but answered 5xx is found on the Page by name, never made twice",
            "a form with our name that asks other questions is refused, never adopted",
          ] }, { file: META_ADAPTER, titles: [
            "a 5xx on the pause is retried — it sets a value, so twice is once — and the campaign ends paused",
            "Meta answering success without applying it is caught by the read-back: pause_not_applied, launch_not_applied",
            "a launch that fails part way leaves the campaign PAUSED: the master switch is never reached",
            "a revoked token stops the pause as token_invalid, and a campaign with no Meta ids is refused without a call",
          ] }, { file: META_PATH, titles: [
            "the kill switch's second half reaches the platform: a live campaign is paused on Meta, with one succeeded pause row",
            "a disconnected connection gives no platform: the step fails no_platform rather than guessing",
          ] }],
        },
        {
          need: "the same faults on the image, creative and ad calls (B2c1)",
          tests: [{ file: PUBLISHER, titles: [
            "half-created (creative yes, ad no): the next stint adopts the creative and makes the ad once",
            "a creative create Meta applied but answered 5xx is found by its name, never made twice",
            "an image upload whose answer was lost is sent again and answers the same hash: one image per set of bytes",
            "a 429 on the ad create stops the step as rate_limited and makes nothing after it",
            "a creative with our name that shows another image is refused, never adopted; an ad with our name running is refused",
          ] }],
        },
        {
          need: "token revoked → stops + an alert to an admin (B2c2)",
          tests: [{ file: "apps/api/src/modules/ads/orchestrator/createPath.test.ts", titles: [
            "a revoked token stops the create as token_invalid, marks the connection failing and tells an admin once",
            "a disconnected connection fails the create as no_platform, with the same alert, and nothing is sent",
          ] }],
        },
      ],
      // Publisher L3 (2026-11-05): one contract suite, two targets — `contract/metaTarget.ts` switches FakeMeta for
      // the sandbox on ADS_TARGET, and the fault proxy injects the same faults in front of either, so L4 is this
      // list re-run, not a second one.
      L3: [
        {
          need: "the contract suite runs unchanged on either target: ADS_TARGET picks FakeMeta or Meta's sandbox, and a sandbox run without its credentials is refused",
          tests: [{ file: PUBLISHER_CONTRACT, titles: [
            "ADS_TARGET picks the target: unset or fake is FakeMeta, sandbox is Meta, anything else is refused",
            "a sandbox run without its credentials is refused, naming each missing variable — never a quiet fake run",
          ] }],
        },
        {
          need: "every create step (campaign, ad set, form, image, ad creative, ad) under a 429, a 5xx and a timeout",
          tests: [{ file: PUBLISHER_CONTRACT, titles: [
            "the %s create meeting %s: the step stops or recovers, nothing after it is sent, and the next stint ends with every object made once",
          ] }],
        },
        {
          need: "half-created objects resumed, never duplicated: campaign yes / ad set no; ad set yes / creative no; creative yes / ad no",
          tests: [{ file: PUBLISHER_CONTRACT, titles: ["half-created (%s): the next stint adopts what exists and makes only what is missing"] }],
        },
        {
          need: "token revoked → stop + an alert, before the first call and met mid-run at each create step",
          tests: [{ file: PUBLISHER_CONTRACT, titles: [
            "a revoked token stops the create at its first call, marks the connection failing and tells an admin once",
            "a token revoked mid-run, met first at the %s create, stops there as token_invalid and tells an admin once",
          ] }],
        },
        {
          need: "every created object read back from the target and compared with what was asked",
          tests: [{ file: PUBLISHER_CONTRACT, titles: ["every created object is read back and holds what was asked; each field sent is compared or says why not"] }],
        },
        {
          // stage2-kit (2026-11-06): §4R L4's "every recorded fixture re-recorded and diffed", as requests.
          need: "fakeMeta.ts's and fakeMetaAds.ts's OUR readings, re-recorded on the target and diffed against readings.recorded.json; a difference names the field and the fake",
          tests: [{ file: "apps/api/src/modules/ads/platforms/meta/contract/readings.contract.test.ts", titles: [
            "every OUR reading of FakeMeta's Graph (fakeMeta.ts, fakeMetaAds.ts) answers on the target as committed",
            "a planted difference fails, naming the reading, the field and the fake to correct",
          ] }],
        },
      ],
      L4: [{ need: "contract suite on Meta's sandbox: publisher.contract.test.ts with ADS_TARGET=sandbox", gap: STAGE2 }],
      L5: [{ need: "canary", gap: CANARY }],
    },
  },
  {
    worker: "Monitor",
    levels: {
      L1: [
        {
          need: "B5a hourly insights → ads_spend_hourly: a window re-read every hour, in the account's zone, revisions down replace, late hours fill in",
          tests: [
            { file: "apps/api/src/modules/ads/monitor/insightsPull.test.ts", titles: [
              "an hour Meta revises DOWN replaces the stored hour on the next run",
              "a late hour — not reported on one run — fills in on the next, beside the hours already held",
              "the fall-back day lands on the right UTC hours: the doubled 01:00 on its first, 02:00 two hours later",
              "an hour Meta stops reporting is written as zero — but a failed read leaves every stored hour alone",
            ] },
            { file: "apps/api/src/modules/ads/monitor/localHours.test.ts", titles: [
              "on the spring-forward day 02:00 does not exist, and is said to not exist rather than guessed",
            ] },
          ],
        },
        {
          need: "B5b auto-pause checks: each rule at its threshold (−1/0/+1), caps always, performance rules never while learning; a pause through the machine + its alert",
          tests: [
            { file: "packages/shared/src/ads/monitorChecks.test.ts", titles: [
              "overspend: the month past the platform's cap pauses EVERY delivering campaign on it, at a cent over and not at the cap",
              "zero-lead spend past the minimum fires, and at or below it does not; one lead stops it",
              "a learning-phase ad set is not paused except by a cap — and an unread stage is held the same way",
            ] },
            { file: "apps/api/src/modules/ads/monitor/checks.test.ts", titles: [
              "a forced overspend: today past the daily budget → the agent's `pause`, ledgered with its rule, and one critical ads_overspend",
              "zero-lead spend past the minimum pauses with ads_no_leads — but not while Meta is still learning",
            ] },
          ],
        },
        {
          need: "B5c daily reconcile: every planted mismatch flagged once as external_change, nothing on agreement, nothing adopted, nothing written to Meta",
          tests: [
            { file: "packages/shared/src/ads/adsReconcile.test.ts", titles: [
              "two sides that agree flag nothing — live, paused, and moves in flight either way",
              "an Ads-Manager status change: ACTIVE where we hold it paused is critical; PAUSED where we run it is a warning",
              "a campaign someone made in Ads Manager is reported, never adopted — critical while it delivers; a name of ours without our row is marked",
            ] },
            { file: "apps/api/src/modules/ads/monitor/reconcile.test.ts", titles: [
              "a run with no changes flags nothing, writes nothing, rings nothing",
              "an Ads-Manager status change → exactly one external_change, by the platform, and one critical bell — and the next run adds none",
              "never adopts: our campaign's state, budget and Meta's object are exactly as they were",
            ] },
          ],
        },
      ],
      L2: [
        {
          need: "CQ9b: a tired ad retired alone — one pause call at the platform, one retire_ad row, one bell; the campaign and its other ads untouched; the switch decides only the call; a platform refusal marks nothing",
          tests: [{ file: "apps/api/src/modules/ads/monitor/retireTired.test.ts", titles: [
            "the tired ad is paused at Meta, ledgered as retire_ad with its reason, marked retired on its creative, and rung once; the fresh ad and the campaign are untouched",
            "the next run finds the ledger row and does nothing again: one pause call, one row, one bell",
            "with the switch off, the verdict is computed and reported and nothing is called, written or rung",
            "a platform refusal is a failed ledger row and a failure, never a mark or a bell",
          ] }, { file: "packages/shared/src/ads/adFatigue.test.ts", titles: [
            "retires an ad whose last week's click-through fell past the share, against its own first week",
            "holds an ad younger than min_days, whatever its numbers",
          ] }],
        },
        {
          need: "insights late, missing hours, numbers revised down by the platform",
          tests: [{ file: "apps/api/src/modules/ads/monitor/insightsPull.test.ts", titles: [
            "a late hour — not reported on one run — fills in on the next, beside the hours already held",
            "an hour Meta stops reporting is written as zero — but a failed read leaves every stored hour alone",
            "an hour Meta revises DOWN replaces the stored hour on the next run",
          ] }],
        },
        {
          // monitor-alerts, 2026-11-06 (ADS-RUNBOOK Gaps 3, 4): a dead token and a Meta-rejected ad reach a person.
          need: "a dead token met by the hourly jobs, and an ad Meta turns down, each ring the bell once and leave the run failed",
          tests: [
            { file: "apps/api/src/modules/ads/monitor/tokenAlerts.test.ts", titles: [
              "%s: one critical bell to the admins, the connection marked failing, and the run still fails",
              "%s: a second run in the same outage rings nothing new, and still fails",
              "reconcile rings on its own reads too, not only through the pull inside it",
            ] },
            { file: "apps/api/src/modules/ads/monitor/adReview.test.ts", titles: [
              "DISAPPROVED: one external_change row keyed on the ad and status, with Meta's reasons, and one critical 'ads_rejected' bell",
              "the same verdict on the next run is already recorded: no second row, no second bell",
              "an ad read that fails is a failure of the run, not a green pass",
            ] },
          ],
        },
        {
          need: "an Ads-Manager edit",
          tests: [{ file: "apps/api/src/modules/ads/monitor/reconcile.test.ts", titles: [
            "an Ads-Manager status change → exactly one external_change, by the platform, and one critical bell — and the next run adds none",
          ] }],
        },
        {
          need: "30 simulated days with fatigue, overspend, zero-lead spend",
          tests: [{ file: "apps/api/src/modules/ads/monitor/thirtyDays.test.ts", titles: [
            "each rule pauses its campaign once, on the day it is passed, and a healthy campaign runs the whole month",
          ] }],
        },
      ],
      L3: [
        {
          need: "golden scenarios: each rule fires exactly at its threshold and minimum spend (−1/0/+1), through the real pull and checks",
          tests: [{ file: MONITOR_GOLDEN, titles: [
            "ads monitor golden scenarios — every one, through the real pull, checks and reconcile",
            "every rule and every reconcile field has at least one scenario",
            "a wrong state, a pause or flag or bell the scenario left out, and a failed job each fail",
          ] }],
          scenarios: [
            "monitor/daily-cap-at-its-threshold.yaml", "monitor/daily-cap-reads-the-accounts-day.yaml", "monitor/monthly-cap-on-metas-figure.yaml",
            "monitor/monthly-cap-on-our-fold.yaml", "monitor/no-lead-spend-at-its-threshold.yaml", "monitor/cost-per-lead-at-its-threshold.yaml",
            "monitor/frequency-at-its-threshold.yaml", "monitor/rules-switched-off-do-not-fire.yaml", "monitor/one-reason-the-most-serious.yaml",
            "monitor/a-late-hour-crosses-the-threshold.yaml", "monitor/numbers-revised-down-do-not-fire.yaml",
          ],
        },
        {
          need: "never on a learning-phase ad set except caps",
          scenarios: ["monitor/learning-ad-sets-are-held-except-by-a-cap.yaml", "monitor/monthly-cap-on-metas-figure.yaml"],
        },
        {
          need: "reconcile flags every planted mismatch and nothing else",
          tests: [{ file: MONITOR_GOLDEN, titles: ["every rule and every reconcile field has at least one scenario"] }],
          scenarios: [
            "monitor/deleted-object-settles.yaml", "monitor/reconcile-clean-run.yaml", "monitor/reconcile-every-mismatch-once.yaml", "monitor/reconcile-missing.yaml", "monitor/reconcile-status.yaml",
            "monitor/reconcile-daily-budget.yaml", "monitor/reconcile-spend-cap.yaml", "monitor/reconcile-overrun.yaml", "monitor/reconcile-not-ours.yaml",
          ],
        },
        {
          // stage2-kit-2c (2026-11-06): the L4 suite itself, green on FakeMeta every CI run, so the sandbox run
          // under `pnpm ads:certify` is this file unchanged.
          need: "the L4 suite on either target: the hourly pull through the sealed connection, a rejected ad, a dead token, the readings diffed",
          tests: [{ file: "apps/api/src/modules/ads/monitor/monitor.contract.test.ts", titles: [
            "the hourly pull reads the target through the sealed connection: the account's zone, every hour it reports, no failure",
            "an ad the platform turned down is recorded once and rings ads_rejected once, with Meta's reason",
            "a dead token stops the pull as token_invalid, writes no hour, and tells an admin once",
            "the target's answers to the monitor's reads are what FakeMeta committed to (OUR readings, diffed by field)",
          ] }],
        },
      ],
      L4: [{ need: "insights from the sandbox", gap: STAGE2 }], L5: [{ need: "canary", gap: CANARY }],
    },
  },
  {
    worker: "Lead intake",
    levels: {
      L1: [
        {
          need: "recruiting's sink (D1): stored once, verdicts written once and healed on a retry, a failed store thrown so the caller retries",
          tests: [{ file: "apps/api/src/modules/recruiting/routes/leads.test.ts", titles: [
            "stores the projection once and writes leadMatch's verdicts against the opening's profile",
            "a repeat of a lead stored before its verdicts were (a crash between the two) writes them",
            "throws when the store fails, so the caller retries rather than losing the lead",
          ] }],
        },
        {
          need: "the hourly backfill (B4a): a lost webhook's lead brought in once, nothing stored twice, nothing skipped quietly",
          tests: [
            { file: "apps/api/src/modules/ads/leads/backfill.test.ts", titles: [
              "brings every lead in the window to the sink once, with its campaign, brief and answers",
              "run again the next hour, every lead is a duplicate — none is stored twice",
              "a form Meta refuses is reported by its error code, and the other forms are still read",
              "a lead the sink refuses is reported by id, never by the person's details, and the rest are stored",
            ] },
            { file: "apps/api/src/queue/handlers/adsLeadsBackfill.test.ts", titles: [
              "fails the job when anything was not brought in, naming the lead by id only",
            ] },
            { file: "apps/api/src/modules/ads/leads/backfillTick.test.ts", titles: [
              // 2026-11-03 lead-path audit H1: `failing` connections are queued too, so a dead token's job fails
              // loudly instead of never running; the title says so.
              "queues one job per connected or failing Meta or simulator connection, each in its own slot, across carriers",
            ] },
          ],
        },
        {
          need: "the leadgen webhook (B4b): only what Meta signed is believed, over the raw bytes; fail-closed without the secret; a duplicate is one job and one lead",
          tests: [
            { file: "apps/api/src/modules/ads/routes/metaWebhook.test.ts", titles: [
              "echoes the challenge, as plain text, for our verify token",
              "refuses a wrong verify token with 403 and echoes nothing",
              "answers 503 while no verify token is configured",
              "no META_APP_SECRET: 503, counted, and nothing is looked up or queued",
              "a forged body is 401, counted, and nothing is queued",
              "a valid body serialised differently still verifies — the check is over the raw bytes",
              "a duplicate delivery is one job and one lead — and one after the job finished is still one lead",
              "a form we do not own is answered 200, counted, and nothing is queued or stored",
              "createApp routes the path Meta is given, unauthenticated, and fails closed while unconfigured",
            ] },
            { file: "apps/api/src/modules/ads/leads/leadFetch.test.ts", titles: [
              "reaches the sink with its campaign and brief, read by id with the Page's token",
              "the same lead from the webhook and from the backfill is stored once",
              "a lead Meta refuses to read fails, naming the lead by id",
            ] },
            { file: "apps/api/src/queue/handlers/adsLeadFetch.test.ts", titles: [
              "fails the job when the lead was not brought in, so the queue retries it",
            ] },
            { file: "apps/api/src/modules/ads/platforms/meta/connectionTest.test.ts", titles: [
              "subscribes the Page to leadgen with the Page token, never the system user's",
            ] },
          ],
        },
      ],
      L2: [
        {
          need: "a forged signature believes nothing",
          tests: [{ file: "apps/api/src/modules/ads/routes/metaWebhook.test.ts", titles: ["a forged body is 401, counted, and nothing is queued"] }],
        },
        {
          need: "a duplicate webhook is one lead",
          tests: [
            { file: "apps/api/src/modules/ads/routes/metaWebhook.test.ts", titles: ["a duplicate delivery is one job and one lead — and one after the job finished is still one lead"] },
            { file: "apps/api/src/modules/ads/leads/leadFetch.test.ts", titles: ["the same lead from the webhook and from the backfill is stored once"] },
          ],
        },
        {
          need: "a lost webhook: the backfill brings the lead",
          tests: [{ file: "apps/api/src/modules/ads/leads/backfill.test.ts", titles: ["brings every lead in the window to the sink once, with its campaign, brief and answers"] }],
        },
        {
          need: "the same person on two platforms: two leads, each with its attribution, named as one person",
          tests: [{ file: "supabase/tests/recruiting-lead-functions.test.mjs", titles: [
            "a lead from a second platform is stored as its own lead (its own attribution)",
            "it names the first lead as the same person",
            "the second platform's lead converts to the same applicant",
          ] }],
        },
        {
          need: "a malformed phone: stored without a number, never guessed, never lost",
          tests: [
            { file: "apps/api/src/modules/recruiting/leads/leadSink.test.ts", titles: ["a malformed phone is stored with no number and the lead is kept, with what they typed in the raw"] },
            { file: "packages/shared/src/recruiting/leads/leadContract.test.ts", titles: ["a malformed phone is stored as null, never guessed (the raw keeps what was typed)"] },
          ],
        },
        {
          need: "prompt-injection text in a free-text answer stays data",
          tests: [
            { file: "apps/api/src/modules/ads/leads/backfill.test.ts", titles: ["a free-text answer is data, never an instruction: kept verbatim, cut to the contract's 2,000 characters"] },
            { file: "apps/api/src/modules/recruiting/leads/leadSink.test.ts", titles: [
              "changes no verdict: an answer outside the catalogue reads as unknown, whatever it says",
              "does nothing but get stored: no write beyond the lead and its verdicts, no status of its own",
              "reaches no model: nothing on a lead's road imports the AI rail",
            ] },
          ],
        },
      ],
      L3: [
        {
          need: "0 lost, 0 duplicated leads over the scenario set, on the two roads (the store's SQL is the matrix's, below)",
          tests: [{ file: LEAD_GOLDEN, titles: [
            "ads lead golden scenarios — every one, through the real roads and the real sink",
            "the lead is stored once, by the road that reached the store first, whatever the order",
            "a lead stored twice, a lead on the wrong road, a lost ring and a stray write each fail",
            "a scenario cannot leave a lead unaccounted for, or drop one of ours",
            "every fault has at least one scenario",
          ] }],
          scenarios: [
            "leads/webhook-brings-the-lead.yaml", "leads/delivered-twice-while-queued.yaml", "leads/delivered-again-after-it-was-stored.yaml",
            "leads/webhook-lost-the-backfill-brings-it.yaml", "leads/the-backfill-first-then-a-late-webhook.yaml", "leads/forged-delivery-believes-nothing.yaml",
            "leads/a-batch-with-one-lead-lost.yaml", "leads/a-refused-read-is-retried.yaml", "leads/a-failed-store-fails-both-roads-loudly.yaml",
            "leads/stored-but-the-answer-was-lost.yaml", "leads/an-outage-past-the-window-closes-itself.yaml", "leads/a-spanish-form-by-both-roads.yaml",
            "leads/one-person-on-two-forms.yaml", "leads/a-form-no-campaign-holds.yaml",
          ],
        },
        {
          need: "the store itself keeps one row per lead: the real ingest_lead on PGlite",
          tests: [{ file: "supabase/tests/recruiting-lead-functions.test.mjs", titles: [
            "the same lead again (a retried webhook) answers `duplicate` with the first id",
            "there is one row for that lead",
          ] }],
        },
        {
          need: "injection text never reaches an action",
          tests: [{ file: "apps/api/src/modules/recruiting/leads/leadSink.test.ts", titles: ["reaches no model: nothing on a lead's road imports the AI rail"] }],
          scenarios: ["leads/text-aimed-at-a-reader-stays-data.yaml"],
        },
        {
          // stage2-kit-2c (2026-11-06): the L4 suite itself, green on FakeMeta every CI run, so the sandbox run
          // under `pnpm ads:certify` is this file unchanged.
          need: "the L4 suite on either target: the target's test lead webhook → fetch → one row, a duplicate delivery no second row, the readings diffed",
          tests: [{ file: "apps/api/src/modules/ads/leads/leadIntake.contract.test.ts", titles: [
            "the target's test lead goes webhook → fetch → one lead row, and a second delivery of it makes no second row",
            "a delivery signed with another secret is refused and nothing is fetched",
            "the target's answer to the lead read is what FakeMeta committed to (OUR readings, diffed by field)",
          ] }],
        },
      ],
      L4: [{ need: "a test lead from Meta's lead-ads testing tool", gap: STAGE2 }],
      L5: [{ need: "canary", gap: CANARY }],
    },
  },
  {
    worker: "Outcome feed",
    levels: {
      L1: [
        {
          need: "B6: one Conversions API CRM event per RECORDED stage (Q-AD37), event_id = lead:stage, nothing about the person (D-AD14), ledgered",
          tests: [
            { file: "apps/api/src/modules/ads/outcomes/outcomeEvents.test.ts", titles: [
              "one candidate per recorded stage, its ref the lead id and the stage, in the shared stage order",
              "no unrecorded stage can become a candidate (Q-AD37: never sent)",
              "seven days old is still sent; a millisecond more is too old",
              "the Conversions API event is a CRM event in seconds, the lead id a string",
            ] },
            { file: "apps/api/src/modules/ads/outcomes/outcomeFeed.test.ts", titles: [
              "sends one CRM event per recorded stage of each Meta lead, under the lead's Meta id, and ledgers each as sent",
              "the event carries the lead id and the stage and nothing about the person (D-AD14)",
              "a lead from another platform is never sent, and a stage outside the recorded list is refused as malformed",
              "a carrier whose feed is off (no target) is not read, sends nothing and writes nothing",
            ] },
            { file: "apps/api/src/modules/ads/outcomes/outcomeTick.test.ts", titles: [
              "queues one run per connected or failing Meta or simulator connection whose carrier has a feed target, and no other",
            ] },
            { file: "apps/api/src/modules/ads/adsSchemaParity.test.ts", titles: ["%s.%s matches the shared list"] },
          ],
        },
      ],
      L2: [
        {
          need: "§4R faults: replay, a stage after 28 days, a refusal (recorded, rung once, never retried), 429/5xx/timeout, revoked token — exactly one accepted event per stage row",
          tests: [{ file: "apps/api/src/modules/ads/outcomes/outcomeFeed.test.ts", titles: [
            "replayed the next day, every stage is already on the ledger: nothing is sent twice",
            "killed after Meta accepted but before the ledger said so, the resend is dropped by its event_id: one accepted event",
            "two runs racing to queue the same stage store it once (the unique ref), and it is sent once",
            "a stage reached more than 28 days after the lead arrived is still sent, once (28 days is Meta's optimisation window, not a send limit)",
            "a stage that failed until it turned 7 days old is then recorded skipped, never sent",
            "a stage that is no longer recorded when its turn comes is recorded skipped, never sent",
            "a stage reached more than 7 days ago is recorded skipped and never sent: Meta would refuse the whole request",
            "an event Meta refuses is recorded failed and final, rung once, and the rest of its batch is still sent",
            "%s fails the run and leaves the stage due; the next run sends it once",
            "a stage that keeps failing is tried MAX_ATTEMPTS times and never again",
            "a revoked token fails the run, keeps the stage due, marks the connection failing and rings ads_token_expiring once",
            "a dataset Meta does not have fails the run as a setup fault and writes no event's result",
          ] }],
        },
      ],
      L3: [
        {
          need: "scenario bar: exactly one accepted event per stage row across every crash point × fault (a sweep, as the Renderer's)",
          tests: [{ file: "apps/api/src/modules/ads/outcomes/outcomeFeed.sweep.test.ts", titles: [
            "a clean run makes the writes and calls the sweep kills at (5 inserts, 5 updates, 3 batches)",
            "killed at %s ends with one accepted event per stage row",
          ] }],
        },
        {
          need: "Q-AD40: on only when the settings version in force says so with a dataset (absent group = off), and the simulator only where its gate allows",
          tests: [{ file: "apps/api/src/modules/ads/outcomes/feedTarget.test.ts", titles: [
            "is off by default: a carrier who never saved settings has no target",
            "a version saved WITHOUT the group (an older form) parses, and reads as off",
            "on with a dataset id, a Meta connection's target is that dataset",
            "switched off with a dataset id still named, there is no target",
            "the switch cannot be saved on without a dataset, nor with a dataset id that is not digits",
            "the replace-whole-object trap: a save carrying the group keeps the feed on; a save without it turns it off",
            "on staging, a simulator connection's stages reach the simulator's own dataset, once each",
            "a run speaks only for its own platform: a Meta row due on the ledger is never sent to the simulator",
            "on production, a simulator connection has no target: nothing is ledgered or sent, even with the switch on",
            "on production, even a target handed in by mistake cannot open the simulator: the registry refuses and nothing is sent",
          ] }],
        },
        {
          // stage2-kit (2026-11-06): the readings its L4 settles, held on the fake every CI run, so the sandbox
          // run diffs against what the fake really answers.
          need: "fakeMetaEvents.ts's OUR readings, re-recorded on the target and diffed against readings.recorded.json",
          tests: [{ file: "apps/api/src/modules/ads/outcomes/outcomeReadings.contract.test.ts", titles: [
            "every OUR reading of FakeMeta's Conversions API (fakeMetaEvents.ts) answers on the target as committed",
          ] }],
        },
      ],
      L4: [{ need: "events accepted by the sandbox (Events Manager test code; OUR readings in fakeMetaEvents.ts checked)", gap: STAGE2 }],
      L5: [{ need: "canary", gap: CANARY }],
    },
  },
  {
    worker: "Copywriter",
    levels: {
      L1: [
        {
          need: "the pure claim checker that makes the L3 bar absolute (0 claims outside the brief)",
          tests: [{ file: "packages/shared/src/ads/adClaims.test.ts", titles: [
            "every leftover digit is reported, so a figure cannot hide inside an unrecognised shape",
            "a listed promise the opening does not make is refused",
            "the Spanish phrasing of an unlisted promise is refused too",
          ] }],
        },
        {
          need: "the worker, through the A4 rail, with every recorded answer replayed and every string claim-checked",
          tests: [{ file: COPYWRITER, titles: [
            "has model recordings under the prompt in force and planted defects beside them",
            "planted-invented-figure",
            "planted-invented-promise",
            "planted-forbidden-wording",
            "planted-spelled-spanish-number",
            "planted-slot-over-limit",
            "refuses the planted invented figure in both languages, naming each slot",
            "asks once per creative and attempt, as the copywriter, under the prompt version in force",
            "asks no model when the copywriter is switched off",
          ] }],
        },
      ],
      L2: [
        {
          need: "§4R's faults: a brief with no pay, a brief in Spanish, an instruction inside the brief, slots too short",
          tests: [{ file: COPYWRITER, titles: ["no-pay-in-brief", "spanish-subject", "instruction-in-subject", "short-slots"] }],
        },
      ],
      L3: [
        {
          need: "the evaluation set (≥ 40 briefs × presets, EN + ES) at its bar: 0 claims outside the brief reach review",
          tests: [{ file: COPYWRITER, titles: [
            "has model recordings under the prompt in force and planted defects beside them",
            "the evaluation set covers every proposed preset, P1–P5, with Spanish-written briefs beside English ones",
          ] }, { file: "packages/shared/src/ads/adClaims.test.ts", titles: [
            "every leftover digit is reported, so a figure cannot hide inside an unrecognised shape",
          ] }],
        },
        { need: "a human-rated approve-without-edit rate recorded as the baseline", gap: "60 briefs over P1–P5 (20 of them made through openingBrief from fields an opening can hold, CQ2), 20 in Spanish, THREE candidates each since CQ4 (prompt v3): 58 of 60 sets have at least one candidate pass the claim and length checks after the one fit pass (pnpm ads:eval copywriter, baseline.json, 2026-11-09); the owner rates them (the rating sheet in the PR) and the rate is recorded here" },
      ],
      // L4-ruling (Track G, 2026-11-06): owner, 2026-11-05: a Claude worker has an L4 like any other, so none launches on its
      // evaluation set alone (ADS-AGENT-PLAN §9). The run below was written by us from the ruling and CONFIRMED BY THE OWNER 2026-11-06.
      L4: [{ need: "its live copy accepted on Meta's sandbox: ads made from real answers, in English and Spanish, created without refusal", gap: `${STAGE2}; publisher.contract.test.ts sends fixed copy today, so that run must also carry Copywriter's real answers` }],
      L5: [{ need: "canary", gap: CANARY }],
    },
  },
  {
    worker: "Art director",
    levels: {
      L1: [
        {
          need: "the worker, through the A4 rail, with every recorded answer replayed and nothing that becomes letters let through",
          tests: [
            { file: ART_DIRECTOR, titles: [
              "has model recordings under the prompt in force and planted defects beside them",
              "planted-digit-in-slot", "planted-lettering", "planted-foreign-photo", "planted-photo-on-text-only", "planted-quote-in-slot",
              "planted-focal-outside-vocabulary", "planted-person-focal-no-people",
              "hands on a prompt ending with the no-lettering clause and the kit photo it starts from",
              "the prompt handed on is composed: the model's subject and distance as our clauses, and the plain region of the layout",
              "tells the model the frame and the part the words will cover, from the preset's layout and published formats, and the headline it was handed (AG3)",
              "asks once per creative and attempt, as the art director, sending the job as context but no claims and no company name",
            ] },
            { file: "packages/shared/src/ads/artDirection.test.ts", titles: [
              "ends with it when the template already does, without saying it twice",
              "adds it when the template does not",
              "refuses a photo that is not this kit's, none for an equipment scene, and one for a text-only scene",
              "the prompt carries the subject, the distance, the plain region of the preset's layout and the frame's shape, in that order, before the no-lettering clause",
              "refuses a subject the scene does not show: a person where the preset shows none, equipment where it shows none",
            ] },
          ],
        },
      ],
      L2: [
        {
          need: "§4R's faults: a brand kit missing photos; a preset showing people while the people policy is none (and an instruction inside a photo label or the headline)",
          tests: [{ file: ART_DIRECTOR, titles: [
            "refuses a scene with equipment when the brand kit has no photos, asking no model",
            "refuses a preset showing people while the people policy is none, asking no model",
            "instruction-in-label",
            "instruction-in-headline",
          ] }],
        },
      ],
      L3: [{ need: "the evaluation set at its bar: every prompt ends with the clause and starts from a reference photo when the preset shows equipment", gap: "C2 measured 10 of 10; CQ2 (2026-11-09, prompt v2 with the job as context) 11 of 12, the one refused a slot of 125 characters; AG3 (2026-11-10, prompt v3 directing the composition) 14 of 14 on two consecutive runs, after a first wording scored 7 of 14 by restating the layout inside its slots (pnpm ads:eval artDirector, baseline.json) on fixture presets; §4R sets no set size — it is re-run on P1–P5 once the owner approves them (Q-AD12)" }],
      // L4-ruling (Track G, 2026-11-06): owner, 2026-11-05: a Claude worker has an L4 like any other, so none launches on its
      // evaluation set alone (ADS-AGENT-PLAN §9). The run below was written by us from the ruling and CONFIRMED BY THE OWNER 2026-11-06.
      L4: [{ need: "its live prompts rendered by the real Higgsfield API, from the kit photo where the preset shows equipment, each picture passing the no-lettering check", gap: STAGE2 }],
      L5: [{ need: "canary", gap: CANARY }],
    },
  },
  {
    worker: "Craft judge",
    levels: {
      L1: [
        {
          need: "the worker through the A4 rail under its own agent and key; the seeded presentation order and the mapping back; the ranking pure; a planted off-range score refused",
          tests: [
            { file: "apps/api/src/modules/ads/workers/craftJudge/craftJudge.test.ts", titles: [
              "the order is a permutation drawn from the seed, the same every time, and not the identity for a typical seed",
              "scores answered in the shown order come back in the Copywriter's order",
              "asks once per creative and attempt, as the craft judge, under its own key and prompt version, and maps the scores back",
              "has model recordings under the prompt in force and planted defects beside them",
              "planted-score-out-of-range",
            ] },
            { file: "packages/shared/src/ads/copyCandidates.test.ts", titles: [
              "orders judged candidates by total, high first; a tie keeps the Copywriter's own order",
              "an unjudged candidate ranks after every judged one, in the model's order; none judged = the model's order, totals null",
            ] },
          ],
        },
      ],
      L2: [
        {
          need: "§4R's faults: switched off (the Copywriter's order, said so); a candidate dropped before the judge sees it; one survivor not sent; an answer short of the candidates asked",
          tests: [
            { file: "apps/api/src/modules/ads/workers/craftJudge/craftJudge.test.ts", titles: ["asks no model when the craft judge is switched off"] },
            { file: "apps/api/src/modules/ads/compose/composeCreative.test.ts", titles: [
              "the judge's top-ranked candidate becomes the copy — not the writer's first — and the whole ranked set is stored with scores and reasons",
              "a candidate refused for a figure the brief does not hold is dropped before the judge sees it; the rest go on",
              "with the craft judge switched off, the order is the writer's and the set says nobody ranked it",
              "one surviving candidate is not sent to the judge: there is nothing to rank",
              "an answer with fewer candidates than asked is off-schema, not quietly accepted",
            ] },
          ],
        },
      ],
      L3: [{ need: "agreement with the owner's ratings of real copy at the bar Q-AD57 sets (rec 0.8)", gap: "the planted-filler set ranks the filler last 6 of 6, twice (pnpm ads:eval craftJudge, baseline.json, 2026-11-09); the owner's rating sheet (#2054) is the ground truth this grows into and is not yet recorded" }],
      L4: [{ need: "its ranking over the Copywriter's live candidates on a sandbox run, with the chosen copy created on Meta without refusal", gap: STAGE2 }],
      L5: [{ need: "canary", gap: CANARY }],
    },
  },
  {
    worker: "Finished-ad judge",
    levels: {
      L1: [
        {
          need: "the worker through the A4 rail under its own agent and key, once per published format; the ad, the logo and the words it is shown; a planted off-scale or incomplete answer refused",
          tests: [
            { file: "apps/api/src/modules/ads/workers/finishedAdJudge/finishedAdJudge.test.ts", titles: [
              "asks once per published format, as the finished-ad judge, under its own key and prompt version",
              "the ad, then the logo as its own image when there is one, then the words drawn, the subject and the kit as data",
              "has model recordings under the prompt in force and planted defects beside them",
              "planted-score-out-of-range",
              "planted-missing-criterion",
            ] },
          ],
        },
      ],
      L2: [
        {
          need: "Q-AD76's faults: switched off or unreadable, the creative still reaches review saying the judge did not run; a score of 1 everywhere never stops an ad; a stopped creative is not judged",
          tests: [
            { file: "apps/api/src/modules/ads/workers/finishedAdJudge/finishedAdJudge.test.ts", titles: [
              "asks no model when switched off, and says so instead of stopping",
              "an answer off the 1–5 scale is recorded as not run, never stored as scores",
            ] },
            { file: "apps/api/src/modules/ads/compose/composeCreative.test.ts", titles: [
              "switched on, it is asked once per published format, on the English ad as composed, and its scores are stored beside the checks",
              "is never a gate: an ad scored 1 on everything still reaches review, with the scores on it",
              "switched off, nothing is asked and the creative reaches review saying the judge did not run",
              "an answer it cannot read is recorded as not run, and the creative still reaches review",
              "is asked only of a creative that passed the visual check: a stopped one has no opinion",
            ] },
          ],
        },
      ],
      L3: [{ need: "its scores compared with the owner's approve/reject on 30 real ads (Q-AD76), before any floor", gap: "P1-7 (2026-11-10) agreed 7 of 7 on two consecutive runs over seven drawn ads, three sound and four each planted with one weakness; L5 (2026-11-11) added nine ads in the new look on the same photos and words and agreed 16 of 16 (pnpm ads:eval finishedAdJudge, baseline.json; ADS-AD-LOOK-PLAN progress log); no real image exists until V4 (Q-AD20), so the 30-ad comparison cannot start" }],
      L4: [{ need: "its scores over the composed ads of a sandbox run, every creative reaching review whatever it scored", gap: STAGE2 }],
      L5: [{ need: "canary", gap: CANARY }],
    },
  },
  {
    worker: "Checker",
    levels: {
      L1: [
        {
          need: "the pure render checks: safe zones, contrast, fit",
          tests: [{ file: "packages/shared/src/ads/renderGeometry.test.ts", titles: [
            "a brand kit may tighten a zone, never widen it",
            "the WORST sample decides: one light pixel under the text fails a block that averages fine",
            "a line that needs more width than its box is refused, not shrunk",
            "a block with no background measured is a finding, never a pass",
          ] }],
        },
        {
          need: "the visual check (C5a): Claude vision through the A4 rail, one verdict per checklist item, any fail fails, images hashed not stored",
          tests: [
            { file: CHECKER, titles: [
              "has model recordings of every planted defect under the prompt in force",
              "planted-answer-one-fail",
              "planted-answer-missing-item",
              "an asked item the answer lacks is a fail, never a pass",
              "asks no equipment item of a text-only scene, and records it not applicable",
              "sends the image, the reference and the cut band as base64, and the ledger keeps only their hashes",
              "the band is cut from exactly the fractions given",
            ] },
            { file: "apps/api/src/modules/ads/generations/claudeGeneration.test.ts", titles: [
              "the model gets our bytes as base64 and the ledger keeps only their sha256",
              "an image over the API's limit is refused before any row or call",
            ] },
          ],
        },
        {
          need: "one creative composed (C5b1): the three checks, one regeneration with the failure added, then stop with the reason",
          tests: [{ file: "apps/api/src/modules/ads/compose/composeCreative.test.ts", titles: [
            "a visual fail regenerates once with our fixed clause in the prompt, under new keys, and a pass then is ready",
            "a second visual fail stops with the reason, and no third render is asked",
            "copy with a figure the brief does not hold stops before any art or render",
            "a format the brand kit has no overlay for stops as the render check, with no visual check asked",
            "the image checked is the framed still, before any text, beside the reference photo and the band the text covers",
          ] }, { file: "apps/api/src/modules/ads/orchestrator/runner.test.ts", titles: [
            "a pending compose moves nothing and writes no row, and the next step with the same key finishes it",
          ] }],
        },
        {
          need: "the campaign's compose step wired (C5b2): the seeded draw stored once, a creative per drawn preset in this stint, renders only through the one-at-a-time job, the campaign's verdict",
          tests: [{ file: "apps/api/src/modules/ads/compose/composeCampaign.test.ts", titles: [
            "draws with the campaign id as the seed, stores the draw while none is stored, and composes every preset in its order when none is left drawing",
            "a third preset enters once one of the first two has finished, and waits while both are still drawing",
            "leaves out a preset a live campaign for the same brief runs",
            "a creative that ended badly in an earlier stint is superseded by a new one in this stint",
            "any creative still under way keeps the campaign composing",
            "none ready fails the compose with every creative's reason",
          ] }, { file: "apps/api/src/modules/ads/orchestrator/queuedRender.test.ts", titles: [
            "no render yet: queues one ads_render job for this creative and attempt, and answers pending",
            "a model nobody priced, or the renderer switched off, is refused at once — never a job that writes no row",
          ] }],
        },
      ],
      L2: [
        {
          need: "§4R's planted-defect corpus: lettering, a foreign logo, the wrong truck type, malformed shapes, people under a none policy, a subject in the text band (and an instruction inside a photo label)",
          tests: [{ file: CHECKER, titles: [
            "defect-lettering", "defect-foreign-logo", "defect-wrong-truck", "defect-malformed", "defect-person", "defect-subject-in-band",
            "instruction-in-label", "clean-highway",
            "every model recording refuses the defect its image was made with, and passes the clean ones",
          ] }],
        },
      ],
      L3: [{ need: "pure checks catch 100 % of planted defects; the vision checklist's recall per defect type measured, at an owner-set threshold", gap: "C5a measured recall 10 of 10 on a 10-image corpus, twice (pnpm ads:eval checker, baseline.json, 2026-11-04); the owner sets the threshold, and the corpus grows past one image per defect" }],
      // L4-ruling (Track G, 2026-11-06): owner, 2026-11-05: a Claude worker has an L4 like any other, so none launches on its
      // evaluation set alone (ADS-AGENT-PLAN §9). The run below was written by us from the ruling and CONFIRMED BY THE OWNER 2026-11-06.
      L4: [{ need: "the planted-defect corpus re-run on pictures the real Higgsfield API drew, at the owner-set recall threshold, plus a verdict on every picture of the Art director's L4 run", gap: STAGE2 }],
      L5: [{ need: "canary", gap: CANARY }],
    },
  },
  {
    worker: "Analyst",
    levels: {
      L1: [
        {
          need: "the pure number check that makes the L3 bar absolute (0 numbers the fold did not produce), over a sheet built from the fold alone",
          tests: [{ file: BRIEF, titles: [
            "formats money, counts and shares the way the narration must copy them",
            "the day's totals are the fold's sum, so the model never adds campaigns up itself",
            "an immature cohort gets its counts and no rates; a mature one gets both",
            "refuses a planted number, a rounding of a real one, and a figure of the wrong kind",
            "refuses numbers written in words, so a figure cannot route around the check",
            "reads a campaign's name as the advertiser's words, and the same digits outside it as a figure",
          ] }],
        },
        {
          need: "the worker, through the A4 rail, with every recorded brief replayed and every sentence number-checked",
          tests: [{ file: ANALYST, titles: [
            "has model recordings under the prompt in force and planted numbers beside them",
            "planted-invented-number", "planted-rounded-money", "planted-computed-change", "planted-number-in-words",
            "refuses the planted number, naming the sentence it is in",
            "asks once per day and attempt, as the analyst, showing the model the fact sheet and nothing else",
            "asks no model when the analyst is switched off",
          ] }],
        },
        {
          need: "the brief read from stored hours (F1b) and delivered once a day: the checked narration, else the plain figures",
          tests: [
            { file: BRIEF_FOLD, titles: [
              "folds only yesterday's hours into the day, and the month up to yesterday's end into the month",
              "on the 1st it reports the last day of the month before, with that month's spend and no day left",
              "pages past PostgREST's 1,000-row cap, so a busy month is never cut short",
            ] },
            { file: DAILY_BRIEF, titles: [
              "sends the analyst's checked narration to the admins, once, under the day's key",
              "a narration refused twice is never sent: the plain figures go instead, after one retry under a new key",
              "a day already sent stops before any read or model call",
            ] },
            { file: BRIEF, titles: ["states every figure as the sheet holds it, so it passes the same check a narration must"] },
          ],
        },
      ],
      L2: [
        {
          need: "§4R's faults: a fold with a zero, a negative revision, a young cohort (and an instruction inside a campaign's name)",
          tests: [
            { file: ANALYST, titles: [
              "zero-day", "revised-down", "planted-pre-revision-figure", "young-cohorts-only", "planted-young-cohort-rate",
              "instruction-in-name", "planted-obeys-the-name",
            ] },
            { file: BRIEF, titles: [
              "a campaign with no lead and no impression gets no cost per lead and no click rate, not a zero",
              "refuses a rate for the young cohort, which the sheet does not hold",
            ] },
          ],
        },
        {
          // Q-AD34 built (2026-11-05): the cohort half through recruiting's LeadOutcomes; Q-AD37's unrecorded stages are never a number.
          need: "the cohort report (Q-AD34/Q-AD37): stages from recruiting's LeadOutcomes, only what a row records; an unrecorded stage is never a number",
          tests: [
            { file: "apps/api/src/modules/recruiting/leads/leadOutcomes.test.ts", titles: [
              "reads each recorded stage from its row: first contact, conversion, filed application, hire, and a loss only without a hire",
              "hired means hire_date set and status no longer applicant — never a hire date from before the lead arrived",
              "only this org's ad leads that arrived since: a typed-in lead, another org's and an older one are not read",
              "reads past PostgREST's 1,000-row cap on the leads and on each stage's rows",
            ] },
            { file: BRIEF_FOLD, titles: [
              "asks this org's leads from the Monday seven weeks before the reported day's week, and folds them by week",
              "a LeadOutcomes answering outside the shared shape fails the brief, never folds a stage it does not mean",
            ] },
            { file: "packages/shared/src/ads/adsReport.test.ts", titles: ["every recorded stage is a count, the recruiter's acts included; no stage is carried as not_recorded since LQ5 (0578/0580)"] },
            { file: BRIEF, titles: [
              "the unrecorded-stage rule is derived from UNRECORDED_LEAD_STAGES — empty since LQ5, so a recorded stage's figure passes the way any sheet figure does",
              "the fold refuses the not_recorded marker for a stage that IS recorded: qualified is a count since 0578 (LQ5)",
            ] },
            { file: ANALYST, titles: ["planted-stage-count-not-on-sheet", "eight-week-cohorts", "cohorts-losses-no-hire"] },
          ],
        },
      ],
      // Analyst L3 (2026-11-06, w-two-smalls): the fact sheet names its period in words (`showPeriod`), the check reads a
      // date in words as a date of its own kind, and analyst@3 met the bar on all 11 live folds, twice. "The set grows
      // over real folds" is not an L3 condition: real folds exist only after live campaigns (L4/L5).
      L3: [
        {
          need: "the evaluation set at its bar: 0 numbers in the narration that the fold did not produce",
          tests: [
            { file: ANALYST, titles: [
              "the live eval met the bar on every fold: each model recording under the prompt in force is ready, and the baseline agrees on all",
              "eight-week-cohorts", "cohorts-losses-no-hire", "planted-wrong-year", "planted-stage-count-not-on-sheet", "planted-young-cohort-qualified-rate",
            ] },
            { file: BRIEF, titles: ["the sheet names the period in words, and a narration may quote it — the right year only"] },
          ],
        },
      ],
      // L4-ruling (Track G, 2026-11-06): owner, 2026-11-05: a Claude worker has an L4 like any other, so none launches on its
      // evaluation set alone (ADS-AGENT-PLAN §9). The run below was written by us from the ruling and CONFIRMED BY THE OWNER 2026-11-06.
      L4: [{ need: "a live brief written over a day of the sandbox account's real hourly insights, every number from the fact sheet", gap: STAGE2 }],
      L5: [{ need: "canary", gap: CANARY }],
    },
  },
  {
    worker: "Renderer / Higgsfield client",
    levels: {
      L1: [
        {
          need: "the Higgsfield client: key sealed, submit under the row's id, output copied to our storage, credits checked before the submit",
          tests: [
            { file: RENDER, titles: [
              "copies the image into ad-assets by its hash and records our path and the price — no Higgsfield URL anywhere",
              "refuses a model nobody has priced, with no row and no submit",
              "refuses when the renderer is switched off, with no row and no submit",
            ] },
            { file: "apps/api/src/modules/ads/creative/higgsfield/higgsfieldKey.test.ts", titles: [
              "seals to an envelope that holds neither half in plaintext, and opens back to both halves",
              "a key sealed for another org cannot be opened here",
            ] },
          ],
        },
        {
          // Four titles changed 2026-11-10 with the looks (ADS-AD-LOOK-PLAN): each names the same refusal as before,
          // restated for a renderer whose headline steps down a ladder (D-ADL3), which draws five roles instead of
          // three (D-ADL4), and which darkens the picture by measurement instead of pasting a plate (D-ADL1) — so the
          // bright-stripe case is now "the scrim rises, and a kit with no ground still refuses". The ribbon look's
          // goldens are pinned beside the rail look's.
          need: "the overlay renderer (stills): golden images per format and look, text from the brief only, a too-long line refuses",
          tests: [{ file: "apps/api/src/modules/ads/creative/overlay/overlay.test.ts", titles: [
            "1:1 matches its golden image",
            "4:5 matches its golden image",
            "9:16 matches its golden image",
            "1:1 ribbon matches its golden image",
            "4:5 ribbon matches its golden image",
            "9:16 ribbon matches its golden image",
            "a headline that needs a third line at the lowest rung refuses, naming it, with no image",
            "a line with one size refuses as an overflow, never shrunk: the call to action, the kicker and the second line",
            "a figure the brief does not hold is refused here too, whatever checked it before — in the headline, the kicker or the second line",
            "one narrow bright stripe behind the words raises the step for the whole stack, where a null plate would refuse",
            "a format with no overlay in the brand kit refuses — no colour is invented",
          ] }],
        },
      ],
      L2: [
        {
          need: "§4R's faults: webhook never arrives (poll recovers); output URL expired; replay with the same idempotency key; credit budget exhausted",
          tests: [{ file: RENDER, titles: [
            "submits once under the row's id, polls until done, and a replay after that asks Higgsfield nothing",
            "an answer lost after Higgsfield charged is found again under the same key, not made twice",
            "a completed render whose file is already gone fails as output_expired, charged, and stores nothing",
            "writes budget_exhausted instead of submitting when the month cannot pay the price, counting renders still in flight",
          ] }],
        },
      ],
      L3: [
        {
          need: "§4R's bar over every way a render is cut short: 0 double charges across replays (the fake counts submits); every stored asset matches its sha256",
          tests: [{ file: "apps/api/src/modules/ads/creative/higgsfield/render.sweep.test.ts", titles: [
            "killed just after …",
            "recovered from …",
            "a finished render replayed after every case asks Higgsfield nothing more",
          ] }],
        },
      ],
      L4: [{ need: "a small real Higgsfield API budget", gap: STAGE2 }],
      L5: [{ need: "canary", gap: CANARY }],
    },
  },
  {
    worker: "Security (all)",
    levels: {
      L1: [
        {
          need: "who may do what on /api/ads: spend and settings admin-only with a fresh sign-in",
          tests: [{ file: ROUTES, titles: [
            "anyone who can see recruitment reads the settings; an outsider cannot",
            "only an admin with a fresh sign-in saves settings",
            "approving spend is admin-only with a fresh sign-in",
          ] }],
        },
      ],
      L2: [
        {
          need: "a cross-org read",
          tests: [
            { file: GUARD, titles: ["every query and write names the org"] },
            { file: RUNNER, titles: ["walks draft → composing → review, approved → creating → paused, launching → live, each with one transition row"] },
          ],
        },
        {
          need: "a simulated render reaching production",
          tests: [
            { file: "apps/api/src/modules/ads/creative/higgsfield/simulatedRender.test.ts", titles: [
              "a simulator connection in production, or on a nameless built server, keeps the real choice",
              "the simulated model is refused in production, whatever queued it",
            ] },
          ],
        },
        {
          need: "a token in a log line, or in an API response (B1b)",
          tests: [
            { file: "apps/api/src/modules/ads/connections/connections.test.ts", titles: [
              "is sealed to the org and the account kind, with the Page token beside it; the row is connected with the report",
              "answers with the view's columns only — a sealed token cannot ride out even as ciphertext",
              "is stored nowhere: no row, no ledger row, no audit — and the answer says why",
            ] },
            { file: "apps/api/src/modules/ads/routes/connections.test.ts", titles: ["anyone who can see recruitment lists the connections, and no answer carries a token column; an outsider cannot"] },
            { file: "apps/api/src/modules/ads/platforms/meta/connectionTest.test.ts", titles: ["the report holds no token — neither the system user's nor the Page's — so it can be stored and shown as it is"] },
            { file: "apps/api/src/modules/ads/platforms/meta/graphClient.test.ts", titles: ["never carries the token in a failure, even when the message would"] },
          ],
        },
        {
          need: "a non-admin hitting Connect (B1b)",
          tests: [{ file: "apps/api/src/modules/ads/routes/connections.test.ts", titles: [
            "only an admin with a fresh sign-in may connect, connect the simulator or disconnect — a manager may not",
            "testing a connection is the admin's, without a password prompt; a manager may not",
          ] }],
        },
        {
          need: "a non-admin hitting Launch (S1c)",
          tests: [{ file: "apps/api/src/modules/ads/routes/campaignMoves.test.ts", titles: [
            "a non-admin hitting Launch is refused, with or without a fresh sign-in, and nothing moves",
            "an admin without a fresh sign-in is asked to sign in again",
          ] }],
        },
      ],
      // G-sec, 2026-11-05: L2 pinned each door and each leak by hand; L3 asks the same four questions of ALL of
      // them at once, each a test that fails on the leak and each shown red by a mutant (the PR lists them).
      L3: [
        {
          need: "a token, key or app secret in any log line — console, job failure or written row — with Meta echoing the token in every error",
          tests: [{ file: SEC_LOGS, titles: [
            "the scrape had something to find: tokens were sent, Meta echoed them, and the roads logged",
            "no console line, job failure or written row holds a token, the app secret or the sealing key",
          ] }],
        },
        {
          need: "a token, key or app secret in any ads route's answer — every route the app serves, called once",
          tests: [{ file: SEC_SWEEP, titles: [
            "every /api/ads route the app serves was called once, and none answered a server error",
            "no ads answer carries a token, key or secret — plain or sealed — or a sealed column, even when Meta echoes the token",
          ] }],
        },
        {
          need: "a cross-org read on every ads service query the routes reach, and on the job roads",
          tests: [
            { file: SEC_SWEEP, titles: ["no answer names another carrier's row, and every query and write the routes made names this org"] },
            { file: MONITOR_GOLDEN, titles: ["%s"] },
          ],
        },
        {
          need: "a non-admin hitting Connect, Launch, kill-switch clear or settings save — and an ads route nobody classified",
          tests: [{ file: SEC_GATES, titles: [
            "the walked /api/ads routes are exactly the ledger's, each behind exactly its gates",
            "%s is refused for every role but admin, with a fresh sign-in, and writes nothing",
          ] }],
        },
      ],
      L4: [{ need: "a token scrape over a sandbox run's logs", gap: STAGE2 }],
      L5: [{ need: "canary", gap: CANARY }],
    },
  },
];

/**
 * Which workers a campaign uses, by its connection's provider and its creative kind (G-launch-gate,
 * 2026-11-05). The ONE table: `check-ads-readiness.mjs` bakes it into
 * `packages/shared/src/ads/launchReadiness.generated.ts`, and Launch refuses a real-platform campaign unless
 * every worker listed for it is certified L4 there. A per-platform worker names its platform. A provider or
 * kind with no row cannot launch at all, so a new adapter must be listed here before it can spend.
 *
 * The Analyst is listed (L4-ruling, 2026-11-06): G-launch's done-when includes "next morning's brief arrives", so a
 * campaign uses it. Not listed, on purpose: the Outcome feed (B6 comes after the canary, §5; it joins Meta's row when
 * it sends events). The simulator has no row: its own gate (`simulatorGate`) refuses it everywhere but a positively
 * non-production host.
 *
 * @type {Record<string, Array<{ worker: string, platform?: string }>>}
 */
export const CAMPAIGN_WORKERS = {
  "meta:still": [
    { worker: "Orchestrator" },
    { worker: "Budget guard" },
    { worker: "Publisher (per adapter)", platform: "meta" },
    { worker: "Monitor" },
    { worker: "Lead intake" },
    { worker: "Copywriter" },
    { worker: "Art director" },
    { worker: "Checker" },
    { worker: "Renderer / Higgsfield client" },
    { worker: "Analyst" },
    // CQ4 (2026-11-09): the judge ranks every creative's copy, so a campaign on Meta uses it; Launch needs its L4 too.
    { worker: "Craft judge" },
    // P1-7 (2026-11-10): every creative that passes the visual check is scored, so a Meta campaign uses it too.
    { worker: "Finished-ad judge" },
    { worker: "Security (all)" },
  ],
};

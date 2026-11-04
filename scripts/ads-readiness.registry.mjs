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
const notBuilt = (step) => ({ need: "the worker exists with its contract and boundary tests", gap: `not built yet — ${step}` });
const later = (level) => [{ need: `${level} for this worker`, gap: "follows the level below it" }];

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
const META_ADAPTER = "apps/api/src/modules/ads/platforms/meta/metaAdapter.test.ts";
const META_PATH = "apps/api/src/modules/ads/orchestrator/metaPath.test.ts";
const RULES_SYNC = "apps/api/src/modules/ads/platforms/meta/rulesSync.test.ts";
const COPYWRITER = "apps/api/src/modules/ads/workers/copywriter/copywriter.test.ts";
const ART_DIRECTOR = "apps/api/src/modules/ads/workers/artDirector/artDirector.test.ts";
const RENDER = "apps/api/src/modules/ads/creative/higgsfield/render.test.ts";
const CHECKER = "apps/api/src/modules/ads/workers/checker/checker.test.ts";

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
        { need: "the creative and the ad (B2c, which also wires `createPaused`)", gap: "not built yet — B2c, after C3 (Higgsfield client) and C4 (overlay renderer)" },
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
        { need: "token revoked → an alert to an admin, and the same faults on the creative and ad calls", gap: "the alert lands when the publisher is wired into the runner (B2c); the creative and ad calls with B2c" },
      ],
      L3: later("L3"),
      L4: [{ need: "contract suite on Meta's sandbox", gap: STAGE2 }],
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
      L2: later("L2"), L3: later("L3"), L4: [{ need: "insights from the sandbox", gap: STAGE2 }], L5: [{ need: "canary", gap: CANARY }],
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
      L2: later("L2"), L3: later("L3"),
      L4: [{ need: "a test lead from Meta's lead-ads testing tool", gap: STAGE2 }],
      L5: [{ need: "canary", gap: CANARY }],
    },
  },
  { worker: "Outcome feed", levels: { L1: [notBuilt("B6 Conversions API events per stage")], L2: later("L2"), L3: later("L3"), L4: [{ need: "events accepted by the sandbox", gap: STAGE2 }], L5: [{ need: "canary", gap: CANARY }] } },
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
      L3: [{ need: "the evaluation set (≥ 40 briefs × presets, EN + ES) at its bar; human-rated approve-without-edit baseline", gap: "C2 recorded 10 briefs (pnpm ads:eval copywriter: 9 of 10, baseline.json); the set grows to 40 and a person rates it" }],
      L4: [{ need: "not applicable to a model worker beyond the eval set", gap: "decided with C2: whether a Claude worker has an L4 at all" }],
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
              "hands on a prompt ending with the no-lettering clause and the kit photo it starts from",
              "asks once per creative and attempt, as the art director, sending no brief and no company name",
            ] },
            { file: "packages/shared/src/ads/artDirection.test.ts", titles: [
              "ends with it when the template already does, without saying it twice",
              "adds it when the template does not",
              "refuses a photo that is not this kit's, none for an equipment scene, and one for a text-only scene",
            ] },
          ],
        },
      ],
      L2: [
        {
          need: "§4R's faults: a brand kit missing photos; a preset showing people while the people policy is none (and an instruction inside a photo label)",
          tests: [{ file: ART_DIRECTOR, titles: [
            "refuses a scene with equipment when the brand kit has no photos, asking no model",
            "refuses a preset showing people while the people policy is none, asking no model",
            "instruction-in-label",
          ] }],
        },
      ],
      L3: [{ need: "the evaluation set at its bar: every prompt ends with the clause and starts from a reference photo when the preset shows equipment", gap: "C2 measured 10 of 10 (pnpm ads:eval artDirector, baseline.json) on fixture presets; §4R sets no set size — it is re-run on P1–P5 once the owner approves them (Q-AD12)" }],
      L4: [{ need: "a render through the real Higgsfield API", gap: STAGE2 }],
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
        notBuilt("C5b compose: the three checks per creative, one regeneration with the failure added, then stop with the reason"),
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
      L4: [{ need: "the planted-defect corpus re-run on real renders", gap: STAGE2 }],
      L5: [{ need: "canary", gap: CANARY }],
    },
  },
  { worker: "Analyst", levels: { L1: [notBuilt("F1 daily brief + cohort report")], L2: later("L2"), L3: later("L3"), L4: [{ need: "a brief over sandbox insights", gap: STAGE2 }], L5: [{ need: "canary", gap: CANARY }] } },
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
          need: "the overlay renderer (stills): golden images per format, text from the brief only, a too-long line refuses",
          tests: [{ file: "apps/api/src/modules/ads/creative/overlay/overlay.test.ts", titles: [
            "1:1 matches its golden image",
            "4:5 matches its golden image",
            "9:16 matches its golden image",
            "a headline that needs a third line refuses, naming it, with no image",
            "one word wider than the zone refuses as an overflow, never shrunk",
            "a figure the brief does not hold is refused here too, whatever checked it before",
            "one narrow bright stripe behind the words fails, though the rest of the zone is dark",
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
      L3: later("L3"),
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
        { need: "a non-admin hitting Launch", gap: "the Launch route arrives with E3; the approve-spend door is pinned at L1" },
      ],
      L3: later("L3"),
      L4: [{ need: "a token scrape over a sandbox run's logs", gap: STAGE2 }],
      L5: [{ need: "canary", gap: CANARY }],
    },
  },
];

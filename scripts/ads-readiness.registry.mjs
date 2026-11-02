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
              "starts no timer unless ADS_ENABLED",
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
            "the platform's account limit must be read, and no looser than our cap (fence 3)",
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
        notBuilt("B2 create paused, B3 launch / pause through the guard"),
      ],
      L2: later("L2"),
      L3: later("L3"),
      L4: [{ need: "contract suite on Meta's sandbox", gap: STAGE2 }],
      L5: [{ need: "canary", gap: CANARY }],
    },
  },
  { worker: "Monitor", levels: { L1: [notBuilt("B5 hourly insights, daily reconcile, external_change")], L2: later("L2"), L3: later("L3"), L4: [{ need: "insights from the sandbox", gap: STAGE2 }], L5: [{ need: "canary", gap: CANARY }] } },
  { worker: "Lead intake", levels: { L1: [notBuilt("B4 leadgen webhook + D1 ingest_lead")], L2: later("L2"), L3: later("L3"), L4: [{ need: "a test lead from Meta's lead-ads testing tool", gap: STAGE2 }], L5: [{ need: "canary", gap: CANARY }] } },
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
        notBuilt("C2 copywriter prompt pack + schema + fixtures"),
      ],
      L2: later("L2"), L3: later("L3"),
      L4: [{ need: "not applicable to a model worker beyond the eval set", gap: "decided with C2: whether a Claude worker has an L4 at all" }],
      L5: [{ need: "canary", gap: CANARY }],
    },
  },
  { worker: "Art director", levels: { L1: [notBuilt("C2 art director prompt pack")], L2: later("L2"), L3: later("L3"), L4: [{ need: "a render through the real Higgsfield API", gap: STAGE2 }], L5: [{ need: "canary", gap: CANARY }] } },
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
        notBuilt("C5 checker (copy + vision checklist + render)"),
      ],
      L2: later("L2"), L3: later("L3"),
      L4: [{ need: "the planted-defect corpus re-run on real renders", gap: STAGE2 }],
      L5: [{ need: "canary", gap: CANARY }],
    },
  },
  { worker: "Analyst", levels: { L1: [notBuilt("F1 daily brief + cohort report")], L2: later("L2"), L3: later("L3"), L4: [{ need: "a brief over sandbox insights", gap: STAGE2 }], L5: [{ need: "canary", gap: CANARY }] } },
  { worker: "Renderer / Higgsfield client", levels: { L1: [notBuilt("C3 Higgsfield client (on FakeHiggsfield, #1923) + C4 overlay renderer")], L2: later("L2"), L3: later("L3"), L4: [{ need: "a small real Higgsfield API budget", gap: STAGE2 }], L5: [{ need: "canary", gap: CANARY }] } },
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
        { need: "a token in a log line, or in an API response", gap: "no platform token is held yet — B1 brings the sealed Meta token and its log and response scrapes" },
        { need: "a non-admin hitting Connect or Launch", gap: "Connect and Launch routes arrive with B1 (`ads.connection`) and E3; the approve-spend door is pinned at L1" },
      ],
      L3: later("L3"),
      L4: [{ need: "a token scrape over a sandbox run's logs", gap: STAGE2 }],
      L5: [{ need: "canary", gap: CANARY }],
    },
  },
];

# Handoff · 2026-11-02 (evening) · Ads agent, Stage 1 from step B2

**Paste this whole file into a fresh chat.** It continues `HANDOFF-2026-11-02-ADS-STAGE1-7B.md`. That
handoff's §4 traps and §6 owner track **still hold**, as do the earlier handoffs' traps. This file
replaces its §1 position, §2 open branches, §3 step list and §5 process. Stage 1 = build the agents and
the orchestrator and prove them against fakes, with **no social-network or Higgsfield credentials**.

## 0. Read first, in this order

1. `CLAUDE.md` (root): hard rules, gates, the release train, "No workarounds".
2. `HANDOFF-2026-11-01-ADS-STAGE1.md` §1 (owner rulings — do not re-ask them). Then
   `HANDOFF-2026-11-02-ADS-STAGE1-A6.md` §4 (traps) and `HANDOFF-2026-11-02-ADS-STAGE1-7B.md` §4
   (traps).
3. `ADS-AGENT-BUILD-WORKFLOW.md`: §1.2 (corrections 1–10), the Phase B table (B2, B3), **§4R**
   (readiness levels, the L2/L3 table), and the **progress log at the end** — its entries from
   "7b + 7c merged" onward are this session.
4. `ADS-AGENT-PLAN.md` §9: Q-AD23 and Q-AD24 are new and open. Also the plan's line 436, which
   names `metaLeadForm.ts`.
5. What exists (read it before writing B2):
   - **Meta client and connections:** `apps/api/src/modules/ads/platforms/meta/graphClient.ts`,
     `platforms/meta/connectionTest.ts`, `platforms/registry.ts`, `platforms/simulator/fakeMeta.ts`,
     `connections/connections.ts`, `routes/connections.ts`.
   - **Orchestrator:** `orchestrator/workers.ts` (what B2 fills) and `orchestrator/runner.ts`
     (how `createPaused` is called and what it must return).
   - **Readiness:** `scripts/ads-readiness.registry.mjs` (the Publisher row B2 must turn into pins).
   - **Golden scenarios:** `packages/ads-golden/AUTHORING.md`.

## 1. Done this session (all merged to main and served on staging)

| Step | PR | Merge | What |
|---|---|---|---|
| 7b FakeMeta | #1921 | `dad251a` | In-process Marketing API with injected faults (see 7b handoff §2) |
| 7c FakeHiggsfield | #1923 | `ab01c0e` | In-process Higgsfield API: keyed replays, refunds, signed webhooks |
| 7d golden scenarios | #1925 | `62b66d0` | `packages/ads-golden` (YAML + schema + loader ONLY). Runner `apps/api/src/testing/adsGolden.ts`, test `orchestrator/golden.test.ts`. 15 scenarios + a crash at each of the happy path's 23 writes. **Q-AD23** recorded |
| 8 readiness gate | #1933 | `85837a0` | `lint:ads-readiness` (in CI `gates`) + `pnpm ads:readiness`. Registry pins tests per §4R worker × L1–L5 or names a `gap`. `guard/budgetGuard.race.test.ts` added |
| B1a Graph client | #1936 | `e5989c4` | `MetaGraph`, `META_GRAPH_VERSION = "v26.0"` (FakeMeta reads it). Bearer token; errors classed by Meta's table; throttle obeyed per connection; reads retried, **a create never re-sent → `outcome_unknown: true`** |
| B1b Connect | #1939 | `819afbc` | `/api/ads/connections` (list = recruitment view; test = `ads.connection`; connect / simulator / disconnect = `ads.connection` + fresh sign-in). 6-check connection test. Tokens sealed with AAD org + `meta_ads:live\|sandbox`. Disconnect refused while launching/live/pausing. Simulator = real `MetaGraph` → in-process FakeMeta behind `simulatorGate` at every call. **Q-AD24** recorded |

- **Main at handoff:** `2ab0738`. **Last migration on main:** `0550_hiring_question_document_settings.sql`
  (the hiring chat is moving fast — check the NAME before any migration of yours).
- **Scorecard (`pnpm ads:readiness`):** Orchestrator L3 · Budget guard L3 · Security L1 (its one gap is
  "non-admin hitting Launch", which waits for E3) · the other nine workers L0. Publisher's L1 already
  pins the Graph client beside its "not built" gap.
- **No ads branch is open.** The worktrees `../FuelGuard-ads-ho6`, `-ho7`, `-ho8` are handoff-only and
  may be removed.

## 2. Open questions (recorded in `ADS-AGENT-PLAN.md` §9; do not route around them)

- **Q-AD23** — a launch delivered twice at once is sent once, but the campaign ends paused.
  Recommendation: (a) now; (b) once B1 measures Meta's real launch latency. Owner has not ruled.
- **Q-AD24** — a Meta token's expiry is readable only with our app's secret (Stage 2), so
  `token_expires_on` stays null. Recommendation: (b) `debug_token` in Stage 2. Use (a), the admin typing
  the expiry, as a stopgap only if the secret is not sealed by **12/25**.

## 3. Next steps, in order (one PR each; split a step if it passes ~500 lines)

| # | Step | Notes |
|---|---|---|
| **B2** | **Publisher: create paused** | Workflow row B2: campaign (`special_ad_categories=["EMPLOYMENT"]`, US, `spend_cap`), ad set (radius ≥ 15 mi; no age/gender field may exist in the builder), Instant Form (from `metaLeadForm`, privacy URL), creative, ad; names from `naming.ts`. **Measured gaps:** `metaLeadForm.ts` does NOT exist yet (the plan names it, line 436); `rulesSpec` is B3's. The ad needs a rendered creative (C4), so **propose a split first**: B2a campaign + ad set; B2b the Instant Form + `metaLeadForm.ts`; B2c creative + ad once C3/C4 exist. Each FakeMeta endpoint joins with its first caller (FakeMeta header). |
| B2 rules | **Resume, never duplicate** | When a create comes back `outcome_unknown`, read before re-creating: find the object by our name (`buildAdName` carries the campaign's short id) and take its id, or create. Hand the runner `key` through. §4R Publisher L2: "half-created campaign (campaign yes, ad set no) → resumed, never duplicated; 429/5xx/timeout on each create step; token revoked → stops + alert". Use FakeMeta's `applied_then_temporary`, `hang`, `throttle`, `revokeToken()`. |
| B2 wiring | **Fill `workers.ts`** | `createPaused` (B2), and `platform` = `graphForConnection` → a `PlatformAdapter` → `guardPlatform`. That needs pause and launch, which are **B3**. So either B2 fills `createPaused` only and B3 fills `platform`, or B2 brings pause and B3 launch — decide and say why. Add golden scenarios driving the REAL publisher over FakeMeta, not the scripted vendor. Replace Publisher's `notBuilt` gap in the registry with pins (L1, then L2). |
| B3 | Launch / pause / budget + Automated Rules | Through the guard only (`budgetGuard.boundary.test.ts` reads text: never write `.launch(` outside `guard/`/`platforms/`). `rulesSpec` + `adrules_library` sync on settings save. V2 (sandbox rule) is credential-gated → FakeMeta. |
| then | B4 leads + webhook, B5 monitor, C1–C5, F1, D0–D2, E1–E5 | As in the 7b handoff §3 row 9–11. D0 first re-checks the HW PRs (`gh pr list`); it edits `purge_applicant` + the roster merge list in the same PR. |

Calendar (workflow §5): Stage 1 reaches L3 by **Sat 11/07**; credentials and L4 from **Mon 11/09**.

## 4. Traps hit this session (add to the earlier lists)

- **`lint:table-writers`**: a new file that writes a table must be added to `scripts/table-writers.json`
  in the same PR, with the reason in the commit message. #1939 failed CI on exactly this.
- **Run the whole `gates` job before pushing:** `node scripts/ci-local.mjs --job gates` (~2 min, light
  on memory). Hand-picked lints missed the table-writers gate; this did not.
- **`no-useless-assignment` is an ESLint ERROR**: `let x: T = null; try { x = … }` fails. Declare it
  without the initial value. It hit 7c and B1a.
- **`testServerTeardown.test.ts`**: any test that `.listen(0` must close through `closeTestServer`
  (`testing/httpServer.ts`), never `server.close(` by hand.
- **The budget-guard boundary scan matches `.launch(` in ANY non-test file outside `guard/` and
  `platforms/`**, including `testing/` and comments. Name helpers differently (`forLaunch`).
- **A new `packages/*` directory** must be named in `scripts/release-train.mjs` `AREAS`, or its
  self-test fails.
- **`lint:comment-claims`**: a comment naming a `*.test.ts` file must quote a real test title in `"…"`.
- **A coverage gap a mutation finds** is fixed with a test in the same PR (7d's G6), never by
  dropping the mutant.
- **`gh pr checks` right after a push** can report the PREVIOUS run, or `UNKNOWN` merge state. Confirm
  with `gh run list --branch <b> --workflow CI --limit 1 --json headSha,conclusion` that the head
  sha's run is complete.
- **Waiting:** a chain of foreground `sleep`s is blocked. Use `until <check>; do sleep 20; done` in a
  background Bash and wait for its notification.
- **Staging test members are not admins**: an `ads.connection` / `ads.spend` door cannot be walked on
  staging with them. Say so in the PR rather than claiming a staging check.

## 5. Process (as agreed this session)

- **Worktree:** from `origin/main` (`claude/<topic>`). Then install, run
  `pnpm --filter @silvicom/shared build:rn`, and copy `apps/api/.env` and `apps/web/.env`.
- **The gate is GitHub CI** (owner's choice, 11/02). Locally run: the touched suites, the api
  typecheck, ESLint on the module, and `node scripts/ci-local.mjs --job gates`. Do not run a full
  `ci:local` next to anything heavy.
- **Mutate each new rule:** show it red in the PR body as a table, and restore each file byte-for-byte
  (`cp` + compare).
- **The PR:** use the four template headings (`--body-file` skips the template). The title is one
  sentence for an office reader. Merge by hand when CI shows 17 pass + `plan` skipped.
- **After merge:** wait until staging's `/api/version` commit contains the merge
  (`git merge-base --is-ancestor`).
- **Bookkeeping:** append to the END of the workflow's progress log, and update the memory file
  `recruiting-ads-agent-position.md` at each merge.

## 6. Owner track (unchanged, due Mon 11/09)

Meta setup (say "Meta ready" — never paste a token anywhere, including chat), Higgsfield **API** key,
TikTok developer app, X contact, brand kit + 5–10 truck/trailer photos, the first opening, spending
values, presets P1–P5. Counsel (G12 / Q-AD8). Rulings on Q-AD23 and Q-AD24. Approve the next release
(it carries A5 → B1b).

## 7. First action in the new chat

1. Read §0.
2. Confirm main's HEAD, and the last migration by name.
3. Confirm no ads PR is open: `gh pr list --search "ads in:title"`.
4. Run `pnpm ads:readiness` and check it matches §1.
5. Propose the B2 split (§3) in one short message, with a recommendation, then build B2a.

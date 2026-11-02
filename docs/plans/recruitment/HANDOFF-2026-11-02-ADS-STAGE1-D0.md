# Handoff · 2026-11-02 (night) · Ads agent, Stage 1 from step D0

**Paste this whole file into a fresh chat.** It continues `HANDOFF-2026-11-02-ADS-STAGE1-B2.md`. That
handoff's §4 traps and §5 process **still hold**, and so do the earlier handoffs' traps (A6, 7B).
This file replaces its §1 position, §3 step list and §7 first action. Stage 1 means building the agents
and the orchestrator and proving them against fakes, with **no social-network or Higgsfield
credentials**.

## 0. Read first, in this order

1. `CLAUDE.md` (root): the hard rules, the release train, "No workarounds". Pay particular attention to
   the rule that a migration and its first reader ship in **two** merges.
2. `HANDOFF-2026-11-02-ADS-STAGE1-B2.md` §4 (traps) and §5 (process). Also
   `HANDOFF-2026-11-01-ADS-STAGE1.md` §1, the owner rulings, which are not to be re-asked.
3. `ADS-AGENT-BUILD-WORKFLOW.md`: Phase D (D0–D2), Phase B4, §4R's Lead intake row, and the
   **progress log at the end**. Its entries from "B2 split + B2a" onward are this session.
4. `ADS-AGENT-PLAN.md` §4.1 (the recruiting tables), §4.2 (`leadContract.ts`, `leadMatch.ts`) and
   §1 "Meta employment rules". Those rules are why `leadMatch` returns `unknown` on age and the
   disqualifiers for every Meta lead.
5. What exists. Read it before writing D0:
   - `packages/shared/src/ads/contracts.ts`: `platformLeadSchema`, `LeadSink` (the interface D1
     implements), `LeadStageEvent`.
   - `apps/api/src/modules/roster/mergeDriver.ts` `DRIVER_REASSIGNMENTS`, and the latest
     `purge_applicant` definition (`grep -l "purge_applicant" supabase/migrations/*.sql | sort | tail -1`).
   - Memory `merge-driver-cascade-trap.md`: a new table cascading from drivers must be listed.
   - `supabase/CLAUDE.md` and `docs/MIGRATION-DISCIPLINE.md`.

## 1. Done this session (all merged to main and served on staging)

| Step | PR | Merge | What |
|---|---|---|---|
| B2a | #1945 | `f7ccb44` | `platforms/meta/publisher.ts`: a paused EMPLOYMENT campaign + lead ad set. Every level reads by our exact name first. One found is taken, none is created, two are refused, one not paused is refused. A create with an unknown outcome is read again, never re-sent. Every create is read back by id. `naming.ts`: `ALL` above the ad level |
| B2b | #1946 | `c167f8f` | The Instant Form. `packages/shared/src/ads/metaLeadForm.ts` asks contact plus the **G12 counsel fallback** only (Class A, years, hazmat; EN + ES). It is made with the **Page token** (`registry.pageGraphForConnection`) |
| B3a | #1947 | `2aefd98` | `platforms/meta/metaAdapter.ts`. The campaign is the master switch: pause = the campaign alone; launch = amounts, then ads and ad set, campaign LAST. Answers come from the read-back. `workers.platform` is filled (`registry.adapterForConnection` → `guardPlatform`), **so the kill switch's pause reaches Meta / the simulator for real** |
| B3b | #1949 | `b2567ab` | `adsRulesSpec.ts` + `platforms/meta/rulesSync.ts`: settings → Meta Automated Rules, scoped to `S360\|<code>\|adset\|` names. It is a diff (update in place, DISABLE, never delete). A 2703 is recorded `refused` (U2 fallback). New job kind `ads_rules_sync` is queued by the settings save door |

- **Main at handoff:** `b2567ab`. **Last migration on main:** `0551_recruiting_message_wording.sql`.
  The hiring chat merged 0550 and 0551 on 11/02 and is still active. **Check the NAME before taking a
  number**, including on open PR branches (`gh pr list`, then look for `supabase/migrations/` files in them).
- **Scorecard (`pnpm ads:readiness`):** Orchestrator L3, Budget guard L3, Security L1. The Publisher
  reads **L0 honestly**: its L2 is pinned (resume / faults / kill pause), and L1 has one gap left,
  **B2c** (creative + ad), which waits for C3 and C4. The other eight workers are at L0.
- **The publisher is deliberately NOT wired into `workers.createPaused`.** `created` moves a campaign to
  `paused`, where Launch is pressed, and a campaign with no ad has nothing to launch. B2c wires it.
- **Measured on Meta's pages this session:**
  - A custom location's radius is 0.63–50 mi. Employment needs ≥ 15 mi, with no age, gender or ZIP;
    a violation is error 2909035.
  - Forms need the Page token.
  - Rule money is in cents. `name CONTAIN` is a documented rule filter.
- Worktree `../FuelGuard-ads-b2a` holds this session's branches and may be removed.

## 2. Open questions and blockers (do not route around them)

- **Q-AD23 / Q-AD24**: unchanged, and the owner has not ruled on either (see the B2 handoff §2).
- **B4 is blocked twice** (found 11/02, recorded in the workflow's progress log):
  1. **Webhook signatures need the Meta APP SECRET.** `X-Hub-Signature-256` is an HMAC with the
     app's secret. There are **no `META_*` env vars** at all; the secret is owner track, Stage 2. So the
     webhook ships **fail-closed**: with no secret it answers 503 and counts the miss. The **hourly
     backfill** (lead by id with the Page token) needs no app secret and is the path that works first.
  2. **There is no `LeadSink` implementation.** It is recruiting's (D-AD17), and its tables come with
     D0. B4 must not be mounted before a sink exists, because a lead with nowhere to go is a lost lead
     (§4R Lead intake: "0 lost").

## 3. Next steps, in order (one PR each; split a step that passes ~500 lines)

| # | Step | Notes |
|---|---|---|
| 0 | Append "B3b merged (#1949, `b2567ab`)" to the progress log, in D0's PR | — |
| **D0** | **Recruiting's migration** (workflow §4 D0; plan §4.1) as the next free number, probably `0552` | Tables: `hiring_profiles(+versions)`, `recruiting_openings(+versions)`, `recruiting_leads`, `recruiting_contacts` (append-only), `lead_match_verdicts`, `lead_conversions`, `recruiting_ai_outputs`. RLS on, service-role only, `forbid_org_change()`. **First check what the hiring chat already built**: `hiring_profiles` or openings may exist under another name. Grep the migrations; deriving beats restating (CLAUDE.md "No workarounds"). In the same PR: `purge_applicant` purges a converted lead whole, `DRIVER_REASSIGNMENTS` + the merge-cascade list (memory `merge-driver-cascade-trap.md`), `scripts/table-modules.json`, the retention registry and `RETENTION_FORBIDDEN` for the append-only ones. Matrix `supabase/tests/*.test.mjs` printing `RESULT`: a purged applicant takes its lead conversion; a merge moves it; UPDATE/DELETE refused on the ledgers. **New tables are exempt from the two-merge rule; their first READER is not.** |
| **D1** | **`recruiting/leads`: the `LeadSink`** | `ingest_lead` RPC (UPDATE-or-INSERT, never a partial upsert, `lint:upserts`). Idempotent on (provider, platform_lead_ref). Dedupe: E.164 phone / lower-case email against leads, applicants and drivers. `leadMatch` verdicts (pure, shared). A paged, org-scoped queue read. `convert_lead` → applicant + `lead_conversions`. Ship it in a separate merge after D0 (the deploy window). Lives under `src/features`/`modules/recruiting` and must not import ads internals (`lint:boundaries`): ads hands it a `PlatformLead` through the interface only |
| **B4** | **Leads intake** | Split it: **B4a** the hourly backfill per live form (`GET /{form_id}/leads` with the Page token, FakeMeta endpoint joining with its first caller) → `LeadSink`. **B4b** the webhook: GET verify + POST HMAC over the RAW body, constant-time, 401 + a counter on a forged body, 503 with no `META_APP_SECRET`, Page subscribed to `leadgen`. §4R L2: forged signature, duplicate webhook, webhook lost (the backfill brings it), same person on two platforms, malformed phone, prompt injection in a free-text answer |
| then | B5 monitor, C1–C5 (+ `lint:agent-fixtures`, `pnpm ads:eval`), B2c, F1, D2, E1–E5 | As in the B2 handoff §3. B2c also moves the golden runner (7d) onto the simulator, so scenarios drive the real publisher instead of the scripted vendor |

**Honest calendar.** The owner asked on 11/02 for production readiness "in 2 days". They were told
that 2 days cover the Meta path on the fake, not all of Stage 1. Still left: C1–C5, D0–D2, B4, B5,
B2c, F1, E1–E5, the eval tooling, then Stage 2 (credentials, L4). The first real ad is still no
earlier than the day after L4. Say so again if asked; do not merge around a worker that has not
reached L3.

## 4. Traps hit this session (add to the earlier lists)

- **zsh does not word-split `$VAR`.** `shasum $F` with several paths in `F` hashes nothing, and
  `diff` of two identical errors reports "restored". Prove a mutation restore with an in-script
  `assert open(path).read() == orig`, which is the pattern in this session's scratch scripts.
- **`lint:ads-readiness` reads titles literally from source.** A test title with `\"` inside, or an
  `it.each` template (`"%s on …"`), must be pinned by its literal text or a prefix ending in `…`.
- **`lint:comment-claims`**: a comment naming `publisher.test.ts` must quote a real title in `"…"`.
- **A route that now calls `dispatchJob`** needs a `jobs` table in its test's recorder. In tests,
  `JOB_EXECUTION_MODE` is inline, so the handler runs in the request. `expectOrgScoped` then sees
  `runJob`'s by-id update of `jobs`; exempt `jobs` with the reason written beside it.
- **A mutant that survives because the fake always obeys** (the pause trusting Meta's 200) is fixed
  by teaching the fake the failure (`accepted_not_applied`) plus a test, never by dropping the mutant.
- **File budget:** `fakeMeta.ts` is split into `fakeMetaShapes.ts`, `fakeMetaForms.ts`,
  `fakeMetaAdSets.ts` and `fakeMetaRules.ts`. Put a new endpoint family in its own file the same way.
- **The IDE's TypeScript diagnostics go stale** after a `@silvicom/shared` export is added ("no exported
  member"). Trust `npx tsc --noEmit -p apps/api`.
- **Staging test members are not admins**, so the settings door (and so `ads_rules_sync`) cannot be
  walked on staging with them. Say that in the PR rather than claiming a staging check.

## 5. Owner track (unchanged, due Mon 11/09) plus one item

Meta setup ("Meta ready", never a token in chat), **including the app secret, which B4b's webhook
needs**. Higgsfield API key, TikTok developer app, X contact, brand kit + photos, the first opening,
spending values, presets P1–P5, counsel (G12 / Q-AD8), rulings on Q-AD23 / Q-AD24, and approval of
the next release (it carries A5 → B3b).

## 6. First action in the new chat

1. Read §0.
2. Confirm no ads PR is open (`gh pr list --search "Ads agent in:title"`).
3. Confirm main's HEAD and the last migration **by name**, and check open PRs for migration files.
4. Run `pnpm ads:readiness` and check it matches §1.
5. Read what the hiring chat built (`hiring_profiles`, openings, `purge_applicant`) and propose D0's
   table list in one short message, saying which tables already exist under another name. Then build D0.

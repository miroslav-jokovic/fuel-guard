# Handoff · 2026-11-04 (evening) · Ads agent, Track W (workers), part 2

**Paste this whole file into a fresh chat, starting with "You are Track W (workers)".** It continues
`HANDOFF-2026-11-04-ADS-STAGE1-TRACKS.md`. That file's §0 read-first list, §2 open questions, §5 traps, §6 owner track
and §7 working rules all still hold. This file replaces its §1 (position) and the first two items of its §3 (now
done). Track S (screens) is working in parallel in `../FuelGuard-ads-screens`; build nothing from that file's §4.

## 0. Read first, in this order

1. `CLAUDE.md` (root): hard rules, the release train, "No workarounds", the two-merge rule, the CI job names.
2. `HANDOFF-2026-11-04-ADS-STAGE1-TRACKS.md`: §0, §2, §3 items 3–6, §5, §6, §7.
3. `ADS-AGENT-BUILD-WORKFLOW.md`: §4 (Phase C, F, G step tables), §4R (levels), and the **progress log's end**. The
   newest Track W entries are B2c1, B2c2 and "the two halves Track S waits on"; the Track S ones are S1b, S1c and E1.
4. `ADS-AGENT-PLAN.md`: D-AD9 (image-to-image), D-AD12, §9 Q-AD28 (brand kit: built as the column), **Q-AD29**
   (which image a lead ad shows), Q-AD32/Q-AD33 (owner rulings: no owner-form intake; reconcile alert stays).
5. `pnpm ads:readiness`.

## 1. Position (11/04 evening)

| Step | PR | Merge | What |
|---|---|---|---|
| B2c1 | #2027 | `5613e11` | For each APPROVED creative × EN/ES: image upload (re-sendable, Meta answers one hash per set of bytes), ad creative (`link_data`: primary text, headline, APPLY_NOW → that language's form), ad PAUSED. **A form per language**: `naming.ts` form/ad names end `\|EN`/`\|ES`. Recipe **`platform_slots {primary_text, headline}`** (nullish, never an overlay slot; refused without it). **Q-AD29:** each ad shows the 4:5 (else 1:1) image; the 9:16 image waits for L4. |
| B2c2 | #2034 | `5c5687e` | **`createPaused` wired** (`platforms/meta/publishCampaign.ts`, approved creatives only, org-scoped reads, privacy = `WEB_APP_URL/privacy`). Intake (webhook, fetch, backfill) reads every language's form (`leads/formRefs.ts`, paths derived from `AD_NAME_LANGUAGES`). A dead connection on create → `failing` + `ads_token_expiring` (`alerts/connectionAlerts.ts`, shared with pause). **Publisher L0 → L2.** |
| Track S unblock | #2036 | `a84fb3c` | **`compose/decideCreative.ts`**: `ready → approved/rejected` only on an `ads_approvals` row (this org, this creative and campaign, the decision's kind, not withdrawn), only in `review`, compare-and-set, idempotent. **Compose reads `ads_campaigns.brand_kit_id`**: two kits per org are fine; the campaign names its kit; each creative records the kit's newest version. |

- **Main at handoff:** `ba294a0` (Track S's E1 #2037 merged after #2036). **Newest migration:** `0567_recruiting_carrier_questions.sql`. Confirm both
  **by name**; the hiring, leads and Track S chats merge all day.
- **Scorecard:**
  - **L3:** Orchestrator, Budget guard.
  - **L2:** Publisher, Copywriter, Art director, Checker, Renderer, Security.
  - **L1:** Monitor, Lead intake.
  - **L0:** Analyst, Outcome feed.
  - Security reached L2 with Track S's S1c launch door.
- **Worktree:** `../FuelGuard-ads-d1` (Track W only). Branch from `origin/main` per step: `claude/ads-<step>`.
- **Open ads PRs at handoff:** none on Track W's files. Track S's E1 (#2037, Settings › Ads control) merged as `ba294a0`.
- **Still inert everywhere.** `ADS_ENABLED=false`, so the tick runs under the brake, which nulls `compose` and
  `createPaused`. Every compose stops at the render ("no still model chosen yet (V4)") until V4 sets
  `HIGGSFIELD_STILL_MODEL` and its price. **That is correct**: no track "fixes" it with a model name.

### Owed to Track S, already said in the progress log and PR bodies

- **E2's preset editor** asks for `platform_slots` (primary text, headline: two copy slots, neither an overlay slot),
  as it asks for `overlay_slots`.
- **S1d's door** records the person's decision through `guard/approvals.ts` (it must learn `approve_creative` /
  `reject_creative` with a `creative_id`; Track S extends it), then calls `decideCreative` with that row's id.

## 2. Next steps (Track W), in this order — one PR each, ≤ ~500 lines

1. **Image-to-image from the kit photo (D-AD9)**, the old handoff's §3 item 3. Today:
   - the Art director picks `direction.reference` (a kit photo's sha256);
   - the visual check compares against it (`composeCreative.ts` ~l.134);
   - the RENDER ignores it: the header at `composeCreative.ts` ~l.33 says "NOT BUILT".

   Build it:
   - **Read the docs first.** Read `https://docs.higgsfield.ai` (the `.md` pages, as C3 did) for uploading an input
     image and passing it to a model. Cite each page and the read date in `fakeHiggsfield.ts`'s header, and mark
     every inference as OUR reading, as the existing header does.
   - **Fake and client.** Add the upload to FakeHiggsfield and to `higgsfieldClient.ts`.
   - **Render.** `render.ts`'s `RenderInput.params` carries the reference as the model expects. It must stay
     idempotent on (creative, attempt), and the upload must not repeat on a replay.
   - **Compose.** Pass the reference into the render (`queuedRender` → the `ads_render` job). Then delete the
     "NOT BUILT" line and re-measure Q-AD27's option (c) only if real renders exist (they won't before V4).
   - **Stop if** the docs do not document an image input for the still models we would use. Record it as a new
     Q-AD in plan §9 with candidates and a recommendation; don't guess an endpoint.
2. **F1 — Analyst** (the old handoff's §3 item 4): daily brief and cohort report.
   - Numbers come from the fold only (`adsReport.ts`).
   - Claude narrates through the A4 rail; every number in the narration is claim-checked, and "a planted number is
     refused" (§4 F1).
   - It is a new model worker: it joins `EVAL_WORKERS` and `lint:agent-fixtures`. Pattern: `workers/checker/`.
   - Analyst → L1/L2.
3. **Climb to L3** (the old handoff's §3 item 5): the Copywriter's set 10 → ≥ 40 (EN + ES; the owner rates it);
   Monitor and Lead-intake golden scenarios (`packages/ads-golden`); Renderer L3; Publisher L3.
4. **G-sec** (`/security-review` on A5, B1, B4, C3 and the API) and **G-runbook** (`ADS-RUNBOOK.md`).
5. **Housekeeping (small):** the flaky test in §3 below.

## 3. Traps learned this session (add to the old handoff's §5)

- **A CONFLICTING PR runs no CI at all.** `gh pr checks` says "no checks reported". It isn't Actions stalling: check
  `gh pr view N --json mergeable`, rebase, and force-push with lease.
- **Background-task "exit 0" can lie.** `cmd > log; echo exit=$? >> log` makes the task exit 0 even when `cmd`
  failed. Propagate it (`rc=$?; …; exit $rc`) and read the log's last line before you claim green.
- **`pnpm ci:local` can be stopped by Claude Code under memory pressure**, with "killed … low on memory". That is
  not a failure. Don't restart it unasked: report it, rely on the individual gates you ran, and let the PR's CI be
  the full run.
- **New flaky test:** `creative/brandAssets.test.ts`, "refuses a file that starts like a PNG but is cut short".
  - It failed once in CI shard 3 on #2036: sharp read a half-cut 200×200 PNG as `ready`.
  - It passed 20 of 20 in isolation locally and passes on main.
  - Re-run the job (`gh run rerun <id> --failed`) and say so in the PR, as with the OCR flake.
  - Worth a fix: likely libvips under the shard's parallel load. Make the cut deterministic, e.g. stop inside IDAT.
- **Q-AD numbers race.** Track S took Q-AD28 while Track W wrote one, so Track W's became Q-AD29. The leads chat
  has since used Q-AD32/33. Read the plan's §9 on `origin/main` right before you number a new question.
- **The test world:** `adsWorld` takes read-only `extraTables` and `storage` handlers (B2c2). Use them rather than
  hand-rolled recorders when a path reads tables the world doesn't model.
- **Mutation lesson, three times this session:** a survivor usually meant redundant code (delete it) or a fixture
  that bypassed the guard under test. Examples: a test that seeded no creative instead of a `ready` one, and a race
  fixture that ignored the update's `state` filter. Fix the fixture, not the mutant.
- **sed on BSD/macOS:** writing a TS file through a heredoc can leave escaped backticks (`\``) in comments. After
  writing, run `grep -c '\\\`' <file>`.

## 4. First action in the new chat

1. Read §0.
2. Confirm main's HEAD and the newest migration **by name**. Run `gh pr list --state open`: no other chat may have
   an open PR on `modules/ads/{workers,compose,creative,platforms,orchestrator,monitor,generations}`,
   `lib/anthropic.ts` or `packages/ads-golden`.
3. Check that `pnpm ads:readiness` matches §1.
4. Say in one short message how you will build image-to-image and what the Higgsfield docs say about an input image
   (or that they don't), then build it.
5. Each PR: a progress-log entry at the END of the workflow file (on a rebase conflict keep both, theirs first);
   mutation-prove every behaviour test; the root `pnpm typecheck` plus the full gates, checking `$?`; the four
   PR-template headings; merge when green; one line in memory `recruiting-ads-agent-position.md`.

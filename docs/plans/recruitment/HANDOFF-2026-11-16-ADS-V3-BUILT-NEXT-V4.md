# Handoff — ads and leads, second version: design quality built, video next (written 2026-11-16, evening)

You are continuing the build of the ads and lead-collection feature in Silvicom 360 (repo `FuelGuard`).
Step V3 (design quality) is built except two parts that wait on things only the owner has. Check §3 against
the code first (ten minutes), then continue in the order of §6.

## 1. What the owner asked for, in his words

- "we are at really low level regarding this agents, and design and automatization"
- "we have only image ads and no videos, we have design that will not be top of the class and it is little
  bit primitive, looks like AI is in rush to create ad without any research"
- "Settings pages look confusing"
- Four parts: "Silvicom 360 preview, Settings and full control · Agents in charge of research, planning,
  producing and pushing ads (controlled) on social media · Orchestration automated and Manual to be options ·
  Leads collection engine"
- Decisions must be proposed "based on real research and analysis and not on some assumptions".
- Goal: "100% complete and enterprise grade … top of the line modern and trending system and ads".
- 2026-11-15: "planing should be mandetory"; "We will test in staging in couple days when feature is 100%".
- 2026-11-16: "we will proceed with remaining work".

## 2. Read first

1. `docs/plans/recruitment/ADS-PLATFORM-V2-PLAN.md` — steps V1–V8; open questions **Q-APX7 to Q-APX11** in §5
   (with what was measured for each) and listed in §6. Ids are **D-APX / Q-APX**, a series of their own.
2. Memory: `ads-platform-v2-position.md` (updated 2026-11-16), `recruiting-ads-agent-position.md`,
   `ads-ad-look-position.md`.
3. Progress entries `docs/plans/recruitment/ads-progress/2026-11-16-*.md` — six: `1000-W-V3a`, `1300-W-V3c`,
   `1500-W-V3d`, `1700-W-V3e`, `1800-W-strategist-fixture`, `1900-W-V3f`. Add yours.
4. `ADS-AGENT-BUILD-WORKFLOW.md` §4R (readiness levels L1–L5).
5. Work state list `ads-platform-v2` (work_state_read).

## 3. State at handoff

- Main: `a1b5058` at the time of writing (other chats keep moving it). Last migration on main: `0620` (another
  chat's). The last ads migration is **`0619`**; staging has it applied. Staging serves main.
- **Nothing runs anywhere.** Ads are off on staging and production. No `ADS_*`, `META_*` or `HIGGSFIELD_*`
  setting exists on either. `scripts/ads-certifications.json` is empty; `HIGGSFIELD_STILL_MODEL` is `null`.
- None of the ads work is released to production.
- No ads pull request is open. Everything below is merged.

## 4. What was built on 2026-11-16

| PR | What |
|---|---|
| #2467 | Each brand kit photo says what it shows (truck, trailer, driver, yard, road); a kit with one photo is told its ads will repeat themselves. In the kit's JSON, no migration. `shared/ads/photoLibrary.ts` |
| #2468 | Migration **0619**: `ads_creatives.pairings` (jsonb) and `ads_copy_choices.picture` (1–5) |
| #2469 | Art director **`artDirector@7`**: told the pictures already directed for the same ad (`earlier_pictures`) and each photo's tags; a repeat is refused (`repeats_earlier_picture`). Recorded 24 of 24 on two passes |
| #2475 | **An ad is chosen from several pictures.** `budgets.pictures_per_creative` (default 3, 1–5). `compose/creativePictures.ts` (one picture), `compose/creativePairings.ts` (judge and rank), `shared/ads/adPairings.ts` (`rankPairings`, `PAIRING_TIE_MARGIN = 1`) |
| #2478 | The review screen shows the pairings an ad was chosen from and a person can use another (`AdsPairingRivals.vue`; the word-choice door takes `picture`) |
| #2481 | Strategist fixture `otr-many-facts` shaped as a real opening; Strategist re-recorded 8 of 8 twice |
| #2482 | Each ad as a Facebook feed post on the review screen (`AdsFeedPreview.vue`); one shared rule for what Meta is handed (`shared/ads/platformText.ts`), used by the publisher too |

**The road of every ad now:** words (three sets, ranked) → three pictures, each directed knowing the ones before
it → each picture that passes its check is paired with every set of words it can carry → the finished-ad judge
scores each pairing in the frame the picture was made for → the best becomes the ad, judged again in its other
format → review shows the winner, its rivals and the feed preview.

**Measured (fixture data, the owner's key):**

- The finished-ad judge asked four times about each of 16 ads: no total moved by more than 1 point of 20. Sound
  ads 16 to 18.25; ads with a planted weakness 10 to 15. Hence the one-point margin.
- One ad costs about $0.88 in model calls at three pictures, $0.34 at one, plus three renders against one.
- Meta's own pages (read 2026-11-16): feed headline 27 characters, text above the picture 50–150; Stories keep
  14 % top, 35 % bottom, 6 % each side clear. Of our recorded texts above the picture, 59 % (English) and 72 %
  (Spanish) run past 150. Headlines are fine (median 23).

## 5. What is true and easy to misread

- **At `pictures_per_creative` 1 an ad is made exactly as before V3**: same ledger keys, no `pairings` written.
  The 101 older compose tests pass unedited. A person's choice of words always makes one picture.
- **A one-point gap is never "better".** Pairings within one point of the best total are "As good"; among them
  the craft judge's rank of the words decides, then the order the pictures were made in. Do not show a score
  difference of one as a ranking anywhere.
- **The judge not running stops nothing.** Switched off or out of budget (a `standing` refusal) the rest are not
  asked; one failed or unreadable answer costs that one pairing only. A planted fault found the difference.
- **"Use these words" keeps the winning picture**, at that picture's own attempt (`choiceFor` in
  `composeCampaign.ts`), not picture 1.
- **Q-APX7, 8, 9 and 11 are built as recommended but not ruled.** Each is reversible: the count is a setting.
- **Q-APX10 is not built.** It needs a Copywriter recording (see §6 A).
- **The settings form has no field for `pictures_per_creative`** (like `candidates_per_creative`, it is carried
  through a save untouched). The number fields are V6's.
- **No real picture exists.** "The three pictures differ" is measured on the Art director's directions, not on
  images. No image model is chosen (Q-AD20).
- **The feed preview is our drawing**, and says so. There is no story frame on purpose: we send the feed image
  only (Q-AD29) and Meta does not document how it shows that in Stories.
- **Only the code refuses an ad without a plan.** The database migration is still owed one release after #2460.
- **The staging walk is deferred by the owner** until the feature is complete. Do not ask him to switch ads on.
- **A Copywriter prompt or starter-preset limit change re-records all 131 model fixtures**, the 60 starter sets
  among them, so the rating page must be rebuilt. Read its `ratings` and `starters` stores first (ArtifactData);
  never replace a page that holds ratings. It held none on 2026-11-15.

## 6. What to do next, in order

### A. Ask the owner first (two minutes of his time, and it orders the rest)
- **Q-APX10** — lower the starter presets' limit for the text above the picture to 150 characters?
  Recommended yes, and **before he rates the 60 copy sets**, because ratings of texts that are then shortened
  are wasted. If yes: change the five starter presets in `shared/ads/starterPresets.ts`, update the fixtures that
  carry those limits, record the Copywriter (131 calls, about an hour a pass, two passes, detached), rebuild the
  rating page.
- Q-APX7, 8, 9, 11 — confirm or change. Nothing waits on them.

### B. V4 · Video (the plan's next step, ~7 days)
Read the plan's V4 section first. Motion ad first (Q-APX4 ruled (c)): a finished still's picture becomes a
6–10 s vertical clip by image-to-video, our renderer draws the words as timed captions, joined with ffmpeg
(D-AD9 holds). Check before proposing numbers: whether ffmpeg is on the API's image, what a clip costs per
model on Higgsfield's own pricing page, and what Meta's page says for a video lead ad. A `video` creative kind
enters `CAMPAIGN_WORKERS` at L0. The driver clip waits on Q-APX5 (speech-to-text research, owed by Claude).

### C. Then, per the plan
V6 Ads workspace (V8 health page with it; the `pictures_per_creative` field belongs here) → V5 automation
modes → V7 lead engine.

### D. Small owed items, any time
- Whether the craft judge should rank by "does it carry the plan's idea" (a judge prompt change, its own
  recording). Would also settle the "proof" preset keeping the pay figure in the headline.
- The Researcher and the swipe file — V2's two remaining evidence kinds; no code yet.
- After the release that carries #2460: the migration holding "no `composing` without `plan_id`", with its
  PGlite matrix case.

### E. Left in V3, blocked
- **Meta's own preview and the story frame** — needs the Meta app and a sandbox ad account.
- **The judge's reference set** (Q-APX3) — needs 50 real approvals and rejections.

### F. What only the owner can unblock (nothing real runs without it)
- Meta: the app, a system-user token, a **sandbox ad account id**
  (`/silvicom/staging/api/META_SANDBOX_AD_ACCOUNT_IDS`), then `pnpm ads:certify` for L4.
- Higgsfield: the API key and the image model choice (Q-AD20).
- His rating of the 60 copy sets (https://claude.ai/artifact/KG1h65doetP92nctQvSvnx) — after Q-APX10.

## 7. Traps met on 2026-11-16

- **Worktrees share one `.git`.** Another chat's fetch moves `origin/main` between your rebase and your
  `git diff --stat origin/main HEAD`, so foreign files appear in the stat. Check the commit alone with
  `git diff --stat HEAD~1 HEAD`; if it is clean, rebase again.
- **Every commit, rebase and checkout runs the code-graph hook** (about 30 s, minutes when the machine is busy).
  Wait for `scripts/graphify-update.sh` to end before the next git command, or it looks like a hang.
- **A migration needs `supabase/schema.generated.sql` regenerated** (`node scripts/gen-schema-snapshot.mjs`) or
  the `lint:table-writers` gate fails on the snapshot alone.
- **A column and its first reader ship in two merges** (0619 went in #2468, its writer in #2475). Check
  `/api/version` on staging shows the migration applied before merging the reader.
- **Vue's ref proxy is not `===` to the object** (`picking === r` never matched); compare by fields.
- **`AppCheckbox` puts `data-test` on the input itself**, not on a wrapper.
- **The craft judge is shown the copies in its own order** (`presentationOrder`), so the craft rank is not the
  writer's order; a pairing's judge key uses `offered_as`, the stored pairing uses the index in `candidates.ranked`.
- **`ads:eval --only` cannot re-record one existing fixture**: the merged baseline must add up, so an input
  change means recording the whole set.
- **A full local API run can fail one unrelated test under load** (`inventoryUnits.test.ts` did once); run it
  alone before believing it.
- **rtk condenses command output** and garbles long lines; use `rtk proxy <cmd>` for anything read closely.
- **Looking in a browser found two faults the tests did not.** Recipe: `VITE_DEV_BYPASS=true node
  scripts/preview-local.mjs` from `apps/web` (read the port from the end of its log), Playwright resolved through
  `createRequire("<worktree>/apps/web/package.json")`, one route on `/(api|rest/v1|auth/v1|storage/v1)/` answering
  raw JSON. The scripts used are in the old session's scratchpad and may be gone; the recipe is enough.
- The traps of the 2026-11-15 handoff still hold (run an eval twice; record detached; refile planted fixtures
  under a new prompt version; mutants one at a time, restored in `finally`).

## 8. Commands that worked

```bash
# live eval or recording, from the worktree's apps/api (never read the .env file itself)
env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN node \
  --env-file=/Users/miroslavjokovic/Projects/FuelGuard/apps/api/.env \
  --import tsx src/scripts/adsEval.ts <worker> [--record]      # EVAL_SHOW=1 prints a disagreeing answer

# before every push
node scripts/ci-local.mjs --job gates,typecheck                 # add bundle, test-api, test-web, test-packages, matrices when touched
pnpm gen:ads-readiness && pnpm ads:readiness                    # after any registry or fixture change

# the suites the ads work touches
CI=true npx vitest run src/modules/ads src/queue                # from apps/api
CI=true npx vitest run src/ads                                  # from packages/shared
CI=true npx vitest run                                          # from packages/ads-golden
VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=ci-test-anon-key CI=true \
  npx vitest run src/features/ads                               # from apps/web
node supabase/tests/ads-foundation.test.mjs

# servers
curl -s https://staging-api.360.silvicominc.com/api/version
```

## 9. Housekeeping

- Start each piece on a new branch from `origin/main` in a new worktree; then `pnpm install --frozen-lockfile`
  and `pnpm --filter @silvicom/shared build:rn`.
- Worktrees holding only merged branches, safe to remove: `../FG-ads-v1b`, `v1c`, `v2a`, `v2b`, `v2c`, `v2d`,
  `v2e`, `v2f`, and today's `../FG-ads-v3a`, `../FG-ads-v3b`.
- PR flow: branch `claude/<topic>` from `origin/main`, PR, merge yourself when every check passes and none is
  pending. Title for an office reader; body follows the four headings of `.github/pull_request_template.md`.
- Recordings run on the owner's Anthropic key on the standing "recordings approved" ruling, fixture data only.
  Say what you are about to record before each one.

# Ads and leads, second version — four parts, a planning stage, video, and automation a carrier can set

**Started:** 2026-11-14. **Status (2026-11-18):** V1 to V4 built and merged, on simulators only; V5 to V8 not built. **Where it stands, what is left and the order from here: §0.** The audit behind §0 is [`ADS-PLATFORM-AUDIT-2026-11-18.md`](ADS-PLATFORM-AUDIT-2026-11-18.md).

**Authority.** The owner, 2026-11-14, after the audit of the same day: *"we are at really low level regarding
this agents, and design and automatization"*; *"we have only image ads and no videos, we have design that will
not be top of the class and it is little bit primitive, looks like AI is in rush to create ad without any
research"*; *"Settings pages look confusing"*; *"maybe we are using Opus 5.5 for some ads agents … or even Fable
5.2 for planning"*; and the shape he asked for: *"4 main parts: Silvicom 360 preview, Settings and full control ·
Agents that are in charge of research, planning and producing and pushing ads (controlled) on social media ·
Orchestration automated and Manual to be options · Leads collection engine."* Then: *"update our plan with
solutions you have proposed and we will start implementation as recommended and proposed"*, and for the open
decisions: *"proposals based on real research and analysis and not on some assumptions."*

**Reads with:** [`ADS-AGENT-PLAN.md`](ADS-AGENT-PLAN.md) (D-AD\*, the rulings this plan keeps or asks to change),
[`ADS-AGENT-BUILD-WORKFLOW.md`](ADS-AGENT-BUILD-WORKFLOW.md) §4R (readiness levels L1–L5),
[`ADS-AGENTS-AUDIT-2026-11-10.md`](ADS-AGENTS-AUDIT-2026-11-10.md) (F-AG\*, F-LR\*),
[`ADS-AD-LOOK-PLAN.md`](ADS-AD-LOOK-PLAN.md) (D-ADL\*), [`ADS-LEAD-INTAKE-PLAN.md`](ADS-LEAD-INTAKE-PLAN.md).

Decision and question ids here are **D-APX*n*** / **Q-APX*n*** (ads platform), a series of their own, so they
cannot race the D-AD / Q-AD numbers a parallel chat is taking.

---

## 0. Where it stands, and the order from here (2026-11-18)

Read this section first. §4's step texts are the record of what each step was meant to be and what was built;
this section is what is true today and what comes next. When the two disagree, this one is newer.

### 0.1 Built

| Step | State | Proven on |
|---|---|---|
| V1 any current model per agent | done | recorded fixtures, each agent's baseline met twice |
| V2 planning stage | done; V2r (2026-11-18): market pay from BLS, the swipe file's API, the Researcher and the Swipe reader at L2. The swipe file's screen built with V6 (Creative studio, 2026-11-19) | simulator; BLS read live once |
| V3 design quality | done, except the story frame, Meta's own preview and the reference set | simulator |
| V4 video (motion ad) | done; driver clip not started | simulator (FakeMeta, the simulated video model) |
| V8 health read (API) and token expiry (A-8, A-9) | built 2026-11-18: `GET /api/ads/health`; the token read daily with the reconcile, admins told 14 days before it lapses. Its page is V6's Automation tab | FakeMeta's `debug_token` |
| V6 workspace | screens built 2026-11-19: Ads is its own sidebar section (Q-APX18 (a)) with Overview, Campaigns, Creative studio (brand kit, presets, swipe file), Automation (the health read) and Settings; the two old addresses redirect | web tests; not yet walked on staging |
| V5 modes | built 2026-11-19: one enforced authority table, the steps and their modes, lowering a budget, Assisted start, the Automation tab; the agent's own lower ruled out until the canary (Q-APX23 (a)) | tests; not walked on staging |
| V7 lead engine | V7a–d built 2026-11-19 (#2576, #2577); Q-APX24–28 ruled (a) 2026-11-20; V7e next; Tenstreet and the apply page wait on their own answers | tests; not walked on staging |

Scorecard (`pnpm ads:readiness`): nine workers at L3, six at L2 (Copywriter, Art director, Craft judge,
Finished-ad judge, Checker, Strategist), **none at L4**. `scripts/ads-certifications.json` is empty, so Launch
refuses every real campaign. Ads are off on staging and production; no `ADS_*`, `META_*` or `HIGGSFIELD_*`
setting exists anywhere.

### 0.2 The three things no further building fixes

1. **Nothing has met a real vendor.** FakeMeta and the client were written by the same reader from the same
   pages; a misreading passes every test. Only the sandbox run (L4) finds it.
2. **No picture or video model is chosen** (`HIGGSFIELD_STILL_MODEL`, `HIGGSFIELD_VIDEO_MODEL` are `null`). How
   good an ad looks cannot be judged from the simulator's placeholder pictures.
3. **No agent's judgement has been compared with a person's.** The L2 agents wait on the owner's rating of the
   60 copy sets and on approvals and rejections of real ads and plans (Q-APX3).

All three wait on the owner: the Meta app (its id, `META_APP_ID`, and secret — the id is what reads a token's expiry,
A-8), a system-user token, a sandbox ad account id, the Higgsfield key, and
the rating page (https://claude.ai/artifact/KG1h65doetP92nctQvSvnx).

### 0.3 The order from here — proposed 2026-11-18, replaces §4's "V6 → V5 → V7"

| # | Work | Waits on | Why here |
|---|---|---|---|
| 1 | **L4 on Meta's sandbox** (`pnpm ads:certify`) and **the model sitting** (Q-APX12, Q-AD20). Fix what the sandbox refuses; move `META_GRAPH_VERSION` to v27.0 after reading its changelog | credentials | Everything else is built on readings only this can confirm |
| 2 | **The research (V2r): market pay from BLS, the swipe file, the Researcher** (V2's remainder; D-AD35, D-AD36) | built 2026-11-18, except the swipe file's screen (V6) | The owner's first complaint was ads made "without any research"; a first campaign's plan today rests on the job and one benchmark |
| 3 | **V8 health page and the Overview's read** (API), then **V6 screens** | Q-APX18 for the screens | Running a real campaign needs somewhere to see it |
| 4 | **Q-APX16 and Q-APX17** (budget in dollars; video at 1440 × 1800) | their rulings; the sandbox answers Q-APX17 | A real video cannot be bought or sent without them |
| 5 | **The canary (L5):** one real campaign, small cap, launched by the owner, 72 hours | 1 and 4 | The gate to any automatic launch (Q-APX1 Level B) |
| 6 | **V5 modes** — Manual and Assisted first; Level B after the canary; Level C stays locked | 5 for Level B | A mode switch for something not yet run once by hand has nothing to stand on |
| 7 | **V7 lead engine** — Tenstreet, the apply page, the score, the 15-minute alert, the report; Indeed when approved | Indeed's approval for Indeed | Independent of the ads; can run beside 3 to 6 |

### 0.4 What "finished" means, and what it cannot mean yet

The owner's goal (2026-11-18): a "100% production ready automated ads and leads system that will be reliable,
precise and secure", in two to three more days, with no assumptions, workarounds or shortcuts.

**The remaining steps do not fit in three days.** By this plan's own estimates V5, V6 and V7 are about 21 working
days, before the Researcher and the sandbox fixes; and three items are elapsed time nobody can shorten: the
canary's 72 hours, Indeed's approval of the employer, and the 50 real decisions that unlock Level C. Cutting a
step to make the date would be the shortcut the owner ruled out. What three days CAN hold is **Q-APX19** (§5).

"Automated" is reached by evidence, in the levels of Q-APX1: A (pause, lower, retire) is built; B (launch what a
person approved) opens after the canary; C (publish what nobody saw) opens only at 50 real decisions with the
judge agreeing at κ ≥ 0.8 and counsel's wording list complete.

---

## 1. What was measured on 2026-11-14

| Fact | How it was read |
|---|---|
| Production holds **0** ad connections, campaigns, creatives, AI generations, leads, brand kits, presets and settings versions. | Read-only count on the production database. |
| `scripts/ads-certifications.json` is empty, so `campaigns/launchCertification.ts` refuses every real launch, a sandbox one too. | File on main. |
| `HIGGSFIELD_STILL_MODEL = null` and the price table is empty: no real picture can be made. | `creative/higgsfield/prices.ts:10,19`. |
| Scorecard: nine workers at L3, five at L2 (Copywriter, Art director, Craft judge, Finished-ad judge, Checker), none at L4. | `pnpm ads:readiness`. |
| Six Claude workers, each one call in a fixed pipeline, all on `claude-sonnet-4-6`, because `callForcedTool` forces its tool and the newer models answer that with a 400. | `apps/api/src/lib/anthropic.ts:65,126`; claude-api skill, 2026-11-03 table. |
| Our Anthropic key can call `claude-fable-5-2`, `claude-opus-5-5` and `claude-sonnet-5-5` today: each answered 200 to a one-line message. | Three probe calls, 17 input tokens each, 2026-11-14. |
| No worker, compose or generation file reads a lead's name, phone or e-mail. | Search of `modules/ads/workers`, `compose`, `generations` for `full_name`, `phone_e164`, `email_lower`, `ssn`: no hit outside tests. |
| No video code, no research step, no strategy step. The only ad set goal sent is `LEAD_GENERATION`. | Search of `modules/ads` for `ffmpeg`, `video`; `platforms/meta/publisher.ts:172`. |
| Meta Instant Forms are the only lead source. No Indeed or Tenstreet listener, no phone lookup, no re-judging. | Search of `apps/api/src`. |
| Settings › Ads control is one page: kill switch, spend, accounts, brand kit, presets, then a form of about 25 number fields. Campaigns are one of eight tabs in Recruitment. | `pages/AdsControlPage.vue:53-58`, `features/ads/AdsSettingsForm.vue`, `RecruitmentTabs.vue:49-59`. |

**Not measured:** which settings the servers hold (`ADS_ENABLED`, the Meta secrets) — the AWS session had expired;
staging's rows.

## 2. What does not move

These hold in every step below. A step that needs one changed says so and waits for a ruling.

- **D-AD9** — the image or video model never draws a letter or a figure; our renderer composites every word.
- **Every figure in an ad is a figure of the brief** (`adClaims`), checked again at the renderer.
- **The budget guard is the only road to spend**; monthly cap in code, Meta's campaign spend cap, the account limit.
- **The kill switch**, and **D-AD8** (a non-production host talks only to a sandbox account with no payment method).
- **D-RA2 / D-LS6** — nobody automated makes the first contact with a lead.
- **§4R** — a worker launches nothing real below L4. Every worker this plan adds enters the registry at L0.
- **Illinois HB 3773 / D-LS** — hiring area is never a ZIP list; no agent is given a location to filter people by.

## 3. The four parts

```
 1 CONTROL (web)        Overview · Campaigns · Creative studio · Leads · Automation · Settings
        │ people approve, set modes, read results
 2 AGENTS               Researcher → Strategist → Producers (words · picture · video) → Critics → Publisher
        │ one job each, ledgered, budgeted, none spends or contacts
 3 ORCHESTRATION        the campaign state machine (`transitions.ts`) + a mode per step: Manual · Assisted · Autopilot
        │ rails of §2 enforced in code and in the database
 4 LEAD ENGINE          sources → store once → score → route to a recruiter → outcomes back to the platform
```

Parts 3 and 4 exist and are sound; they are extended. Part 2 gains its missing first half. Part 1 is rearranged.

## 4. The steps

Days are estimates, not measurements. **Order: V1 → V2 → V3 → V4 → V6 → V5 → V7; V8 rides with V6.** **Superseded 2026-11-18 by §0.3.**

### V1 · The AI rail takes any current model (~3 days + recordings)

- `callForcedTool` asks by the model's profile (`AI_MODEL_PROFILES`): a forced tool where the model accepts one,
  `tool_choice: auto` with one fixed sentence naming the tool where it does not. **Corrected 2026-11-14 (V1a):**
  not `output_config.format` — strict outputs refuse the `minLength` / `maximum` keywords the workers' schemas
  use. `stop_reason: "refusal"` is a named outcome that fails the ledger row; **no server-side fallback**, since a
  row names one model and a second model's answer would be recorded as the first's.
- One table, `AD_AGENT_MODELS`, names model and effort per agent; a carrier does not see it. **V1a built.**
- **A model change ships only when that agent's recorded baseline is met or beaten on the new model**
  (`pnpm ads:eval`, twice). Each recording runs on the owner's key and is asked for first, as before.
- Starting assignment, to be confirmed by those evals and not before: Strategist and Researcher on
  `claude-fable-5-2`; Copywriter, Art director, Video director and Checker on `claude-opus-5-5`; the judges on a
  model other than the writer's (F-AG7: today writer and judge are the same model); Analyst on `claude-sonnet-5-5`.
  **As measured (V1b, `agentModels.ts`):** the Analyst scored 13 of 14 on Sonnet 5.5, below its baseline, and stayed
  on Opus 5.5; the two judges are on Fable 5.2, the writers on Opus 5.5. The Checker is on the writers' model
  (audit 2026-11-18, finding A-7).
- Prices per million tokens (in/out): Sonnet 4.6 $3/$15 · Sonnet 5.5 $2/$10 · Opus 5.5 $4/$20 · Fable 5.2 $8/$40.

**Done when:** every existing worker's eval passes twice on its new model, and `lint:agent-fixtures` holds the
new prompt versions.

### V2 · A planning stage before any ad is made (~6 days)

The campaign machine gains a state `planning` before `composing`.

- **Evidence pack — built by code, never by a model.** The opening's brief; our own per-concept figures
  (`foldConcepts`); lead outcomes and close reasons per campaign; the benchmark defaults already in settings; a
  **swipe file** (a recruiter saves a competitor's ad as a picture with a note; the Checker's vision describes it);
  and pay figures read by web search held to an allow-list of sites. Every item has an id.
- **Researcher** — reads web pages into evidence items. It has no tool that writes anywhere, and what it fetches
  is data, never instruction (the same rule as Ask AI's).
- **Strategist** — one page, the **campaign plan**: who we are talking to, and five angles that differ in kind,
  each with a hook, a proof, a format (still, motion, driver clip, carousel) and the evidence ids it rests on. A
  plan with an angle resting on no evidence is refused by code.
- Stored versioned (`ads_campaign_plans`, new table, RLS on). A person approves or edits it in Assisted mode.
- Producers build from the plan's angles. Presets stop being the idea and become the look and the slots.
  **Built 2026-11-15 (V2c):** an approved plan decides which presets are made and in what order, and each
  creative's Copywriter is handed its angle's idea and proof and its Art director the idea (`writerAngle`).
- After 14 days the angle's results join the next pack.

**Done when:** on the simulator a campaign cannot reach `composing` without a plan, and every angle in a stored
plan cites evidence that exists.

### V2r · The research: market pay, the swipe file, the Researcher (~2 days; designed 2026-11-18)

V2 built the pack from what we hold (the job, our results, our leads, one benchmark). Audit A-5: two of its six
kinds, `market` and `swipe`, have no builder, so a first campaign is planned from the job and one benchmark. This
step builds both.

**What was read (2026-11-18).** `bls.gov` answers **403** to a server's request for its occupation pages (the
Occupational Outlook page and the OEWS page for 53-3032, both measured). The BLS public data API
(`api.bls.gov/publicAPI/v1/timeseries/data/`, no key: 25 requests a day, 25 series a request) answered the OEWS
series for heavy and tractor-trailer truck drivers (SOC 53-3032) for 2025: the nation's annual median $58,640,
hourly median $28.19, lowest tenth $40,140, highest tenth $79,380; Illinois's median $60,320; Texas's $56,290.
O*NET's local-wages page (`onetonline.org`, which states BLS as its source) shows the same figures, which is how
the datatype codes 13 (annual median), 08 (hourly median), 11 (10th percentile) and 15 (90th percentile) were
confirmed. CareerOneStop answers 403 as well.

- **D-AD35 · Market pay is read by code from the BLS API, never by a model and never by a web search.** A wage
  is a number in a published series; a model reading a wage page can misread it, an API row cannot. The state is
  the one the ad's area is centred in (`hereReverseGeocodeState`, the reader the fuel planner already uses); the
  items say so, because a 300-mile circle can cross states. Each answer is kept in `ads_market_wages` (one row a
  series and year, global, public data) and asked again after 30 days, so a hundred campaigns do not spend the
  keyless day's 25 requests. A failed read yields no market item and the plan is made without one — what the pack
  does not hold is said by its absence, as for leads — and the failure is logged.
- **D-AD36 · The Researcher reads only pages a person saved; it never searches and never follows a link.** V2's
  "web search held to an allow-list of sites" becomes: the list is the carrier's swipe file, and each entry is a
  page a recruiter chose. A page a model found by searching is a source nobody approved, and its ranking is not
  ours to cite. The fetch is code's: https on port 443 only, every address the host resolves to must be public
  (no private, loopback or link-local range), redirects followed at most three times with each hop checked the
  same way, HTML or plain text only, 2 MB and 10 seconds at most. The page's text is handed to the model as data
  in a field, never as instruction (the rule Ask AI keeps).
- **Every item the Researcher writes carries a verbatim quote, and code holds it to the page.** The quote must be
  found in the text that was fetched (spacing normalised, nothing else); every figure in the item's sentence must
  appear in its quote. An item that fails either is dropped and counted; a page with none left is "nothing could
  be read from it", shown on the entry. So an instruction planted in a page can at most produce a true quote of
  that page, attributed to it.
- **The swipe file holds pictures and pages.** A picture (a competitor's ad, saved with a note) is described by a
  vision call into what it leads with and what it shows, in the closed hook and scene lists the plan uses; a page
  is read by the Researcher. Both become evidence items with the entry's date, and items older than 180 days
  stay out of the pack.
- New workers (Researcher, Swipe reader) enter the readiness registry at L0 and are recorded on fixture pages and
  pictures, the size said before each recording.

**Built 2026-11-18** (progress `2026-11-18-1530-W-V2r-market.md`, `2026-11-18-1900-W-V2r-swipe-researcher.md`): all of the
above except the swipe file's screen, which is V6's Creative studio (Q-APX18 (a)). Researcher and Swipe reader at L2.

**Done when:** a campaign whose area is centred in a US state carries market items from BLS with the year; a
saved page yields items whose quotes are found in it and a planted page (a quote not on it, a figure not in the
quote, an instruction in its text) yields none of the planted ones; a saved picture yields one swipe item.

### V3 · Design quality (~6 days)

- **Make many, show few.** Per angle: three pictures and three sets of words; the finished-ad judge ranks the
  nine pairings; the person sees the winner and may open the rest. Today one render is made (F-AG3, F-AG6).
- **A reference set of the carrier's own choosing** (Q-APX3) is what the judge scores against.
- **Photo library.** The brand kit's photos gain tags (truck, trailer, driver, yard, road). Equipment angles start
  from a real photo; a kit with one photo is told it will repeat itself (F-AG5).
- **Preview as shown.** Each ad in a Facebook feed frame and an Instagram story frame, both languages.

**Built 2026-11-16 (V3a):** the photo tags and the one-photo sentence, in the kit's versioned JSON (no
migration). Nothing reads the tags yet: the Art director is told them with Q-APX8's prompt change, one recording
for both. **Measured the same day:** what make-many costs and how steady the judge is — Q-APX7 to Q-APX9.

**Built 2026-11-16 (V3c–V3e):** the Art director makes one ad's pictures differ; an ad is chosen from several
pictures by ranked pairings; the review screen shows the winner with its rivals and a person can use another.
**Built 2026-11-16 (V3f):** each ad as a Facebook feed post on the review screen, both languages, from the texts
and the image the publisher sends, with a sentence when a text runs past Meta's recommendation. **Open in V3:** the
story frame and Meta's own preview (Q-APX11, waits on the Meta account) and the reference set (waits on 50 real
approvals and rejections).

**Done when:** the review screen shows the winner with its rivals, and the preview frames match Meta's safe zones
measured on the sandbox. "Top of class" cannot be claimed before a real image model is chosen (Q-AD20).

### V4 · Video (~7 days)

- **Motion ad.** A finished still's picture becomes a 6–10 s vertical clip by image-to-video from the kit photo;
  the words are drawn by our renderer as timed captions and joined with ffmpeg (D-AD9 holds). Higgsfield's API,
  self-serve since 2026-09-16, lists Kling 3.0 near $0.11/s and Seedance 2.0 at $0.08/s: about $1 a clip.
- **Driver clip.** A recruiter uploads a phone video; it is trimmed, captioned and given an end card. Needs a
  speech-to-text provider (not chosen, Q-APX5) and a signed release from the driver (counsel).
- **Checks.** Sampled frames through the Checker; captions always; 15 s the limit; a `video` creative kind in
  `CAMPAIGN_WORKERS` with its own L-levels.
- **Publisher.** Video upload and a video ad on the same Instant Form.

**Read 2026-11-16, before any number was proposed (V4a):**

| Question | What was found | Where |
|---|---|---|
| Is ffmpeg on the API's image? | **No.** The image is `node:22-bookworm-slim` with no package installed on top; the only ffmpeg in the repository is the tutorial recorder's, which runs on a laptop. | `infra/image/Dockerfile` |
| What a clip costs | Per second, in dollars: Wan 3.0 "from $0.038", Wan 3.0 Prime "from $0.051", Seedance 2.0 $0.080 (shown at 480p), Kling 3.0 Turbo $0.105, Kling 3.0 Standard $0.107, Seedance 2.5 $0.118, MiniMax H3 $0.130, Kling 3.0 Pro $0.144, Happy Horse 1.1 $0.180, Kling 3.0 4K $0.315. Five seconds is $0.19 to $1.58. "From" prices are a model's cheapest mode; the page does not say what 1080p costs. | Higgsfield's pricing page |
| How a clip is asked for | One POST per model path (`bytedance/seedance-2.0/image-to-video`, `alibaba/wan-3.0/image-to-video`, `kling-video/v3.0/std/image-to-video`), the same submit / status / `video.url` shapes our client already speaks. Seedance: `image_url`, `duration` 4–15 (default 5), `resolution`, `generate_audio` (default **true**), and no aspect field — "Output framing follows image_url". Wan: the same plus `aspect_ratio` (16:9, 4:3, 1:1, 3:4, 9:16, adaptive — **no 4:5**) and `duration` 2–30. Neither page states frame rate, codec or pixel size. | The two models' own pages |
| What Meta asks of a feed video with the Leads objective | MP4, MOV or GIF; ratio 4:5; 1440 × 1800; H.264, fixed frame rate, progressive, stereo AAC at 128 kbps or more; captions and sound "optional, but recommended"; 1 second to 241 minutes; 4 GB. Text beside it as for an image: 50–150 and 27 characters. | Meta's Ads Guide |
| How a video lead ad is made | The video goes to the account's library first (`POST act_<id>/advideos`, `source` or `file_url`); the creative's `object_story_spec.video_data` carries `video_id`, `image_url` (the thumbnail) and the same `call_to_action` with `lead_gen_form_id`. The page states no processing-status field and no size limit of its own. | Meta's lead-ads and ad-video pages |
| How fast words over a moving picture can be read | "Up to 20 characters per second for adult programs". | Netflix's Timed Text Style Guide |

So the plan's "about $1 a clip" stands only for Kling; the two cheapest models put five seconds at $0.19 to $0.40,
and which of them draws a truck that still looks like the carrier's truck is not something a price page answers.
The questions these open are Q-APX12 to Q-APX15.

**Built 2026-11-16 (V4a):** the rule for when each line of a motion ad appears (`shared/ads/motionAd.ts`), pure
and tested, read by nothing yet.

**Built 2026-11-16 (V4b):** the renderer takes a still apart into a motion ad's layers (`renderMotionLayers`):
everything but the timed words on one transparent layer, each group of words on its own. It is the still's own
painting, so the picture and the layers put back together are the still to within 3 levels of 255 on every pixel,
in all three looks.

**Built 2026-11-16 (V4c), after Q-APX13 to Q-APX15 were ruled:** ffmpeg on the server's image and in CI's API test
job, and the join (`creative/motion/motionJoin.ts`): the model's clip, the layers and the still become one MP4 —
H.264, 1080 × 1350, 30 frames a second with every frame the same length, a silent stereo AAC track, no edit list,
the index in front. Later words fade in and rise 24 px over 0.3 s; the motion's last frame dissolves into the
approved still over 0.4 s.

**Built 2026-11-16 (V4d):** how a clip is asked of each of Q-APX12's three candidates, from each model's own page
(`creative/higgsfield/videoModels.ts`): the first frame, five seconds, sound turned off in that model's own field,
and never a shape — none of the three can be asked for 4:5, so the picture is cut to the frame before it is sent.
Five seconds is $0.19 (Wan 3.0, a floor), $0.40 (Seedance 2.0, a floor) and $0.54 (Kling 3.0 Standard) at the
page's figures. No model is chosen. **Open with Q-AD20:** the settings' monthly budget is in Higgsfield credits and
the pricing page speaks in dollars; how one becomes the other is read from the owner's account. Not built: sending
the request (`render.ts` stores images only), the check of the frames before the last (matters for `photo`), the
publisher's video road, the `video` kind in `CAMPAIGN_WORKERS`, the player on the review screen.

**Built 2026-11-17 (V4e):** the clip is asked for and kept, on the still's own render road (`render.ts`,
`creative/motion/motionClip.ts`). The picture is cut to the ad's frame by the function that frames the still and
uploaded once; the request is the model's own (`motionClipParams`); the answer's `video.url` is downloaded, read
with ffprobe and stored at `<org>/<sha256>.mp4`. The ledger row records what the model really returned — frame,
length, whether it carries sound — which no model's page states. A file that is not an MP4 fails the render at
its price; a server without ffprobe leaves it pending. Nothing queues such a request yet. **Not measured:** whether
five seconds from a real model fits the store's 15 MB an object (no real clip has been seen). **Found:**
Higgsfield's API has no credits — Q-APX16. Still not built: the check of the frames before the last, the `video`
kind, the publisher's video road, the player on the review screen.

**Built 2026-11-17 (V4f):** the contrast check of the frames before the last (`creative/motion/motionFrames.ts`).
The moving picture with our scrim, band and logo over it, and no word, is sampled every half second and on the
motion's last frame; under every line that has arrived, the pixels go to the still's own judge. A failing frame
refuses the motion ad, not the still. **Measured:** with a dark ground colour and white words the weakest scrim
step already keeps white at about 3.3:1 over a frame that is white edge to edge, and every row of today's looks
is large text (3:1) — so for such a kit no picture can fail it; the check decides for a kit with no ground colour,
a lighter ground, or words that are not white. **Found:** a clip shorter than was asked freezes on its last frame
rather than ending; nothing refuses that yet. Nothing calls the check yet.

**Built 2026-11-17 (V4g, V4h):** where a creative keeps its motion ad — `ads_creatives.motion`, migration 0625,
frozen with the rest of the content once the creative leaves the workers — and the function that makes one from a
finished still (`compose/creativeMotion.ts` `makeMotion`): the words are timed first, then ONE clip is asked on the
render road and serves both languages, each language's frames are checked, and each is joined and stored as its
own MP4. A clip more than a frame shorter than asked is refused, since the join would freeze it. How the picture
is told to move is one sentence of ours for every ad (`MOTION_DIRECTION`: a slow push-in, the truck stays the
truck); no agent writes it, and whether a model obeys it is the sitting's first reading. Nothing calls `makeMotion`
yet: it is wired into compose when 0625 is on main (column and first reader in two merges).

**Built 2026-11-17 (V4i):** compose sets a finished still moving when its plan angle's format is `motion`
(`composeCreative` `motionOf`, `angleFormat`): the winning pairing's picture under its words, after every check of
the still has passed, written to `ads_creatives.motion` with the still beside it. **Ours, to be ruled if the owner
reads it otherwise:** a motion ad that cannot be made does not take the still with it — the creative goes to review
as the still, and `checks.motion` says why there is no video. Not asked for a person's choice of words (its clip
would be bought twice). No plan can name `motion` yet (`PLAN_FORMATS_BUILT` is still `["still"]`), and no video
model is chosen, so on every server this is reached by tests only.

**Built 2026-11-17 (V4j):** the simulator's video model (`simulator/video`). On a simulator connection off
production a still is set moving with no Higgsfield key: the frame it was sent, pushed in 8 % over the seconds
asked, no sound — through the real render step, ledger, month's budget and storage copy, then the real frame check
and join. It proves nothing about any model. With it, the whole road of a motion ad up to the creative row runs on
staging; what it still cannot do there is be ASKED for, since no plan can name `motion` yet.

**Read 2026-11-17, for the publisher's video road:** Meta's "FB Video Ads" guide. A video reaches
an ad account in three calls: `POST act_<id>/video_ads` with `upload_phase=start` answers `video_id` and an
`upload_url` on `rupload.facebook.com`; the bytes are POSTed there with the headers `offset` and `file_size` (or a
`file_url`); `POST act_<id>/video_ads` with `upload_phase=finish` and the `video_id` ends it — "When you end the
upload session, the video is encoded and published to the ad account." Its state is read with
`GET <video_id>?fields=status`: `video_status` is one of `ready`, `processing`, `expired`, `error`, beside an
uploading, a processing and a publishing phase. The page's own samples disagree with each other on small things
(`complete` against `completed`; a processing error shown with `video_status` still `processing` and only an
`error.message` to say so), so a reader of that status must look for the error object as well as the words. The
older `advideos` edge (one POST with `source` or `file_url`), which V4a's table names, is still documented and
states no status field. **Not on any page read:** that a video must be `ready` before a creative names it, and
how its thumbnail (`image_url` in `video_data`) is obtained. The page's size rule is Q-APX17.

**Built 2026-11-17 (V4l):** the publisher's video road, on FakeMeta (`platforms/meta/publisherVideo.ts`,
`simulator/fakeMetaVideos.ts`). A creative that holds a motion ad is published as a video lead ad: each language's
MP4 goes to the ad account by the guide's three calls, the publisher waits until Meta says the video is `ready`,
and the creative carries `video_data` — the video, the same two texts, the same button and form. **Read
2026-11-17, and it settles the thumbnail:** Meta's Ad Creative Video Data reference lists `image_hash`, "Hash of an
image in your image library with Facebook to use as thumbnail", beside the `image_url` its guides' samples use. So
the thumbnail is the creative's own 4:5 still, which the image road already uploads and which is the motion ad's
last frame; no public address is needed for a file we keep private. The same pages put a video lead ad's link
inside the button's value, name the six button types for an image creative only, and say a system user may upload
to an ad account (not to a business). **How a retry is made safe:** a video has no name to be found by and Meta
gives no hash for one, so the ledger keeps the video id the moment the upload session opens, and a later attempt
asks Meta where THAT video stands — not uploaded, uploaded, encoding, ready, failed — and does only what is
missing. A finish whose answer was lost is not believed either way; the video's own status is. A motion ad missing
a language's file is refused before any call, never published as its still. **Ours until the sandbox says
otherwise:** the publisher waits for `ready` before making the creative (no page says it must), for at most
12 reads 5 seconds apart, then fails the step as `video_not_ready` and the next attempt waits for the same video;
how long Meta takes for a seven-second file has not been measured. The fake refuses a creative that names a video
still encoding, a second finish, and a file that is not an MP4 — each written as our reading in its header. It
does not measure the file's width: Q-APX17 stays the sandbox's to answer. **Found, not changed:** the pages read
today are headed v27.0 and the client calls v26.0. **Found and fixed:** a token revoked between a create and its
read-back came back as `readback_token_invalid`, a code the connection alert does not know, so no admin was told —
the same fault as the image upload's on 2026-11-05. In the contract suite as its own file, same two targets
(`publisherVideo.contract.test.ts`), with real MP4s. Not built: the `video` kind in `CAMPAIGN_WORKERS`, `motion`
in `PLAN_FORMATS_BUILT`, the player on the review screen.

**Built 2026-11-17 (V4n):** the video on the review screen (`AdsMotionAd.vue`, under each language's images). An ad
whose video was made shows a player for that language's file — its poster the ad's own feed picture, nothing
fetched until play is pressed — with its length, "no sound", and a line saying the ad is published as this video.
An ad whose plan asked for a video that could not be made shows one sentence saying so, with compose's reason
(`motionOpinion`, shared), and that the ad is the picture above: nobody approves a video they were not shown. A
still shows nothing. The campaign read hands out the video's short-lived link with the images', under the same
folder rule. **Not done:** the reason is compose's own sentence ("clip: price_unknown"), not yet office wording —
it joins the wording pass with `last_error`, which the screen shows the same way. Not looked at in a browser:
ads are off on staging, so no real creative holds a video to open.

**Built 2026-11-17 (V4m):** the `video` kind. A campaign is a video campaign when one of its APPROVED creatives
holds a motion ad; Launch reads that off the creatives (`creativeKindOf`) and asks the registry's `meta:video` row
which workers it uses. The row is a still's today, on purpose: the same Renderer makes the clip and the same
Publisher uploads it, so instead of a second name for half of a worker, each worker's own levels now carry the
video's needs — the Publisher's faults and contract suite for a motion ad, the Renderer's clip request, its faults
and its crash sweep (the clip is now the sweep's third kind of render: killed after each side effect and under
each transient fault, one charge, the stored MP4 is the bytes its name says). The certification run
(`pnpm ads:certify`) runs the motion-ad suite in the Publisher's run and in Security's, so a Publisher certified on
the sandbox is one that made a video ad there too. The kind has its own rows so that a worker only a video needs
(speech-to-text for the driver clip) is added there without holding back a still campaign. **Changed on the way:**
three test files that used to skip without ffmpeg now fail by name without it — a test the registry pins may not
be one that can be skipped. Publisher and Renderer stay at L3.

**The order from here (2026-11-17):** the publisher's video road comes BEFORE `motion` is added to
`PLAN_FORMATS_BUILT`. That list is what the Strategist is told can be made; the day `motion` is on it, a plan on a
real connection can name a video ad, and until the publisher can upload one, the ad Meta receives would be the
still under a plan that promised a video. When `motion` is added, it is offered only where the campaign's
connection has a video model, and the Strategist's 17 fixtures are recorded again in that step.

**Built 2026-11-17 (V4o):** a plan can name a motion ad — where its campaign can make one, and nowhere else.
`PLAN_FORMATS_BUILT` is now `["still", "motion"]` and means what a worker can make; what ONE campaign is offered is
`planFormatsFor` (shared), which gives `motion` only to a campaign with a video model. The API asks it once
(`plan/concepts.ts` `planOffer`), through the same `renderChoiceFor` compose hands `makeMotion` its video model
from, so the plan is offered a video exactly where compose would make it: a simulator connection off production.
Every real connection is offered a still alone until the sitting chooses a model (Q-APX12). That one answer goes
to the Strategist's sheet, to `checkPlan` at both doors of the store, to a person's edit and to the editor's
read; `checkPlan` no longer has a list of its own to fall back on. A replayed answer is held to the formats on
the sheet it was written from. **strategist@4:** the sheet lists each format with what it is (`PLAN_FORMAT_MEANING`,
the way a concept carries its meaning), so the prompt names no format; it says to choose from the angle's own
picture, forbids the claim that one format works better, and asks the plan to say that formats are unmeasured —
no page read measures a moving ad against a still for a driver lead ad, and the evidence pack holds no result by
format. "At least one angle stays in the first format" is ours. **Recorded:** the 8 openings again and 2 new ones
with a video on offer, 10 of 10 ready. With trucks on the road among the carrier's kinds, the plan made the road
and the view-from-the-cab angles motion and left the parked truck and the plain ground as stills; with nothing in
any picture that moves, it made one motion angle (arriving home) and called it a test. The review screen shows
how each idea is made and lets a person change it, only on a campaign with more than one format. **Not built:**
results by format in the evidence pack (nothing to read until a video ad has run).

**Done when:** a motion ad passes the contract suite on the fake, and Renderer and Publisher show L3 for
`meta:video`.

### V5 · A mode per step (~5 days; waits on Q-APX1)

A versioned policy in ads settings: step × mode. Steps: start a campaign for an opening, approve the plan, approve
an ad, launch, replace a tired ad, move budget between ads. What Autopilot may ever do is decided in §5.

### V6 · One Ads workspace (~8 days)

- Its own place in the sidebar: **Overview** (running, spent, leads, a "Needs you" list, the ledger as a
  timeline) · **Campaigns** · **Creative studio** (brand, concepts, photo library, swipe file) · **Leads** ·
  **Automation** · **Settings**.
- A five-step first run: connect Meta → brand → opening → budget → mode.
- Three presets — Careful, Balanced, Hands-off — each a full, valid settings version; the number fields stay,
  under Advanced. The presets' figures come from the benchmark the settings already cite (Boostpoint 2026).
- Follows `docs/DESIGN-SYSTEM-CONTRACT.md` and the UI-standardization rules; no new component where a shared one
  exists.

### V7 · The lead engine (~8 days + vendor approvals)

- **Sources through the existing `LeadSink`:** the Tenstreet feed (`TENSTREET-INTAKE-PLAN.md`, the guide is in
  hand); Indeed (Job Sync opened to direct employers 2026-07-31; Indeed asks for Indeed Apply and Disposition Sync
  and approves each employer); our own apply page.
- **A score on every lead:** fit (the existing verdicts), phone line type (LQ8b), returning person or current
  driver (LR2). Pure rules decide; no model does (D-LS2).
- **Speed to lead:** the uncontacted sweep gains a 15-minute first alert.
- **One report:** cost per qualified lead and per hire, by source and by angle.
- **Meta's qualified-lead goal** (`QUALITY_LEAD`, documented for Instant Forms): Meta asks for a CRM dataset, 200
  or more leads a month, daily uploads and 60 % lead coverage. At the $26.86 median that is about $5,400 a month,
  so the switch is offered only when a carrier's volume reaches it. Whether EMPLOYMENT accepts it stays Q-AD17.

#### V7 read at its call sites (2026-11-19), before anything was designed

What each of V7's five lines meets in the code today (main 431057018):

| Line | What is there | What is missing |
|---|---|---|
| Sources through `LeadSink` | One implementation (`recruiting/leads/leadSink.ts` `recruitingLeadSink`); callers are Meta's webhook fetch and the hourly backfill. A typed-in lead goes to `ingestLead` directly and rings nobody, by design. Pure facts readers exist for Indeed and Tenstreet (`facts/indeed.ts`, `facts/tenstreet.ts`) | No Tenstreet receiver, no Indeed listener, and **no public apply page that makes a lead**: `/apply/:token` is the invite a recruiter sends to an applicant who already exists (LEAD-SOURCING-PLAN §1: "There is no public open-apply link") |
| Score from pure rules (D-LS2) | The fit verdicts per requirement (`leadMatch`, stored append-only in `lead_match_verdicts`, shown as the Match column and the "does not qualify by their answer" lane); the returning-person and current-driver match (LR2, `recruiting_lead_matches` by phone or e-mail, never by name; `newLeadBell`) | **No phone line type**: `phone_lookups` (0583) is a table nothing writes; LQ8b's reader, its fake, its quota and its queue badge were never built. No one reading that puts the three together |
| 15-minute first alert | **Already built**: the `lead-uncontacted` sweep rings `lead_uncontacted` after `alerts.uncontacted_lead_minutes`, whose default is 15 (`ADS_SETTINGS_UNSET`), once per lead, to the carrier's list or the section's managers | Nothing for this line. The plan's other promise in that sweep — "a lookup miss is retried by the sweep" (LQ8b) — goes in with LQ8b |
| One report: cost per qualified lead and per hire, by source and angle | Cost per lead per campaign (`adsReport.ts`), per preset and language (`conceptPerformance.ts`); the stage reader `recruitingLeadOutcomes` (`qualified` = a recruiter's qualify, `hired` = `drivers.hire_date`), read for ad leads only | A lead knows its campaign (`campaign_ref`) but not its AD: Meta's `ad_id` is fetched and kept only inside `raw`. The publisher's own record (`ads_campaigns.platform_refs.ads[]`: Meta ad id → creative, language) and each creative's preset already say which angle an ad is, so the angle is DERIVED, not stored again. Spend exists for Meta alone |
| `QUALITY_LEAD` at 200+ a month | The Conversions API outcome feed (B6), off until a dataset id is set; the publisher sends `LEAD_GENERATION` | Whether an EMPLOYMENT campaign may use it is Q-AD17, answered only on Meta's sandbox |

**The order V7 is built in**, each one PR, each around its open question:

1. **V7a · Phone line type (LQ8b as written in ADS-LEAD-INTAKE-PLAN).** Telnyx Number Lookup after the store, once per
   number, re-read after 180 days; a fake Telnyx server in the tests; the daily quota; the miss retried by the
   uncontacted sweep; the typed-in lead's door; the queue's line-type badge. Flag, never filter (Q-AD62).
2. **V7b · The lead's standing (Q-APX24).** One pure function in shared over what is already read — the verdict
   summary, the line type, the matches — giving an ordered standing and its reasons in words. The queue sorts by it
   and the drawer says why.
3. **V7c · Which ad, which angle.** A lead's ad is read from `raw.ad_id` against the publisher's record; its angle
   from that ad's creative. Derived on read; no column (Q-APX25 if a column is ever needed for speed).
4. **V7d · The report (Q-APX26).** Leads, qualified, applied, hired, spend, cost per qualified lead and cost per hire,
   by source and by angle, for a chosen range, on the Ads Overview and as a read for the Analyst.
5. **V7e · The qualified-lead switch's readiness.** Shown, not offered: the carrier's last-30-day lead count against
   Meta's 200, the outcome feed's state, and Q-AD17's sandbox answer. The switch itself waits on Q-AD17.
6. **Tenstreet and the apply page wait (Q-APX27, Q-APX28).** Indeed waits on Indeed's approval, as before.

**Built 2026-11-19 (V7a, the number's line).** `recruiting/leads/phoneLookup.ts` asks Telnyx Number Lookup
(`type=carrier` only) after a lead is stored and rung — by the sink for a platform lead, by `POST /recruitment/leads`
for a typed-in one — and the uncontacted sweep's job asks again for the last week's numbers with no fresh row (at most
100 a run). Telnyx's documented answers decide what is stored: a 200 is folded to four words, a 422 (Telnyx will not
answer for that number) is stored as `unknown` so it is not asked every five minutes, and anything else — the
documented "Unexpected error", and the undocumented 401/404/429/5xx/timeout — stores nothing and is asked again.
"fixed line or mobile" folds to `unknown`. `TELNYX_LOOKUP_DAILY_MAX` (default 500, 0 = off) caps a carrier's
lookups per UTC day, counted from the table; with no `TELNYX_API_KEY` the lookup is off. The queue shows "Landline",
"Internet line" or "Number not valid" beside the number (a mobile, or a number not yet asked, shows nothing); the
drawer says it in words. **One departure from LQ8b as written:** it asked for a `lead_intake_failing` bell when the
ceiling is reached; that bell reads "Ad leads not arriving", which is not what happened, so the count is on the
sweep job's detail instead and no bell rings under a wrong name. Not yet: the wrong-number share by line type in
`LeadQuality` (it rides with V7d's report). Progress: `ads-progress/2026-11-19-2000-S-V7a-phone-line.md`.

**Built 2026-11-19 (V7b, the lead's standing — around Q-APX24 (a), recommended, not yet ruled).** Shared
`recruiting/leads/leadStanding.ts` (`leadStanding`, `compareLeadStanding`) over a queue row as it stands; nothing is
stored, so a ruling of (b) or (c) replaces one function and its two readers. The Leads page takes its "does not
qualify" lane from it and orders the rest of each page by it (the pages themselves stay by arrival — the queue's
cursor is by `received_at`); the Match cell shows "Check first" and the reasons, and the drawer says the same. The
bells are unchanged (`newLeadBell` already stays silent for a current driver and a failed requirement). Progress:
`ads-progress/2026-11-19-2100-S-V7b-standing.md`.

**Built 2026-11-19 (V7c and V7d, which ad and the report — around Q-APX25 (a) and Q-APX26 (a), recommended, not yet
ruled).** Recruiting gains a second interface beside `LeadOutcomes`, `LeadSources` (`everyLeadBetween`): every lead of
every source in a window, its channel, its campaign, and Meta's `ad_id` read from the lead's `raw` (`raw->>ad_id`,
digits only); the outcome feed and the brief still read ad leads only, through the same one reading. Ads maps the ad
through the publisher's record (`adRefsOf`) to its creative, and the creative's preset version to its concept
(`conceptPair`, the value plan angles are matched by). `GET /api/ads/report/leads?from=&to=` (recruitment view, as the
Overview; both route ledgers) answers by source and by angle: leads, qualified, hired, spend, cost per qualified lead
and per hire, for the leads that ARRIVED in the days and what they have reached so far, with the spend of the same days
— carrier days in the ads module's zone, at most 366. A source with no spend says "No spend recorded"; the total's
costs are withheld when any source with leads has no spend (Meta's money is never divided by Tenstreet's leads); a lead
whose ad is not in the record is "Ad not known", an ad whose preset names no concept "No angle named"; two currencies
in one range are refused rather than summed. Ads › Overview shows it as a card with its own date range. Not built:
`LeadQuality`'s wrong-number share by line type, and the Analyst's brief reading this report. Progress:
`ads-progress/2026-11-19-2200-W-V7cd-cost-report.md`.

### V8 · What makes it enterprise grade

Already on main: sealed tokens opened in one place, admin-only spend behind a fresh sign-in, two approvers above a
line, the kill switch, an append-only action ledger, a daily reconcile against Meta, route and log sweeps.

To add: a **health page** (last webhook, token expiry, failed jobs, cost and pass rate per agent); a retention rule
for leads that never convert; more than one Page per carrier; and — still the largest gap — the L4 runs on Meta's
sandbox, which wait on the owner's Meta app, sandbox account and Higgsfield key.

## 5. The decisions, with what was read for each

### Q-APX1 · May anything run with no person in between? — RULED (b), 2026-11-14

**What is ruled today:** Q-AD2 (2026-10-31) — a person launches; the agent may pause and lower on its own. D-AD12 —
a person sees every ad.

**What was read.**

- *Our own state.* No real ad has been made, no worker is at L4, and the finished-ad judge moves ±1 point between
  two runs on the same ad (ADS-AD-LOOK-PLAN log, 2026-11-11). There is nothing yet to calibrate an automatic
  approval against.
- *What other advertisers do.* WFA, September 2026, 46 brand owners: 96 % use generative or agentic AI in
  marketing, 75 % keep human oversight of its output, 57 % require a formal approval. An IAB survey of 125 ad
  executives, reported second-hand: 70 % have had an AI ad incident and 40 % paused or pulled spend over one.
  Ahrefs, September 2026, second-hand: 2.7 % of marketers trust AI content with no human review.
- *The law on a job ad.* The employer answers for the wording and for who is shut out: Title VII §704(b), ADEA
  §4(e); the EEOC's 2019 reasonable-cause findings against seven employers over Facebook job ads. Meta refuses an
  EMPLOYMENT campaign whose targeting breaks its rules at the API, which fences targeting — not wording.
- *What a wrong automatic act costs here.* A wrong **launch** costs money, and money is fenced three times and
  stopped by the kill switch. A wrong **ad** costs the carrier's name and a discrimination claim, and nothing
  fences that except the checks and a person.

**Proposal: (b) — automation by the kind of risk, not all or nothing.**

| Level | What runs alone | When |
|---|---|---|
| A | Pause, lower a budget, retire a tired ad. | Ruled and built. Lowering a budget was not built until 2026-11-19 (V5 part 2: a person lowers); **no rule lowers one on its own until the canary's data (Q-APX23 ruled (a)).** |
| B | Launch a campaign whose plan and ads a person approved, inside a monthly envelope an admin approved once. Turn on a person-approved replacement for a retired ad. | After the canary (L5). **Reverses Q-AD2 for this case only.** |
| C | Publish an ad no person saw. | Locked in code by a certification record, like Launch. Opens only at ≥ 50 real ads decided by a person with the judge agreeing at κ ≥ 0.8, counsel's wording list complete (G12), and one ad in ten still shown to a person afterwards. |

Every automatic act writes a ledger row, appears in the morning brief and has an undo; a cost spike, a Meta
rejection or a lead-quality alert returns the carrier to Assisted. Rejected: (a) no Autopilot ever — leaves the
owner's "automated and manual to be options" unmet; (c) full Autopilot now — no evidence yet supports it.

### Q-APX2 · Fable 5.2 keeps requests for 30 days — RULED (a), 2026-11-14

**What was read.** Fable and Mythos are Covered Models: Anthropic keeps their requests 30 days and does not offer
them under zero retention without its authorization. Thirty days is also Anthropic's standard for API traffic;
commercial API inputs and outputs are not used for training by default. **Our key already calls Fable 5.2 (§1)**,
so the account meets the requirement as it stands — there is nothing to switch on. And no ads worker reads a
lead's name, phone or e-mail (§1): the Strategist would be sent a job's facts, totals and pictures of ads.

**Proposal: (a) — accept, and make the second fact a rule.** A boundary test refuses any ads agent input type that
carries a lead contact field, so the answer stays true as agents are added. Driver clips are different: a face and
a voice go to a video and a speech provider, so that lane waits on a written release (counsel).

### Q-APX3 · Whose judgement the judge is held to — RULED (a), 2026-11-14

**What was read.** Practice for a model used as a judge: a set labelled by people, 50 to 200 items, 50 the floor
(Arize; Galtea accepts 30 well-chosen); agreement reported as Cohen's κ beside raw agreement, > 0.6 usable and
> 0.8 fit for production, with people agreeing with each other near 0.80 (arXiv 2510.09738, 1,994 items). Noise
from a single call is cut by voting over several (ELBench used nine). Ours: 16 fixtures, ±1 between runs, and the
owner's sheet of 60 copy sets (#2054) still empty.

**Proposal: (a) — the gold set is made by ordinary work, not by a sitting.** Every approve or reject on the review
screen is stored as a label with four 1–5 marks (the judge's own criteria). The judge answers by the median of
three calls. At 50 labels, with rejected ads among them, agreement is computed and shown; Level C of Q-APX1 reads
that number. Two raters where there are two (owner and one recruiter). The ten references in `data-samples/` and
the swipe file say what "top class" looks like; they are learned from, never copied. The 60-set copy sheet is
still owed — it is the only copy ground truth.

### Q-APX4 · Which video first — RULED (c), 2026-11-14

**What was read.** No measured comparison exists for driver recruiting. Vendors say a phone clip from the cab
beats polished video (O Trucking, CDL Jobs Linker, Leadgamp — claims without data); general sources disagree on
video against stills (cheaper impressions for stills, more engagement for video) and agree on mixing formats.

**Proposal: (c) — both, motion first.** Motion needs no person and no release, so it ships first; driver clips
follow when counsel's release and Q-APX5 are settled. `ads_ad_spend_hourly` already holds per-ad figures, so the
answer for this carrier is measured in its first month instead of taken from a vendor.

### Q-APX5 · Speech-to-text for driver clips — RULED (a), 2026-11-18

A driver clip (V4) needs its speech as text with the time of every word, in English and Spanish, to draw captions.

| | Price, recorded audio | Word times | Spanish | What they keep, as their own pages say |
|---|---|---|---|---|
| Amazon Transcribe | $0.006 a minute (US East), billed by the second, no minimum | "start time, end time, and confidence score for every word" | `es-US` and `en-US`, batch | "By default, Amazon Transcribe stores and uses voice inputs that it has processed to develop the service"; switched off by an AWS Organizations opt-out policy. Takes MP4. Transcript in our own bucket |
| Deepgram Nova-3 | $0.0043 a minute; $0.0052 multilingual | not stated on the pricing page | "60+ languages", Spanish not named there | Not on the page read; an opt-out (`mip_opt_out=true`) exists, its price not stated |
| AssemblyAI | $0.21 an hour ($0.0035 a minute); $0.15 for the older model | not stated for recorded audio | listed for its medical mode (EN, ES) | Not on the pricing page |
| OpenAI | $0.006 a minute (`gpt-4o-transcribe`, Whisper); $0.003 (`mini`) | not read | not read | not read |

For scale: a 60-second clip costs between a third of a cent and six tenths of a cent anywhere. A hundred clips a
month is under a dollar. **Price does not decide this.**

- **(a) Amazon Transcribe — recommended.** The servers and the storage are already on AWS, so the driver's voice
  goes to no new company and needs no new contract or key; every fact needed (word times, both languages, MP4 in)
  is stated on its own pages; the "used to improve the service" default has a documented switch, which is set
  before the first clip. It is the dearest of the four by a fraction of a cent.
- (b) Deepgram. The cheapest with a stated price for both languages, but a new vendor holding drivers' voices, and
  its retention terms are on a page not yet read.
- (c) Decide when the driver clip is built. It also waits on a signed release from the driver (counsel), so
  nothing is lost by waiting — but the release's wording should name where the recording goes.

Not read: Deepgram's and AssemblyAI's retention pages, OpenAI's terms and timestamps, how well any of them hears
a driver in a running cab. The last is a test on real clips, not a page.

Nothing in V4's motion lane waits on it.

### Q-APX6 · Is planning mandatory, or the carrier's choice? — RULED (b), 2026-11-15

**What was measured.** Every ads AI agent starts switched off in every carrier's settings (D-RA9), the
Strategist included, and production holds no saved ads settings at all (§1). The planning step refuses with "the
Strategist is switched off" when its switch is off.

**Why it is a question.** With planning unconditional, every new campaign would stop at that refusal on the day
planning shipped, until an admin found the switch — a change of behaviour nobody asked for by name.

- **(a) The carrier's choice — recommended, and what V2c built.** A campaign is planned only when the
  Strategist switch is on; off, it takes the road it took before planning existed. Nothing changes for anyone
  until the switch is turned on. A campaign that was planned waits on the Strategist's certification at Launch;
  one that was not, does not. Cost: two roads through the machine stay (`draft → plan`, `draft → compose`).
- **(b) Mandatory.** One road, and no ad without a plan. Cost: the switch must be on by default or every
  campaign stops, which reverses D-RA9 ("off by default") for this one agent.
- **(c) Mandatory once the Strategist is certified (L4).** (a) until then, (b) after. Cost: a behaviour change
  tied to a certification date rather than to a decision.

The owner's words — "looks like AI is in rush to create ad without any research" — argue for (b) or (c) as the
end state. (a) is the safe way to get there: it is one line to reverse (`plansFor` in `orchestrator/workers.ts`),
and the `draft → compose` row leaves the machine in the same merge.

### Q-APX7 · How many pictures and words per ad, and which pairings the judge ranks — RULED (b), 2026-11-16

**What was measured (2026-11-16, fixture data, the owner's key, nothing recorded).**

*What one call is billed* — three model fixtures per worker, mean tokens in / out, priced at V1's list prices:

| Worker (model) | Tokens in | Tokens out | One call |
|---|---|---|---|
| Copywriter (Opus 5.5), three sets of words in one call | 4,067 | 1,677 | $0.050 |
| Craft judge (Fable 5.2), ranks the three sets | 3,172 | 2,292 | $0.117 |
| Art director (Opus 5.5), one picture's direction | 3,438 | 418 | $0.022 |
| Checker (Opus 5.5), one picture in one format | 3,604 | 615 | $0.027 |
| Finished-ad judge (Fable 5.2), one ad in one format (64 calls) | 3,233 | 559 | $0.048 |

*How steady the finished-ad judge is* — each of its 16 model fixtures asked four times (64 calls). The total is the
four criteria added, 4 to 20.

| | Result |
|---|---|
| Largest movement of one ad's total across its four askings | **1 point** (8 ads moved by 1, 8 did not move) |
| Spread of one ad's total between askings (pooled standard deviation) | 0.31 |
| The 9 sound ads | totals 16 to 18.25 (standard deviation between ads 0.73) |
| The 7 ads with a planted weakness | totals 10 to 15 — none reached the lowest sound ad |

So one asking separates a weak ad from a sound one every time, and a gap of **2 points or more** between two sound
ads was never produced by chance in these 64 calls. A gap of **1 point is inside the judge's own movement**: it
must not be shown to a person as "this one is better".

**What an ad costs to make**, for a preset shown in both feed formats (4:5 and 1:1):

| | Model calls | Tokens | Pictures drawn |
|---|---|---|---|
| Today: 3 sets of words, 1 picture, 1 pairing judged in both formats | $0.34 | 31,000 | 1 |
| (a) 3 pictures × 3 words, all 9 judged in both formats | $1.26 | 116,000 | 3 |
| **(b) 3 × 3, the 9 judged in the frame the picture was composed for; the winner then judged in the other** | **$0.88** | **86,000** | **3** |
| (c) 3 pictures judged with the best words, then the best picture with the other two words (5 judged) | $0.68 | 71,000 | 3 |
| (d) 2 pictures × 3 words, as (b) | $0.66 | 62,000 | 2 |

A campaign of five ads under (b) is about **$4.40 and 430,000 tokens** against $1.70 and 155,000 today, and 15
pictures against 5. What a picture costs is not known until an image model is chosen (Q-AD20). For scale: the
settings' own benchmark puts one lead at $26.86.

- **(b) — recommended.** The full nine are judged, because "do the words and the picture tell one story" is one of
  the judge's four criteria and is exactly what (c) assumes away. The other format is the same picture cut shorter
  with the same words, so judging all nine twice (a) costs over 40 % more for an answer the first frame already
  gave; the winner is still judged in every format it is shown in, as today.
- (c) is 20 % cheaper and cannot find a pairing where the second-best words suit the second-best picture best.
- (d) saves a picture. With three the person still has a choice when one picture fails its check.

**How the winner is named, from the measurement.** Highest total wins. Pairings within 1 point of it are shown as
"as good", not as worse, and among those the order is the craft judge's rank of the words, then the order the
pictures were made in. The numbers are settings a carrier does not see at first (`pictures_per_creative`, default
3, beside the existing `candidates_per_creative`); the monthly token budget still refuses a call it cannot pay for.

**Kept from Q-AD76:** the finished-ad judge stays an opinion and never a gate. Ranking chooses what a person sees
first; it refuses nothing, and every rival stays one click away.

**Built 2026-11-16 as (b), ahead of the ruling** (V3d; the number is a setting, so a different answer is a number
and not a rebuild). `budgets.pictures_per_creative`, default 3, 1 to 5. At 1 an ad is made exactly as before:
one picture, the first words that fit, the same ledger keys, nothing new stored. Above 1: each picture is directed,
rendered and checked in turn; every picture that passes is paired with every set of words it can carry; the judge
scores each pairing in the composed frame; `rankPairings` orders them with the one-point margin above; the first
becomes the ad and is then judged in its other formats. A picture that cannot be used is dropped with its reason and
the ad is chosen from the rest; the creative stops only when none can be used. All renders are queued before the
step waits. Q-APX9 is built as (a): one image per pairing.

### Q-APX8 · What makes the three pictures of one ad differ — RULED (a), 2026-11-16

**What was read.** `artDirector.ts` and `composeCreative.ts`: one direction is asked per ad, keyed by ad and attempt.
Asked three times with the same input the Art director would give three near-copies — same kit photo, same
viewpoint — and the three renders would differ only by the image model's chance.

- **(a) One call per picture; each later picture is told what the earlier ones chose — recommended.** The second
  and third are handed the first's kit photo, subject and camera distance and asked to differ in at least the photo
  (where the kit has another) or the viewpoint. The photos' new tags go with their labels. The answer's shape and
  every existing check on it (`judgeArt`) stay as they are; each direction has its own ledger row. Cost: a prompt
  change (`artDirector@7`), so its 19 model fixtures are re-recorded and new ones added — about 50 Opus calls for
  the two passes, near $1.
- (b) One call that returns three directions. One fewer call; a new answer contract, and one refused direction
  refuses all three.
- (c) Three calls with nothing shared. No prompt change, and no real difference between the pictures.

**Built 2026-11-16 as (a), ahead of the ruling** (`artDirector@7`, V3c): it costs nothing to undo — an ad's first
picture is asked exactly as before, and nothing asks for a second until the compose step does. Measured on two
passes: 24 of 24 both times (19 fixtures from before, 5 new). In the new ones the model started the second and
third pictures from kit photos no earlier picture had used; with one photo it kept it and changed the hour and the
side the cab is seen from; on a flatbed job with a flatbed photo and a reefer photo it stayed on the flatbed.

### Q-APX9 · What is kept of the pairings that did not win — RULED (a), 2026-11-16

**What was read.** A finished ad is stored as one PNG per format and language (`CreativeAsset`): four files for a
two-format preset. Nine pairings kept the same way are 36 files per ad and 180 per campaign of five, in the same
bucket whose size and backup are already a recorded concern.

- **(a) The winner as today; each rival as the one picture the judge saw — recommended.** One English image per
  rival, in the judged frame, with its scores. The overlay is drawn by our own code from the stored picture and the
  stored words, so a rival a person picks is drawn again in every format and language at that moment (the way
  "Use these words" already rebuilds an ad on its kept picture). 4 files + 8 small ones per ad.
- (b) Everything for every pairing. Nothing is redrawn on a pick; nine times the storage for ads nobody opens.

### Q-APX10 · The text above the picture is longer than Meta recommends — RULED (a), 2026-11-16

**What was read (2026-11-16).** Meta's own page for a Facebook feed image ad: "Primary Text: 50-150 characters",
"Headline: 27 characters". For Instagram Stories: "Primary Text: 125 characters". These are recommendations: Meta
accepts longer text and shows only its start until a person taps "See more". Neither page says where it cuts.

**What was measured.** Every text the Copywriter has on record for a preset that names the two texts beside the
image (120 fixtures, 360 texts per language, `copywriter@5`):

| | English | Spanish |
|---|---|---|
| Headline under the picture: median, longest, over Meta's 27 | 23, 31, 3 of 360 | 23, 29, 2 of 360 |
| Text above the picture: median, shortest, longest | 156, 82, 231 | 171, 87, 239 |
| Text above the picture over Meta's 150 | **214 of 360 (59 %)** | **260 of 360 (72 %)** |

The headline is fine. The text above the picture is not: most of what we would send is longer than Meta
recommends, and the five starter presets allow it — their limit for this text is 240 to 300 characters.

- **(a) Lower the starter presets' limit for this text to 150 — recommended.** The Copywriter writes to the limit
  it is given, so no prompt changes; the 120 fixtures that carry a starter preset's limits are updated and the
  Copywriter recorded again (131 calls, about an hour a pass, two passes). **This should be decided before the 60
  copy sets are rated:** the rating page shows these texts, and ratings given to texts that are then shortened are
  ratings of something that will not run. The page holds no ratings today.
- (b) Keep the limits; the review screen says when a text runs past Meta's figure (built, V3f). Costs nothing now;
  most ads go out with their last sentence behind "See more".
- (c) 125, Stories' figure. Our ads are not sent to Stories with their own image today (Q-AD29).

**Built 2026-11-16 as (a), after the ruling.** The five starter presets read their limit from `META_FEED_TEXT`;
121 Copywriter fixtures carried a limit over 150 (the 60 starter sets and 61 others) and now carry 150; the prompt
is unchanged (`copywriter@5`). Recorded on the owner's key: 131 of 131 ready. Measured on the new recordings, 363
texts per language: English median 101, longest 120; Spanish median 106, longest 124; **none over 150** (before:
59 % and 72 %). The writer is told to write to about three quarters of a limit, which is why the longest is 124
and not 150. The rating page was rebuilt from these recordings (60 sets, 173 candidates shown, 7 refused by the
checks and not shown); both of its stores read empty before it was replaced.

### Q-APX11 · The Instagram story frame, and Meta's own preview — RULED (a), 2026-11-16

**What was read.** We send each ad with one image, the feed image (4:5, else 1:1): a lead ad takes one image, and
giving each placement its own waits on Q-AD29. Meta's Stories page gives the margins for a 9:16 image (14 % top,
35 % bottom, 6 % each side; our renderer keeps 15 / 36 / 8) and does not say how a 4:5 image is shown there.

So a story frame drawn by us would be a guess, and V3's "preview frames match Meta's safe zones measured on the
sandbox" cannot be met without the sandbox.

- **(a) Our feed drawing now; Meta's own preview when the account exists — recommended.** The feed frame is built
  (V3f) and says it is a drawing. Meta's Marketing API returns its own preview of an ad for each placement (feed,
  Instagram feed, Stories) as a frame to embed; once the Meta app and a sandbox account exist, the review screen
  shows that beside ours, and the story frame is Meta's, exact. No story frame is drawn until then.
- (b) Draw a story frame now from the 9:16 margins. It would show an image we do not send.

### Q-APX12 · Which model sets the picture moving — RULED (a), 2026-11-16; the sitting waits on the Higgsfield key

**What was read.** The table in V4. Ten image-to-video models, $0.038 to $0.315 a second. The pages give the request
fields and not the result: none says how far the model keeps the first frame's truck, its paint or its lettering.

- **(a) Measured on the owner's key, with the still model, as one sitting — recommended.** The same three kit
  photos through Wan 3.0, Seedance 2.0 and Kling 3.0 Standard at five seconds: 15 seconds a model, about $0.60,
  $1.20 and $1.60, under $4 in all. Judged by the owner on one thing first — is it still our truck — then on
  motion. `HIGGSFIELD_VIDEO_MODEL` stays `null` until then, as `HIGGSFIELD_STILL_MODEL` does (Q-AD20), and a motion
  ad on a real connection stops with "no video model chosen yet".
- (b) The cheapest by the page. Costs nothing to decide and may put a truck on screen that is not the carrier's.

Waits on the Higgsfield key.

### Q-APX13 · What a motion ad is, second by second — RULED (a), 2026-11-16

**What was read.** Meta's page (4:5; captions recommended; nothing on length beyond 1 second to 241 minutes); the
models' default of five seconds; Netflix's 20 characters a second. No published figure was found for how long a
finished ad should stay on screen at the end, or for the shortest time a line may show.

- **(a) Five seconds of motion under the still's own words, arriving one group after another, then the finished
  still held — recommended, and what V4a's rule computes.** The headline is on the first frame; the supporting
  line arrives when the headline has had its reading time (characters ÷ 20, one second at least); nothing leaves;
  the last frame is exactly the still a person approved, held two seconds, longer when the words need it. With our
  median headline (23 characters) and a 40-character supporting line that is 7 seconds. More than 15 is refused.
  The equal-opportunity line and the logo are on every frame.
- (b) Words that replace each other, as subtitles do. Shows more text; the last frame is then not the approved ad,
  and every intermediate frame needs its own contrast check.

**The one second and the two seconds are ours, with nothing published behind them.** They are settings of the rule
(`MOTION_MIN_CUE_MS`, `MOTION_HOLD_MS`), to be looked at on a real clip before they are believed.

### Q-APX14 · How ffmpeg reaches the server — RULED (a), 2026-11-16

- **(a) Debian's own package in the image (`apt-get install --no-install-recommends ffmpeg` in
  `infra/image/Dockerfile`) — recommended.** The distribution's build, patched with the base image; it carries the
  H.264 and AAC encoders Meta asks for. Cost: the image grows (size to be measured in the PR that adds it) and the
  join runs on the worker's CPU — a 7-second 1080 × 1350 encode, measured there before it ships. CI's test job
  installs the same package, so the join is tested against the encoder that will run it.
- (b) An npm package that downloads a static binary at install. No image change; a binary from a third party's
  release page, fetched by an install script, on a server that holds ad tokens.
- (c) Encode elsewhere (a hosted service). A second vendor and the picture leaves our storage again.

### Q-APX15 · Sound — RULED (a), 2026-11-16

**What was read.** Both models make sound unless told not to (`generate_audio` defaults to true). Meta: sound is
"optional, but recommended"; a feed video starts muted.

- **(a) No generated sound; a silent stereo track — recommended.** A model's sound is content nobody wrote and
  nothing of ours checks: it can put a voice or a horn on a carrier's ad. `generate_audio: false` is sent, and
  the file carries the silent AAC track Meta's settings name. Licensed music is its own question later.
- (b) The model's sound, listened to by a person at review. One more thing to approve on every ad, with no check
  behind it.

### Q-APX16 · The picture budget is in a unit Higgsfield does not have — RULED (a), 2026-11-18

**What was read (2026-11-17).** Four of Higgsfield's pages: pricing, "Billing and retention", "Requests", and
"Usage and billing". The word "credits" is on none of them. Prices are dollars a second; the account holds funds
in dollars; the usage report answers `"currency":"USD"`. There is a price call: `POST /estimate/<model>` with the
request's own parameters answers `{"usd":"0.094"}`, and the page says to "use the estimate returned for your
authenticated account as the authoritative amount". No page names a field that reports what a finished request
cost, and no balance call is documented.

Ours: the setting is `higgsfield_credits_monthly`, shown as "Picture credits a month"; the ledger's `cost_unit`
allows `tokens` and `credits`; `HIGGSFIELD_CREDIT_PRICES` is an empty table waiting for credits per model. So the
question the earlier handoffs carried — "how do dollars become credits" — has no answer to find: on the API there
is nothing to convert to. (Credits are the unit of Higgsfield's consumer plans, which is where the name came from.)

- **(a) The budget becomes dollars, and each price is asked, not kept in a table — recommended.** The setting
  becomes a monthly amount in US cents; before a request's row is written the render asks `/estimate` for that
  model and those parameters and writes the answer on the row, so the month is counted in what the account is
  really charged and a price change on their side cannot make the budget lie. Cost: a migration (`cost_unit`
  gains `usd`; the settings version gains the new field, with the two-merge rule for its first reader), the
  settings form's field and wording, `creditGate` and the spend view. About two days. It needs the owner's key
  only to be CERTIFIED, not to be built: the fake can answer `/estimate`.
- (b) Keep "credits", and define one credit as one cent. No migration, but the screen would show a word the
  carrier's Higgsfield account never uses, and the price table would still be typed by hand from a pricing page
  that marks two of the three video prices as floors.
- (c) Leave it until the sitting. Nothing breaks meanwhile: with no price, every real render is refused
  `price_unknown`, which is today's behaviour. But the sitting would then choose a model with no way to hold it
  to a budget.

Until this is ruled no video model has a price and a clip on a real key is refused before any call.

**Built 2026-11-19.** Migration 0634 lets the ledger write `usd` (#2558, one merge ahead of its writer). The
settings gain `higgsfield_usd_cents_monthly`; `higgsfield_credits_monthly` is read by nothing and stays, defaulted,
for one release so a version saved now parses on the code it replaces. Every render asks `POST /estimate/<model>`
with its final parameters (the photo's URL included, so the free upload comes first) and writes the answer on the
`started` row; `renderGate` counts the month in hundredths of a cent, exact. The price table is gone, and so is
`price_unknown` before a row: an estimate Higgsfield refuses is a failed row at no cost. Progress:
`ads-progress/2026-11-19-1100-W-QAPX16-dollars.md`.

### Q-APX17 · Our video is 1080 pixels wide; Meta's video-ads page says 1,200 at least — RULED (a), 2026-11-18

**What was read (2026-11-17).** Meta's "FB Video Ads" guide (Marketing API), which the pages read on 2026-11-16
did not include. It gives, for a video uploaded to an ad account: "MP4 (recommended)"; aspect ratio "16:9
(Landscape) to 9:16 (Portrait)"; **"Minimum width: 1200 pixels"**; "Frame rate: 24 to 60 frames per second";
H.264, 4:2:0, a closed GOP of 2 to 5 seconds, fixed frame rate, progressive; AAC at 128 kbit/s or more, stereo,
48 kHz. The Ads Guide read on 2026-11-16 recommends 1440 × 1800 for a 4:5 feed video and states no minimum.

Ours: the join writes 1080 × 1350 — the still's own size, because the still's layers are painted at 1080
(`FORMAT_SIZE`). Everything else on the list is already what the join writes (H.264, yuv420p, 30 frames a second
fixed, a key frame every 2 seconds, AAC 128 kbit/s stereo 48 kHz).

Whether Meta REFUSES a 1080-wide video or only advises against it is not on either page; only the sandbox says.

- **(a) Paint the motion ad at 1440 × 1800 — recommended.** The size Meta's own Ads Guide recommends, above the
  1,200 minimum, and 4/3 of today's — so every measure of the layout scales by one number. The still stays 1080
  (an image's rules are another page's). Cost: the overlay's layout takes a scale for a motion ad's layers; the
  join, the frame check and their tests take the size from one place; goldens for the larger layers. About a day.
  The file grows by roughly 1.8 times; whether it still fits the store's 15 MB an object is measured then.
- (b) Scale the 1080 file up to 1440 in the join. No layout change, but letters painted at 1080 and stretched are
  softer than letters painted at 1440, on the one part of the ad that is ours.
- (c) Leave 1080 and let the sandbox answer. Free today; if Meta refuses, it is found on the first real upload.

Nothing is changed until this is ruled. It must be settled before the publisher's video road is certified (L4).

**Built 2026-11-19.** `MOTION_SCALE` (4/3) and `MOTION_SIZE` (1440 × 1800) in shared `motionAd.ts`. The motion ad is the
still's OWN layout, painted at 1440 through the canvas's transform — not laid out again at 1440. Measured that day: a
line is 1,280.53 px scaled and 1,280.41 px set at the larger size, so a second layout could wrap or step down
differently at a line's margin and the video would end on an ad nobody approved; drawn through the transform it is
as sharp as text set at that size (8,561 soft edge pixels against 8,574), where the 1080 painting stretched has
24,321. The size of a line is still judged on the 1080 frame (WCAG's "large text" is how large it looks; judged in
1440 pixels an 18 px line would pass at 3:1), and contrast is read in the 1440 frame's own pixels. The join, the
frame check and the words' rise take the size from one place. The picture sent to the video model stays the still's
1080 cut: those are the approved ad's pixels, and no candidate model's input limit has been read. **Measured, the
file:** 2.8–5.9 MB for 7–15 s of a photo pushed in; a clip of fresh noise every frame, 135–175 MB — so the join
now refuses a file over the 15 MB store limit by name (`too_large`), where before it threw at the store. Q-APX20.
Progress: `ads-progress/2026-11-19-1300-W-QAPX17-1440.md`.


### Q-APX18 · Where the Ads workspace sits, and what moves into it — RULED (a), 2026-11-18

**What was read (2026-11-17), in the code and the earlier rulings.** Ads live in two places today:
`/recruitment/campaigns`, the seventh tab of the Recruitment page (`RecruitmentTabs.vue`), and
`/settings/recruiting/ads`, one Settings page holding six cards — kill switch, spend, ad accounts, brand kit,
presets, the settings form. Leads and Openings are also Recruitment tabs, and a recruiter works in Leads all day
whether or not an ad ever ran (leads are typed in too). Two rulings bear on V6's "own place in the sidebar":
D-HUI8 ("one Recruitment entry; the queues behind it stop being nav destinations and become tabs") and
the sidebar ruling of 2026-11-01 ("Recruitment stays its own section, more items coming"). Every ads door answers
to the `recruitment` section; spend, launch and ad accounts are admin-only on top of it.

- **(a) Ads is its own sidebar section; Leads and Openings stay in Recruitment — recommended.** One sidebar
  entry, "Ads", opening Overview, with Campaigns, Creative studio, Automation and Settings as its tabs (the way
  Recruitment is one entry with tabs, so D-HUI8's rule holds for the new section too). Leads and Openings keep
  their addresses and their tab strip; the workspace's Overview counts leads and links to them, and a campaign
  links to its opening. `/recruitment/campaigns` and `/settings/recruiting/ads` redirect, so no notification
  link breaks. Nothing a recruiter uses today moves.
- (b) As V6 is written: Leads moves into the Ads workspace. One place for everything an ad produces; but a lead
  that came from Tenstreet, Indeed or a phone call (V7) is then filed under "Ads", and the recruiter's daily page
  leaves the section named for their job.
- (c) No new section: Ads stays a Recruitment tab and its settings stay in Settings. Cheapest; it is what the
  owner called "low level" on 2026-11-14 — control in one place, the work in another.

**What does not wait on this:** the Overview's read (running, spent, leads, what needs a person, the ledger as a
timeline) and V8's health read are API work with the same content under any of the three.

### Q-APX19 · What the next three days hold — RULED (a), 2026-11-18

**What was read (2026-11-18).** §0.3's order and this plan's estimates; the audit of the same day.

- **(a) Prove what is built, and add the research — recommended.** Day 1: the sandbox run and the sitting if the
  credentials are in hand, each refusal fixed at its cause; otherwise the Researcher. Day 2: the Researcher and
  the swipe file, recorded and at L2. Day 3: the health page and the Overview's read. At the end the system can
  run one real campaign by hand (a person approves the plan, each ad and the launch), with stills and motion ads,
  leads from Meta — and the canary can start. Modes, the workspace's screens and the other lead sources follow.
- (b) Build the workspace screens first (V6 as written). The feature looks finished sooner; it is still unproven
  against Meta, and a screen built on a reading the sandbox overturns is built twice.
- (c) Hold the three days for the credentials and do nothing until they arrive. Loses the Researcher, which
  waits on nothing.

Whichever is ruled, the full plan is not done in three days (§0.4).

### Q-APX21 · What V5's "mode per step" is, once the six steps are read in the code — RULED (a), 2026-11-19

**Why it is asked.** V5 is two sentences (§4): "a versioned policy in ads settings: step × mode", six steps, and the
modes Manual · Assisted · Autopilot (§1), which are never defined. Before building, each step was read in the code
(2026-11-19, every claim at its call site) and Meta's own reference was read for the sixth.

**What each step does today** — every decision is fixed in code; no carrier can change who takes it.

| Step | Today | Who | Is a second mode real? |
|---|---|---|---|
| 1 Start a campaign for an opening | A person creates it (`POST /api/ads/campaigns`, recruitment manage). Nothing creates one when an opening opens. | person | Yes: **Assisted** = when an opening opens with no campaign, the agent drafts one and "Needs you" offers *Start it*; nothing is planned or spent until a person presses. New, small. |
| 2 Approve the plan | The Strategist writes it; a person approves, edits (`savePlanEdit`) or asks for a new one. | person | **No Manual**: a person writing a plan from nothing is not built, and Q-APX6 made the Strategist's plan mandatory. Autopilot is not in Q-APX1's levels. |
| 3 Approve an ad | The workers make and check each ad; a person approves or rejects each. | person | **No Manual** (a person making the ad is not built). Autopilot = Level C, locked. |
| 4 Launch | An admin approves (fresh sign-in, second approver above the setting) and launches; the guard checks again. | approver | Autopilot = Level B, after the canary, locked until then. |
| 5 Replace a tired ad | `creative_refresh.retire` off: an alert only. On: the Monitor retires it, a replacement is made, a person approves it, and it is **turned on with no further person** (Q-AD68). | agent + person | Yes: the existing switch IS this step's two modes — **Manual** (alert only) and **Assisted** (retire, make, approve, turn on). |
| 6 Move budget between ads | **No code exists, and it cannot.** Meta's Ad object has no budget field ("all ads in a set have the same daily or lifetime budget"; bid on an ad is deprecated, "set `bid_amount` for the ad set", read 2026-11-19); each of our campaigns is one ad set; Meta itself spreads delivery across its ads. | — | **Not a step.** The real budget acts are on the ad set: *lower* (Level A) and *raise* (approver). |

**Found while reading — two places the plan says something the code does not:**

- **Level A says "Pause, lower a budget, retire a tired ad — Ruled and built." Lowering a budget is not built:**
  `PlatformSafe` has no lower method, no worker lowers one, and the Monitor and Meta's rules only pause. Pause and
  retire are built. (Raising is fenced end to end but no door calls it either — `guardedPlatform.ts` "Raise and area
  change are not offered".)
- **`ADS_AUTHORITY` (shared `adsPolicy.ts`) is read by nothing but its own test** (`mayAct` has no other caller): the
  routes, the machine and the guard each restate who may act. It has no row for approving a plan; it says `archive` is
  an agent's, which no code does; it lists `edit_live_copy` and `lower_budget`, which have no code path. A V5 policy
  would be a THIRD statement of who acts unless it replaces this one.

**Proposals.**

- **(a) V5 is the ONE enforced table of who takes each real step, with a mode only where a second mode is real —
  recommended.** The steps: start a campaign (Manual · Assisted), approve the plan (Assisted), approve an ad
  (Assisted · Autopilot locked), launch (Assisted · Autopilot locked until the canary), replace a tired ad (Manual ·
  Assisted — the existing switch moves here), lower a budget (Assisted · Autopilot = Level A, built as its own piece),
  raise a budget (approver). It replaces `ADS_AUTHORITY`: the doors read it, so it cannot drift from what runs. The
  Automation tab shows every step, its mode, and for a locked one the gate that opens it. Cost ≈ the plan's 5 days:
  the table and its enforcement (2), step 1's Assisted draft (1), lowering a budget end to end (1–2), the screen (1).
- (b) Build V5 as written: Manual and Assisted for all six. Needs a person-authored plan and ad (new tools nobody
  asked for, against Q-APX6) and a budget move Meta does not have. Not recommended.
- (c) Leave modes until after the canary and do V7 (the lead engine) now. Loses nothing that waits on V5, but the
  disagreements above stay in the code.

### Q-APX22 · Turning on an approved replacement runs today; Q-APX1 put it after the canary — RULED (a), 2026-11-19

**What was read.** Q-AD68 was ruled (a) on 2026-11-11 ("Yes, build Q-AD68"): on a live campaign a retired ad's
replacement is made, a person approves it, and the orchestrator publishes it into the running ad set and turns it on
— an `activate_ad` row by the agent, citing the person's approval (`compose/refreshCampaign.ts` `turnOn`; fenced in the
database by 0587). Q-APX1 was ruled (b) on 2026-11-14 and lists "Turn on a person-approved replacement for a retired ad"
under **Level B, "after the canary"**. Both are the owner's; the code runs the earlier. It runs only for a carrier that
switched `creative_refresh.retire` on, adds no budget (the ad joins the ad set's existing budget), and no carrier has
run a real campaign, so nothing has turned on yet.

- **(a) Keep Q-AD68 as built, and record that Level B's line meant only the LAUNCH of a new campaign — recommended.**
  Turning on an approved replacement spends nothing new: the ad set's budget, caps and kill switch are unchanged and
  fence it; a person saw and approved the ad; the alternative is a running campaign left on a tired ad while it waits.
- (b) Hold it until the canary, as Q-APX1's table reads: the replacement waits in "Needs you" for a person to turn it on.
  One more door and a screen; the campaign keeps the tired ad's slot empty meanwhile.

### Q-APX23 · When should the agent lower a budget on its own? — RULED (a), 2026-11-19

**What was read.** Level A (Q-APX1) lets the agent lower a budget; `ADS_AUTHORITY.lower_budget` gives it to the agent
and to a person. Since V5 part 2 a person can lower one end to end (`campaigns/lowerBudget.ts`). No rule anywhere
says when the AGENT should: the Monitor's five rules (`monitorChecks.ts`: monthly cap, daily cap, spend with no lead,
cost per lead over the cap, frequency) all PAUSE, and Meta's Automated Rules are synced as `PAUSE` only. A rule that
lowered instead would need a threshold nobody has measured — no campaign has run, so there is no cost-per-lead or
lead-volume curve of ours to set it from.

- **(a) No agent rule until the canary's data exists; the step stays a person's — recommended.** Every breach the
  Monitor watches still pauses (the stronger safe move). After the canary, the real cost-per-lead and lead volume
  say whether a "too many leads for the office" or "cost rising but under the cap" rule is worth a lower, and at
  what figure. Nothing waits on it.
- (b) Add now: "cost per lead above X % of the cap for N hours → lower the daily budget by Y %", X/N/Y chosen from
  benchmarks (Boostpoint's middle half, §2a.7). Automatic, but its three numbers would be guesses on our own fleet.
- (c) Lower instead of pause on the daily-cap rule. Changes a rule the owner chose as a pause (`pause_at_daily_cap`).

### Q-APX24 · What a lead's "score" is — RULED (a), 2026-11-20

**What was read.** D-LS2: rules decide, no model. `leadMatch` already gives one verdict per requirement with its
evidence, `summariseLeadMatch` counts hard requirements unmet and unknown, and `compareLeadMatch` sorts without
filtering. Q-AD62 rules a phone's line type a flag, never a filter. A recruiter acts on "who do I call first, and
why" — a number out of 100 says neither, and its weights would be invented (no lead has run through a real campaign).

- **(a) An ordered standing with its reasons, no number — recommended.** Three standings, first rule that holds wins:
  *Does not qualify by their answer* (a hard requirement failed — they are still listed, as today); *Check first*
  (asked not to be contacted, already drives for the carrier, Telnyx says the number cannot ring, or nothing to call
  or write to); *Call* (everything else). A landline, an internet line and an earlier application are reasons shown
  under Call, never a demotion — Q-AD62 made the line a flag, and nothing of ours shows either answers less. Within a
  standing, fewer requirements still to check first, unmatched leads last. Each lead carries the sentences that put
  it there. Every input is already stored or built in V7a; nothing is weighed by a guess.
- (b) A 0–100 score from weights (e.g. 40 fit, 20 line type, 20 returning, 20 freshness). One sortable figure; its
  weights have nothing of ours behind them, and HB 3773's audit asks why one person ranked over another.
- (c) No score; the queue keeps today's order. V7's line goes unbuilt.

### Q-APX25 · Should a lead keep its ad in a column? — RULED (a), 2026-11-20

**What was read.** `recruiting_leads` is frozen after insert (RL013, 0553) and has no ad column; Meta's `ad_id`
is in `raw` on every platform lead (`LEAD_FIELDS`). The publisher's record (`platform_refs.ads[]`) maps each Meta ad
to its creative and language, and the creative names its preset.

- **(a) Derive on read, no column — recommended.** One source for "which ad": `raw` plus the publisher's record.
  The report reads at most a few thousand leads a month per carrier. A column is the later answer if the read is
  measured slow.
- (b) A column filled at intake, beside `campaign_ref`. A second copy of a fact in `raw`; needs a migration, the
  two-merge rule, and a backfill of every existing lead.

### Q-APX26 · What the report counts as "qualified", and what a source without spend shows — RULED (a), 2026-11-20

**What was read.** `qualified` is a recruiter's qualify after a reached call (0578, Q-AD64 (a)); `applied` and `hired`
are read from the application and the driver (`leadOutcomes.ts`). Spend is known for Meta only: Tenstreet, Indeed and
a typed-in lead carry none.

- **(a) Qualified = a recruiter's qualify, or any later step the office took with them (made an applicant, applied,
  hired); a source with no spend shows its counts and "no spend recorded", never a cost of $0 — recommended.** A verdict of all-met is the person's own
  answer, not a qualification; counting it would let a form with easy questions look cheap.
- (b) Qualified = every hard requirement met by the person's answer. Available on every lead at once; measures the
  form, not the person.
- (c) Add a typed monthly spend per source now. A screen and a table for figures nobody has asked to type.

### Q-APX27 · Tenstreet waits on its own plan's answers — RULED (a), 2026-11-20

**What was read.** `TENSTREET-INTAKE-PLAN.md` (TS0–TS6, D-TS1–10, Q-TS1–10) and its meeting prep of 2026-11-19 sit in
the owner's working copy, not on main. Its own order: TS1–TS3 may start before Tenstreet answers authentication
(Q-TS1), but D-TS4 (SSN), D-TS5 (EEO) and D-TS8 (Tenstreet's status shown, never obeyed) are the owner's, and the
meeting with Tenstreet was on 2026-11-19 with its outcome not yet written down.

- **(a) Build Tenstreet as its own track from its own plan, after the meeting's answers and D-TS4/5/8 are written
  into it — recommended.** It is a public endpoint taking personal data; the three owner rulings decide what the
  parser keeps, and they cannot be added back once stored. V7's report already counts a `tenstreet` lead the day one
  arrives, since it reads every channel.
- (b) Build TS1–TS3 now with the plan's recommendations (SSN and EEO dropped by the parser, status shown only). Fast;
  rules on the owner's three questions by building them.

### Q-APX28 · "Our own apply page" does not exist — RULED (a), 2026-11-20

**What was read.** The only apply page is the invite (`/apply/:token`): a recruiter creates the applicant first,
then sends a link. Nothing public makes a lead. A public page is a new unauthenticated door taking a name, a phone and
answers: it needs a rate limit and bot defence, the texting-consent wording counsel has not settled (Q-AD52), the
form's questions (the online form is the paper application's prefill, and a lead form is shorter), and a place on the
carrier's web site to be linked from.

- **(a) Design it as its own step after V7a–e, with Q-AD52's answer — recommended.** One public page per opening
  (`/jobs/<opening>`), the opening's requirements stated first as Meta's form does (LQ1), the same questions as the
  Instant Form so `factsFor` reads it unchanged, a `LeadSink` caller with channel `apply_page`, behind the `/api`
  limiter and a challenge. About 3 days once consent wording exists.
- (b) Build it now with today's Instant Form consent text. The wording was written for Meta's form, where Meta shows
  its own terms; on our page it would be ours alone, which is the question counsel holds.
- (c) Drop it: leads come from ads, Tenstreet and Indeed, and the invite stays the only apply page.

### Q-APX20 · A motion ad's file has no size cap; the store takes 15 MB — RULED (a), 2026-11-19

**What was measured (2026-11-19, while building Q-APX17).** The join asks the encoder for a quality (`-crf 18`), not a
size, so the file is as large as the picture is busy. At 1440 × 1800: a photo pushed in, as the simulator moves it,
joins to 2.8–5.9 MB for 7 to 15 seconds; a clip with fresh noise on every frame — the ceiling, not a model's clip — to
135–175 MB. `ad-assets` takes 15 MB an object (0562). Today a file over it is refused by name (`too_large`) and the
motion ad stops; the still is kept. No real model's clip has been seen (Q-APX12), so how often a real one comes
near the limit is not known.

- **(a) Keep the quality setting and the refusal; read the size of the sitting's real clips, then decide —
  recommended.** The realistic case measured is a third of the limit or less, and a cap chosen now would be a
  number with nothing behind it. Costs nothing today; a busy real clip would stop its motion ad, visibly.
- (b) Cap the bitrate now (`-maxrate`/`-bufsize`, about 7.5 Mbit/s for 15 s under 15 MB). Never over the limit, but
  the busiest clips lose detail, by a rule nobody has looked at on a real clip.
- (c) Raise the store's limit by a migration. Moves the line rather than holding it; a 175 MB file is not one Meta's
  upload is known to want either.

## 5a. Ruled

**2026-11-14, the owner, to the four proposals above and to the request to record the agents on his Anthropic
key: *"ok proceed as proposed."*** Taken as:

- **Q-APX1 RULED (b).** Levels A, B and C as written. Q-AD2 ("a person launches") is reversed for Level B only,
  and only after the canary; Level C stays locked in code behind its certification record.
- **Q-APX2 RULED (a).** Fable's 30-day retention accepted; the contact-field boundary test is owed with V2.
- **Q-APX3 RULED (a).** The gold set is made from ordinary approvals and rejections, 50 labels, κ ≥ 0.8.
- **Q-APX4 RULED (c).** Both kinds of video, motion first.
- **Recordings approved** for the six agents' move to the newer models (V1b). Any later recording is asked for
  again, as before.

**2026-11-15, the owner, to Q-APX6 and to the recommendation on the copy rating page: *"We will proceed as
recommended planing should be mandetory"*, and on staging: *"We will test in staging in couple days when feature
is 100%."*** Taken as:

- **Q-APX6 RULED (b): planning is mandatory.** No ad is made without a plan a person approved. The machine's
  `draft → compose` row and its event are gone, and so is the per-carrier choice (`plansFor`); a draft has one
  move, to `planning`.
  - **Nothing enters `composing` without a named plan** (`applyCampaignEvent`, refusal `no_approved_plan`).
    Removing the draft's road was not enough: the machine's `failed` state does not remember where a campaign
    failed, so it offers *Try making the ads again* to a campaign that failed while planning, and `review` offers
    Regenerate to a campaign made before the ruling. Both are now refused with what to do instead.
  - **D-RA9 is NOT reversed.** The Strategist starts switched off like every agent. A campaign then stops at
    planning with "the Strategist is switched off in the ads settings" — as it stops at composing with the
    Copywriter off — and a person switches it on and presses *Try planning again*. (b)'s stated cost, "the switch
    must be on by default", was wrong: every agent is off by default and a carrier must switch on the writers to
    make any ad at all, so the Strategist is one more switch on the same screen, labelled as required.
  - **Every new campaign's launch waits on the Strategist's certification** (`meta:plannedstill`), since every
    new campaign carries a plan.
  - **Campaigns made before the ruling** (staging only; production holds none) carry no plan. One already
    composing finishes on its seeded preset draw; one in review can be approved and launched as it is, on the
    unplanned launch list; none can be sent to make ads again without being planned first. The seeded draw stays
    for those in flight and is reached by nothing new.
  - **Owed, one release later:** the database still allows a campaign into `composing` with no plan from any
    state but plan review (0606 left it open "for code still serving"; AX032 holds only the plan-review row).
    Holding the whole rule there is a migration after the release that carries this change, per
    MIGRATION-DISCIPLINE §the-deploy-window.
- **The copy rating page is rebuilt** from the `copywriter@5` recordings (taken from "proceed as recommended":
  the recommendation was to rebuild if rating had not started). Done 2026-11-15: both of the page's stores read
  empty before it was replaced; details in ADS-CREATIVE-QUALITY-PLAN §8.
- **The staging walk waits** until the feature is complete; nothing is switched on for staging before then.

**2026-11-19, the owner, to Q-APX20 and to the next step: *"Ok proceed as recommended and proposed."*** Taken as:

- **Q-APX20 RULED (a).** The join keeps asking for a quality (`-crf 18`), not a size; a file over the store's 15 MB
  stops its motion ad by name (`too_large`) and the still is kept. The sitting reads the size of every real clip it
  joins, and the cap is decided on those files — nothing is capped on a guess before then.
- **V5 next**, Manual and Assisted first, as §0.3 row 6 orders it. Reading the six steps in the code first raised
  Q-APX21 and Q-APX22, which wait on the owner before V5 is built.

**2026-11-19, the owner, to Q-APX21 and Q-APX22: *"Ok proceed as recommended."*** Taken as:

- **Q-APX21 RULED (a).** V5 is ONE statement of who takes each step, which the code obeys, with a mode only where two
  are real. Built in four pieces: (1) the table — `ADS_AUTHORITY` is now what the machine and the doors answer to; (2)
  lowering a budget end to end; (3) starting a campaign gains Assisted (the agent drafts, a person starts it); (4) the
  Automation tab shows every step and its mode. "Move budget between ads" is not a step: Meta has no per-ad budget.
- **Q-APX22 RULED (a).** An approved replacement keeps going on by itself (Q-AD68 as built). Q-APX1's Level B line
  "turn on a person-approved replacement" is read as the launch of a NEW campaign only; it is written into
  `ADS_AUTHORITY.turn_on_approved_replacement` as the agent's, with this ruling cited.

**Built 2026-11-19 (V5 part 1, the table).** `ADS_AUTHORITY` gained the acts the code already performed with no row:
`start_campaign`, `write_plan`, `approve_plan`, `regenerate`, `resume_after_failure`, `record_outcome`,
`retire_tired_ad`, `turn_on_approved_replacement`. Every move of the campaign machine is bound to an act
(`CAMPAIGN_EVENT_ACT`, shared `adsSteps.ts`), and a test refuses a machine row that lets anyone the table does not. The
four acts outside the machine ask the table at their own door — creating a campaign and deciding on an ad (a person;
403 `not_permitted` otherwise), retiring a tired ad and turning on its replacement (the agent; not attempted otherwise).
The steps and their modes (`AD_STEPS`) name acts and never say who: a locked Autopilot is locked because the table
gives none of its acts to the agent. Replacing a tired ad reads the existing switch (`creative_refresh.retire`)
for its mode rather than a second copy. Progress: `ads-progress/2026-11-19-1500-W-V5-step-table.md`.

**Built 2026-11-19 (V5 part 2, lowering a budget).** A person lowers a running campaign's daily budget
(`POST /api/ads/campaigns/:id/budget/lower`, the section's manage grant, no fresh sign-in: the safe direction) with a
reason, from the campaign drawer. "Lower" is held three times: the door against our row, the Meta adapter against
what Meta holds at that moment (a budget already lowered in Ads Manager is never raised from our stale copy), and
Meta's read-back. A `lower_budget` ledger row is started before Meta is asked; our row's amount follows by
compare-and-set, so the daily reconcile does not read our own lower as someone else's. Meta's minimum daily budget is
not pre-checked: its reference names four minimums by optimization type and says neither which a lead ad set takes
nor their unit, so Meta's own refusal answers. "Raise a budget" stays an approver's with no door, as before. The
agent may lower by the table but no rule does: Q-APX23. Progress: `ads-progress/2026-11-19-1630-W-V5-lower-budget.md`.

**Built 2026-11-19 (V5 parts 3 and 4, Assisted start and the Automation tab).** Settings gain `modes.start_campaign`
(Manual or Assisted; absent reads Manual, as every carrier had), edited in Ads › Settings with the rest. With Assisted,
every open opening with no standing campaign is listed under the Overview's "Needs you" and on Campaigns; Start opens
the create form with the opening chosen, and nothing is created until a person presses Start in it
(`start_campaign` stays a person's in both modes). The rule is shared (`openingsAwaitingCampaign`): an archived
campaign frees its opening, any other state holds it, and a campaign list the door may have cut off (200, now a
shared constant) offers nothing rather than an opening that may already have one. Ads › Automation's first card shows
every step, its mode in force, and each other mode — open with "Change in Settings", or locked with what opens it.
Progress: `ads-progress/2026-11-19-1800-W-V5-assisted-start.md`. **V5 is built**, except what Q-APX23 decides.

**2026-11-19, the owner, asked for the hand-off to the lead engine: *"proceed as proposed."*** Taken as:

- **Q-APX23 RULED (a).** No rule lowers a budget on its own until the canary's real cost per lead and lead volume
  exist; lowering stays a person's step (`campaigns/lowerBudget.ts`). Every breach the Monitor watches still pauses.
  `ADS_AUTHORITY.lower_budget` keeps the agent's grant from Q-APX1's Level A, so a rule written after the canary
  needs no change to the table — only the rule, its threshold from our own figures, and a test. **V5 is built.**
- **V7 next**, the lead engine (§4 V7), read at its call sites first as V5 was.

**2026-11-20, the owner, to Q-APX24 to Q-APX28: *"Ok proceed as recommended."*** Taken as:

- **Q-APX24 RULED (a).** A lead's standing is Call, Check first or Does not qualify by their answer, with its reasons
  in words; no number, no weights. Built as V7b (`leadStanding`); nothing changes.
- **Q-APX25 RULED (a).** A lead's ad is derived on read from Meta's `ad_id` in `raw` and the publisher's record; no
  column. Built as V7c; a column is the later answer only if the read is measured slow.
- **Q-APX26 RULED (a).** "Qualified" in the report is a recruiter's qualify or any later step taken with the person;
  a source with no spend says "No spend recorded". Built as V7d.
- **Q-APX27 RULED (a).** Tenstreet is its own track from `TENSTREET-INTAKE-PLAN.md`, started once the 2026-11-19
  meeting's answers and the owner's D-TS4 (SSN), D-TS5 (EEO) and D-TS8 (status shown, never obeyed) are written
  into that plan. The report already counts a `tenstreet` lead the day one arrives.
- **Q-APX28 RULED (a).** The public apply page is its own step after V7e, designed once counsel answers Q-AD52
  (texting consent on our own page).
- **Next:** V7e, the qualified-lead switch's readiness (shown, not offered, until Q-AD17's sandbox answer).

## 6. Open, in one place

| Id | Question | Recommendation | Who |
|---|---|---|---|
| Q-APX1–4 | — | **ruled 2026-11-14, §5a** | — |
| Q-APX5 | Speech-to-text provider | **ruled (a) Amazon Transcribe, 2026-11-18, §5a** | — |
| Q-APX6 | Planning mandatory, or the carrier's choice | **ruled (b) 2026-11-15, §5a** | — |
| Q-APX7–15 | — | **ruled 2026-11-16 as proposed, §5a**; Q-APX12's sitting still waits on the Higgsfield key | — |
| Q-APX16 | The picture budget is in "credits"; Higgsfield's API bills dollars and has a price call | **ruled (a) 2026-11-18, §5a**: budget in dollars, price asked from `/estimate`; **built 2026-11-19** | — |
| Q-APX17 | Our video is 1080 wide; Meta's video-ads page says 1,200 at least | **ruled (a) 2026-11-18, §5a**: paint the motion ad at 1440 × 1800; **built 2026-11-19** | — |
| Q-APX18 | Where the Ads workspace sits, and whether Leads and Openings move into it | **ruled (a) 2026-11-18, §5a**: its own sidebar section; Leads and Openings stay Recruitment's and are linked | — |
| Q-APX19 | What the next three days hold | **ruled (a) 2026-11-18, §5a**: sandbox when credentials arrive, the research (V2r), then the health read | — |
| Q-APX20 | A motion ad's file has no size cap; the store takes 15 MB | **ruled (a) 2026-11-19, §5a**: keep quality and the named refusal; decide on the sitting's real clips | — |
| Q-APX21 | What V5's modes are, step by step; step 6 cannot exist on Meta | **ruled (a) 2026-11-19, §5a**: one enforced table of who acts, a mode only where two are real; lowering a budget built | — |
| Q-APX22 | Approved replacements are turned on today (Q-AD68); Q-APX1 put that after the canary | **ruled (a) 2026-11-19, §5a**: keep it; Level B means launching a new campaign | — |
| Q-APX23 | When the agent should lower a budget on its own (Level A allows it; no rule exists) | **ruled (a) 2026-11-19, §5a**: none until the canary's data; lowering stays a person's step | — |
| Q-APX24 | What a lead's "score" is | **ruled (a) 2026-11-20, §5a**: an ordered standing with its reasons, no number; built (V7b) | — |
| Q-APX25 | Whether a lead keeps its ad in a column | **ruled (a) 2026-11-20, §5a**: derived on read from `raw` and the publisher's record; built (V7c) | — |
| Q-APX26 | What "qualified" counts in the report; a source with no spend | **ruled (a) 2026-11-20, §5a**: a recruiter's qualify or later; "no spend recorded", never $0; built (V7d) | — |
| Q-APX27 | Tenstreet's receiver | **ruled (a) 2026-11-20, §5a**: its own track, after the meeting's answers and D-TS4/5/8 | owner (D-TS4/5/8) |
| Q-APX28 | A public apply page | **ruled (a) 2026-11-20, §5a**: its own step after V7a–e, with Q-AD52's consent answer | counsel (Q-AD52) |
| — | Meta app (id `META_APP_ID` and secret), system-user token, sandbox account id; Higgsfield key and model (Q-AD20); the 60-set rating | still the gate to any real ad | owner |

**2026-11-16, the owner, to Q-APX7 to Q-APX15 as proposed: *"Ok proceed as proposed with goal in mind that we want
this to be high grade and really good quality, modern and in trending."*** Taken as:

- **Q-APX7 RULED (b), Q-APX8 RULED (a), Q-APX9 RULED (a), Q-APX11 RULED (a)** — as built in V3.
- **Q-APX10 RULED (a).** The starter presets' limit for the text above the picture is Meta's 150, read from
  `META_FEED_TEXT`; every Copywriter fixture carrying such a limit is updated and the Copywriter recorded again
  (the recording was named with its size and cost in the proposal). The rating page is rebuilt from it.
- **Q-APX12 RULED (a).** The video model is chosen by a sitting on the owner's key. Still waits on the key.
- **Q-APX13 RULED (a).** A motion ad is the still's own words over five seconds of motion, then the approved still.
  The one-second and two-second figures stay ours until a real clip is looked at.
- **Q-APX14 RULED (a).** Debian's ffmpeg in the image.
- **Q-APX15 RULED (a).** No generated sound; a silent track.
- **"Modern and trending" is a goal, not a measurement.** What it changes in the order of work: the motion's
  entrance and settle were added to the join now rather than later, and the comparison of real clips (Q-APX12) is
  the first thing to do when the key exists, because no rule of ours can make a poor clip look good.

**2026-11-18, the owner, to Q-APX5, Q-APX16 to Q-APX19 and the open reading on a video that cannot be made, as
asked in one message: *"Ok proceed as recommended and proposed."*** Taken as:

- **Q-APX19 RULED (a).** The sandbox run and the sitting when the credentials arrive; until then the research
  (V2r below), then the health read and the Overview's read. No credentials came with the ruling, so V2r is first.
- **Q-APX18 RULED (a).** Ads is its own sidebar section (Overview, Campaigns, Creative studio, Automation,
  Settings); Leads and Openings stay Recruitment's tabs and are linked; the two old addresses redirect.
- **Q-APX16 RULED (a).** The picture and video budget becomes US cents a month, each price asked from Higgsfield's
  `/estimate` and written on the row. Built after the health read (§0.3 row 4).
- **Q-APX17 RULED (a).** The motion ad is painted at 1440 × 1800; the still stays 1080 × 1350.
- **Q-APX5 RULED (a).** Amazon Transcribe, its "used to improve the service" default switched off by an AWS
  Organizations opt-out policy before the first clip. Waits on the driver clip, which waits on counsel (A-14).
- **A video that cannot be made leaves the ad in review as its still.** This is what `compose/composeCreative.ts`
  `motionOf` already does (the creative goes to review as the still, and `checks.motion` says why there is no
  video); the ruling confirms it, and nothing changes.

## Sources (read 2026-11-14)

- Meta — Lead forms for ads: <https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/create>
- Meta — Conversions API for CRM: <https://developers.facebook.com/documentation/ads-commerce/conversions-api/conversion-leads-integration>
- Meta — Special ad categories: <https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/special-ad-category>
- Anthropic — API and data retention: <https://platform.claude.com/docs/en/manage-claude/api-and-data-retention>
- Anthropic — Covered Models: <https://support.claude.com/en/articles/15425695-covered-models>
- Anthropic — Is my data used for training: <https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training>
- Higgsfield — API pricing: <https://open.higgsfield.ai/pricing>
- Indeed — 2026 release notes: <https://docs.indeed.com/release-notes/2026#2026-07-31>
- Indeed — Disposition Sync: <https://docs.indeed.com/disposition-sync-api/integrate-with-disposition-sync-api>
- WFA — AI in marketing, 2026-09-30: <https://wfanet.org/knowledge/item/2026/09/30/96-of-major-brands-now-use-ai-in-marketing-wfa-research-finds>
- IAB survey, second-hand: <https://noticemesenpai.com/news/ai-buying-agents-hallucinate-agency-qa-role-2026/>
- Ahrefs figure, second-hand: <https://www.blazehive.io/statistics/generative-ai-in-marketing-statistics/>
- EEOC findings on Facebook job ads: <https://www.aclu.org/press-releases/historic-decision-digital-bias-eeoc-finds-employers-violated-federal-law-when-they>
- Judge calibration: <https://arize.com/llm-as-a-judge-when-should-you-use-it/> · <https://galtea.ai/blog/llm-as-a-judge-the-complete-guide> · <https://arxiv.org/pdf/2510.09738>
- Boostpoint — CDL lead costs 2026: <https://boostpoint.com/industries-trucking/truck-driver-leads/>
- Creative mix after Andromeda (agency sources): <https://segwise.ai/blog/meta-andromeda-update-creative-strategy-2026> · <https://theoptimizer.io/blog/how-to-test-ad-creatives-on-meta-after-the-andromeda-update-2026-playbook>
- Driver video claims (vendor sources): <https://otrucking.com/resources/guides/social-media-recruiting-truck-drivers/>

- Read 2026-11-16 for V4: Meta — feed video, Leads: <https://www.facebook.com/business/ads-guide/update/video/facebook-feed/outcome-leads> · Meta — ad videos: <https://developers.facebook.com/docs/marketing-api/advideo> · Higgsfield — Seedance 2.0 image to video: <https://docs.higgsfield.ai/docs/models/seedance-2/image-to-video.md> · Wan 3.0 image to video: <https://docs.higgsfield.ai/docs/models/wan-3/image-to-video.md> · Kling 3.0: <https://docs.higgsfield.ai/docs/models/kling-3.md> · Netflix — Timed Text Style Guide: <https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-Timed-Text-Style-Guide>
- Read 2026-11-17 for V4's publisher: Meta — FB Video Ads (upload, status, sizes): <https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/videoads/fbvideoads> · Ad Creative Video Data (the thumbnail by `image_hash`): <https://developers.facebook.com/docs/marketing-api/reference/ad-creative-video-data> · Lead forms for ads (the video sample): <https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/create> · Ad videos, the older edge: <https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-account/advideos>

Most figures on creative practice come from vendors and agencies; where two disagreed, both are given above.

## Progress log

Entries are files in [`ads-progress/`](ads-progress/), one per step, named for this plan's step ids (V1–V8).

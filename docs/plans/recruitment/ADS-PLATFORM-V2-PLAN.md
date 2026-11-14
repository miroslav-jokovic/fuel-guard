# Ads and leads, second version — four parts, a planning stage, video, and automation a carrier can set

**Started:** 2026-11-14. **Status:** plan; nothing in it is built. **Read from:** `origin/main` at `0d8113f`.

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

Days are estimates, not measurements. **Order: V1 → V2 → V3 → V4 → V6 → V5 → V7; V8 rides with V6.**

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
- After 14 days the angle's results join the next pack.

**Done when:** on the simulator a campaign cannot reach `composing` without a plan, and every angle in a stored
plan cites evidence that exists.

### V3 · Design quality (~6 days)

- **Make many, show few.** Per angle: three pictures and three sets of words; the finished-ad judge ranks the
  nine pairings; the person sees the winner and may open the rest. Today one render is made (F-AG3, F-AG6).
- **A reference set of the carrier's own choosing** (Q-APX3) is what the judge scores against.
- **Photo library.** The brand kit's photos gain tags (truck, trailer, driver, yard, road). Equipment angles start
  from a real photo; a kit with one photo is told it will repeat itself (F-AG5).
- **Preview as shown.** Each ad in a Facebook feed frame and an Instagram story frame, both languages.

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

### V8 · What makes it enterprise grade

Already on main: sealed tokens opened in one place, admin-only spend behind a fresh sign-in, two approvers above a
line, the kill switch, an append-only action ledger, a daily reconcile against Meta, route and log sweeps.

To add: a **health page** (last webhook, token expiry, failed jobs, cost and pass rate per agent); a retention rule
for leads that never convert; more than one Page per carrier; and — still the largest gap — the L4 runs on Meta's
sandbox, which wait on the owner's Meta app, sandbox account and Higgsfield key.

## 5. The decisions, with what was read for each

### Q-APX1 · May anything run with no person in between?

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
| A | Pause, lower a budget, retire a tired ad. | Ruled and built. |
| B | Launch a campaign whose plan and ads a person approved, inside a monthly envelope an admin approved once. Turn on a person-approved replacement for a retired ad. | After the canary (L5). **Reverses Q-AD2 for this case only.** |
| C | Publish an ad no person saw. | Locked in code by a certification record, like Launch. Opens only at ≥ 50 real ads decided by a person with the judge agreeing at κ ≥ 0.8, counsel's wording list complete (G12), and one ad in ten still shown to a person afterwards. |

Every automatic act writes a ledger row, appears in the morning brief and has an undo; a cost spike, a Meta
rejection or a lead-quality alert returns the carrier to Assisted. Rejected: (a) no Autopilot ever — leaves the
owner's "automated and manual to be options" unmet; (c) full Autopilot now — no evidence yet supports it.

### Q-APX2 · Fable 5.2 keeps requests for 30 days

**What was read.** Fable and Mythos are Covered Models: Anthropic keeps their requests 30 days and does not offer
them under zero retention without its authorization. Thirty days is also Anthropic's standard for API traffic;
commercial API inputs and outputs are not used for training by default. **Our key already calls Fable 5.2 (§1)**,
so the account meets the requirement as it stands — there is nothing to switch on. And no ads worker reads a
lead's name, phone or e-mail (§1): the Strategist would be sent a job's facts, totals and pictures of ads.

**Proposal: (a) — accept, and make the second fact a rule.** A boundary test refuses any ads agent input type that
carries a lead contact field, so the answer stays true as agents are added. Driver clips are different: a face and
a voice go to a video and a speech provider, so that lane waits on a written release (counsel).

### Q-APX3 · Whose judgement the judge is held to

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

### Q-APX4 · Which video first

**What was read.** No measured comparison exists for driver recruiting. Vendors say a phone clip from the cab
beats polished video (O Trucking, CDL Jobs Linker, Leadgamp — claims without data); general sources disagree on
video against stills (cheaper impressions for stills, more engagement for video) and agree on mixing formats.

**Proposal: (c) — both, motion first.** Motion needs no person and no release, so it ships first; driver clips
follow when counsel's release and Q-APX5 are settled. `ads_ad_spend_hourly` already holds per-ad figures, so the
answer for this carrier is measured in its first month instead of taken from a vendor.

### Q-APX5 · Speech-to-text for driver clips — open

Not researched. Candidates to compare on price, accuracy on cab noise, Spanish, and where audio is kept. Nothing
in V4's motion lane waits on it.

## 6. Open, in one place

| Id | Question | Recommendation | Who |
|---|---|---|---|
| Q-APX1 | Automation with no person in between | (b) Levels A, B, C | owner |
| Q-APX2 | Fable's 30-day retention | (a) accept; contact-field boundary test | owner |
| Q-APX3 | The judge's ground truth | (a) labels from ordinary approvals, 50, κ ≥ 0.8 | owner |
| Q-APX4 | Which video first | (c) both, motion first | owner |
| Q-APX5 | Speech-to-text provider | research owed | Claude |
| — | Meta app, system-user token, sandbox account id; Higgsfield key and model (Q-AD20); the 60-set rating | still the gate to any real ad | owner |

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

Most figures on creative practice come from vendors and agencies; where two disagreed, both are given above.

## Progress log

Entries are files in [`ads-progress/`](ads-progress/), one per step, named for this plan's step ids (V1–V8).

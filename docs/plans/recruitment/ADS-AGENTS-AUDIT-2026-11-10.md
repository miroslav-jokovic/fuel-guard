# Ads agents and lead relevance — second audit, and a ranked build list (2026-11-10)

**Status:** audit, docs only. Read from `origin/main` at `9d16b1c` (all ten CQ PRs and LQ1–LQ8a merged).
**Owner's ask:** "do one more round of audits and focus on our agents. I want to make sure that ads we are
producing here are high quality, well directed and composed. Also I want to make sure our leads are relevant,
reliable, and not some random leads that will be useless."
**Parents:** [`ADS-CREATIVE-QUALITY-PLAN.md`](ADS-CREATIVE-QUALITY-PLAN.md) (CQ1–CQ9, gaps G-CQ1–15) and
[`ADS-LEAD-INTAKE-AUDIT-2026-11-09.md`](ADS-LEAD-INTAKE-AUDIT-2026-11-09.md) (F-LA1–8, LQ5–LQ9). This audit does
not restate what those fixed. It checks that their fixes landed as their progress entries say, and lists what is
still open or newly found. It proposes steps AG1–AG9 and LR1–LR8 and opens Q-AD74–Q-AD77 (pointer in
`ADS-AGENT-PLAN.md` §9). It changes no ruling.

**How it was read:** two parallel readers, one per half, each told to tag a finding VERIFIED (the code that proves
it was read) or INFERRED (reasoned from absence, with what was searched). The findings marked ✔ below were then
re-read at the cited lines by the author. The rest stand as the readers reported them.

---

## 0. The verdict

**Ads.** The words are well directed: the copywriter gets the real job through `openingBrief`, writes several
candidates, has every figure checked against the brief, and a craft judge ranks them in a seeded order. **The
picture is not directed at all**, is cropped rather than composed per format, is never judged for quality, and
cannot be produced on a real connection today because no image model is chosen. A carrier also starts with no
presets and no kit.

**Leads.** Intake is reliable: stored once, matched by phone or e-mail only, judged by pure rules, never lost.
**What decides relevance is upstream and unbuilt:** Meta is asked for the cheapest lead, not a qualified one, and
the feed that would teach it is off by default and cannot switch the goal. Downstream, the junk-lead alert cannot
fire for the very campaign it was built for, and a returning person, a current driver or a held number rings as a
new lead.

---

## 1. Ads — findings

| # | Sev | Finding | Evidence |
|---|---|---|---|
| F-AG1 ✔ | HIGH | **No real ad image can be produced.** The still model is `null` and the price table empty, on purpose, until V4 measures with the owner's key (Q-AD20). Compose on a real connection stops at "no still model chosen yet (V4)". The only end-to-end path is the simulator, which returns the kit photo or a drawn road. Everything below about images is untested against a real model. | `creative/higgsfield/prices.ts:8,17` · `compose/composeCreative.ts:147` · `higgsfield/simulatedRender.ts` |
| F-AG2 ✔ | HIGH | **Nothing in code directs composition.** The art director is sent the template, slot names, three scene flags, up to four phrases of job context and the photo labels. It never sees the layout, the formats, the text zone or the chosen copy, and its prompt has no word on focal subject, framing or negative space. The image prompt is the preset's template with slots filled plus `NO_LETTERING`. Direction therefore lives only in the preset's one-line template — which is owner data that does not exist yet (F-AG5). The only composition instruction anywhere is a regeneration clause after a failed check. | `workers/artDirector/artDirector.ts:48-55` · `artDirector/prompt.v2.md` · `shared/ads/artDirection.ts:73-77,107` |
| F-AG3 ✔ | HIGH | **One render, no aspect ratio, centre-cropped to every format.** The render call sends `params: { prompt }` only; `frameStill` resizes with `fit: "cover"`. A 9:16 crop keeps a third to a half of the width. A check failing on any format fails the creative, yet the publisher uses only 4:5 or 1:1 — an unused crop can force a regeneration that shrinks the subject in the image that is used. G-CQ7 named this; nothing was built for it. | `compose/composeCreative.ts:150,165-187` · `creative/overlay/overlay.ts:119-122` · `platforms/meta/publisherAds.ts:33` |
| F-AG4 ✔ | HIGH | **Visual quality is never judged.** The checker answers six defect checks and is told "Do not judge whether the image is attractive or fits the job; that is the reviewer's". The craft judge receives copy JSON only. No model sees the finished ad (image plus overlay). G-CQ14 named this; CQ4 addressed copy only. | `workers/checker/prompt.v1.md:34` · `workers/craftJudge/craftJudge.ts:61-65` |
| F-AG5 ✔ | HIGH | **A carrier starts with no presets and no kit.** No migration seeds a preset or a kit (searched `insert into ad_concept_presets / ad_brand_kits`); compose stops with "no preset to draw". P1–P5 exist only as fixtures: one-line, one-slot templates, all `bottom_plate`. CQ5's concept fields (`hook_family`, `scene_family`) are unbuilt, so nothing holds presets apart. With one kit photo every equipment concept starts from the same picture. | `compose/composeCampaign.ts:73` · `workers/copywriter/fixtures/p1-*.json` · `shared/ads/artDirection.ts:32` |
| F-AG6 ✔ | MED | **The top-ranked copy ships whatever its score, and there is no fallback.** `ranked[0]` becomes the ad. If the overlay then refuses it (a third headline line, contrast), the creative stops; the next-ranked candidate is never tried. Nothing ties a slot's `max_chars` to what the overlay can draw (a 90-character headline slot at 64 px — inferred, not computed). | `compose/composeCreative.ts:101-106,173` · `creative/overlay/overlay.ts:47` |
| F-AG7 | MED | **Baselines measure compliance, not quality.** The copywriter's 58/60 means "at least one candidate passed claims and length". Recorded passing answers include "Pagas $0.68 a $0.74 por milla" (the driver pays), "Home in 12 days. Every time." for a 10–12-day run, the headline "Dispatch Freight Lines. Hire.", and "A casa c/semana". The craft judge's baseline is six fixtures of "planted filler ranks last"; it is the same model as the writer and the owner's rating sheet (#2054) is unrecorded. | `workers/agentFixtures.ts:87-92` · `copywriter/fixtures/opening-otr-flatbed-midwest-southeast.json`, `opening-es-regional-reefer.json` |
| F-AG8 | MED | **Writer and judge pull apart.** The copywriter must vary the angle across candidates (pay, home time, equipment, plain); the judge's `hook` criterion rewards leading with what the concept says. The on-concept candidate wins and the variety is thrown away. | `copywriter/prompt.v3.md:10` · `craftJudge/prompt.v1.md:13` |
| F-AG9 | MED | **The overlay will look templated.** One bundled face (Liberation Sans), fixed 64/44/26 px, the call to action as bold text, a flat plate inset 6 %. `kit.colors` and `kit.phone` are stored and read by nothing. The logo is drawn with no contrast check. The three layouts move the same stack. | `creative/overlay/overlay.ts:34,41-43,183-195` · `shared/ads/renderGeometry.ts:36-40` |
| F-AG10 | MED | **The reviewer can only approve or reject.** They see each format and language, the slot text, the checks grid and the ranked candidates read-only. They cannot pick another candidate (CQ4c, unbuilt), change a word or re-render; the reject reason is stored and read by nothing in compose; "Make new ads" redoes copy and image together from identical inputs. There is no preview as Meta shows the ad. | `apps/web/src/features/ads/AdsCreativeReview.vue:45-70` · `compose/composeCampaign.ts:46,112` |
| F-AG11 | MED | **Performance never reaches generation.** Per-concept figures are read by `conceptPerformance.ts` and one route (a table in the drawer). The draw has no weight; the analyst's brief does not mention concepts; a tired ad is paused and nothing enters in its place (Q-AD68 open). | `monitor/conceptPerformance.ts` · `shared/ads/presetDraw.ts:14-15` · `monitor/retireTired.ts:25-26` |
| F-AG12 | LOW | **Spanish is co-written in the same call**, told "not translated word for word", and judged by one score from the same model; recorded outputs mirror the English sentence by sentence. EN and ES share one ad set (CQ8 open). | `copywriter/prompt.v3.md:20,33` |
| F-AG13 | LOW | **A 9:16-only preset is rendered, approved, then refuses the whole publish** (`no_feed_image`); nothing checks it at save. | `platforms/meta/publisher.ts:233-236` |
| F-AG14 | LOW | **Workers are pinned to `claude-sonnet-4-6`** because newer models refuse forced `tool_choice`; the creative plan said this would move with CQ4 and it did not. | `apps/api/src/lib/anthropic.ts:65,126` |

**Landed as claimed, leave alone:** CQ1 window (`composeCampaign.ts:91-99`); CQ2 brief (`openingBrief.ts:60-92` —
the `opening-*` fixtures are what production can emit); the claim check re-run at the overlay
(`overlay.ts:139-146`) and invented-figure candidates dropped, not coaxed (`copywriter.ts:153-162`); contrast
measured under the text, refuse rather than shrink (`overlay.ts:197-201`); seeded judge order
(`craftJudge.ts:51-59`); reference-photo image-to-image with fixed regeneration clauses; `safe_zone_clear` judged
on the cut text band.

**Not determined:** any Higgsfield model's default aspect ratio or reference fidelity (none chosen); whether the
overlay goldens look acceptable (the PNGs were not opened); the overlay's exact characters per line.

---

## 2. Leads — findings

| # | Sev | Finding | Evidence |
|---|---|---|---|
| F-LR1 ✔ | HIGH | **Meta is asked for lead volume, not lead quality.** The campaign is `OUTCOME_LEADS`, the ad set `optimization_goal: "LEAD_GENERATION"`, lowest cost, promoted object the Page only. `QUALITY_LEAD` appears nowhere in `apps/api/src` or `packages/shared/src`. The outcome feed is off unless a carrier switches it on, and its own header says the optimisation switch "is not here": LQ5's negative stages reach Meta as events and steer nothing. Whether the conversion-leads goal is allowed under EMPLOYMENT is Q-AD17, a sandbox reading. | `platforms/meta/publisher.ts:156,172-176` · `shared/ads/settingsContract.ts:116` · `outcomes/feedTarget.ts:39` · `outcomes/outcomeFeed.ts:38` |
| F-LR2 ✔ | HIGH | **The junk alert cannot fire for a campaign whose leads disqualify themselves.** `leadQualityBreaches` skips a campaign until `attempted >= min_attempted` (10) — for both rules, though the not-qualified share is over `leads` and needs no call. LQ6 (correctly) stopped ringing those leads, so nobody calls them and `attempted` stays near zero. LQ3 and LQ6 are each right; together they are blind. | `shared/ads/leadQuality.ts:60-66` · `recruiting/leads/leadSink.ts:72` · `leadUncontacted.ts:84` |
| F-LR3 | HIGH | **Nothing checks where a lead lives, and nothing can ask.** Meta's employment rules keep city, state and ZIP off the form; `LeadFacts` and `HiringRequirements` carry no location, deliberately (Illinois HB 3773, D-LS). The only control is the pin and 15–50 mile radius. A distant lead is judged and rung like any other; a recruiter can close it `out_of_area`, and that reason is counted nowhere per campaign (F-LR5). | `shared/ads/metaLeadForm.ts:27-31` · `shared/recruiting/hiringProfile.ts:13-14` · `publisher.ts:177-181,226` |
| F-LR4 | MED | **A Meta lead can be judged on 3 of the profile's 8–9 requirements** (`class_a_held`, `class_a_years`, `hazmat`); age and the four disqualifiers are `unknown` by construction, and self-reported years never reach `meets`. In practice only "no Class A" and "under the minimum" filter. This is Meta's rule plus Q-RA7b, not a defect — it is why F-LR1 matters. | `shared/recruiting/leads/facts/meta.ts` · `leadMatch.ts:110-165` |
| F-LR5 | MED | **Close reasons other than `not_qualified:*` reach no per-campaign measure.** The quality reader reads contacts and verdicts, never `recruiting_lead_closures`; not interested, out of area, spam, duplicate and unreachable fold into one `lost_before_conversion` count. The LQ5b2 entry deferred it. | `recruiting/leads/leadQuality.ts` · `shared/ads/analystBrief.ts:191` |
| F-LR6 ✔ | MED | **A returning person rings as a new lead.** Store-once is per `(org, channel, external_ref)`. The sink rings on `stored === "new"` unless the lead fails a hard requirement; it does not read the person matches (`matches.leads`, `matches.drivers`) or the do-not-contact list, which only the uncontacted sweep reads. A current driver, someone already closed as not qualified, and a held number all ring `lead_new` and count in the quality denominators. | `recruiting/leads/leadSink.ts:65-72` · `0554 ingest_lead` |
| F-LR7 | MED | **Open leads are never re-judged (LQ9 unbuilt).** No `rejudge` exists; verdicts are written once per (lead, profile version) at ingest. An opening pins a `profile_version_id`, so a profile edit does not reach even new leads until the opening is saved again. | `recruiting/leads/verdicts.ts:36-45` · `hiringSetup.ts` |
| F-LR8 | MED | **The phone line-type lookup is a table only (LQ8b unbuilt).** `0583`, the contract and a retention rule exist; no Telnyx call, no badge. SMS verification is sent on the form and Meta gives no read-back, so it is unproven until L4. | `0583_phone_lookups.sql` · `shared/ads/metaLeadFormScreens.ts:104` · `publisher.ts:246-248` |
| F-LR9 | MED | **The "no phone or e-mail" count misses webhook leads, and such a lead still rings.** The backfill counts `no_contact_detail` only when it stored the lead; the webhook fetch does not count it and the backfill then sees a duplicate. With a healthy webhook the F-LA6 bell never rings, while `lead_new` does, with nothing to dial. | `ads/leads/backfill.ts:235-237` · `ads/leads/leadFetch.ts` |
| F-LR10 | LOW | **Test-tool and organic leads are stored and rung as real.** The fields read are `id, created_time, field_data, ad_id, campaign_id`; no `is_organic`, no test marker. | `backfill.ts:40` · `leadFetch.ts:31` |
| F-LR11 | LOW | **No burst check, and the quality alert rings once ever per campaign and rule** (the dedupe key has no date). It never pauses; nothing is automatic (Q-AD51 ruled alert-only). | `monitor/leadQualityCheck.ts:34` |
| F-LR12 | LOW | **Two quiet paths.** A delivery for a form no campaign owns is dropped with a log line and an in-memory counter. A lead whose opening has no profile gets no verdicts and rings as unjudged. | `ads/leads/leadgenWebhook.ts:176-180` · `verdicts.ts:35,46` |

**No mis-attribution path was found:** a form belongs to one campaign and the fetched lead's `form_id` must equal
the delivery's (`leadFetch.ts:86`).

**Landed as claimed, leave alone:** LQ1, LQ2b, LQ3b (40 / 40 / 10, alert only), LQ5a/b1/b2 (`close_lead` writes a
verified verdict; evidence rules in SQL — three attempts for unreachable, a reached call for not interested), LQ6,
LQ7 (`factsFor` chosen by channel in the sink). The signed fail-closed webhook under the self-healing backfill;
store-once and phone-or-e-mail person matching; `unknown` never a fail.

**Unbuilt, confirmed:** LQ8b, LQ9, LQ4 (counsel), `lead_burst`, the F-LA8 targeting read-back, the web halves of
LQ2c ("Mine") and LQ5c (close drawer), and the Indeed and Tenstreet listeners (only `facts/indeed.ts` and
`facts/tenstreet.ts` exist).

**Not determined:** whether Meta accepts SMS verification, higher intent and the negative stages under EMPLOYMENT
(L4); whether delivery reaches people passing through the radius (no `location_types` is sent; the behaviour is
Meta's); any production setting — no database was read.

---

## 3. The build list, ranked

Ranked by what it does for "good ads" and "useful leads" per day of work. **W** = workers/platform track, **S** =
screens and recruiting track, **owner** = an act only the owner can do. Days are estimates, not measurements.

### Now — small, no ruling needed, no vendor needed

| Step | What | Closes | Track | ~Days |
|---|---|---|---|---|
| **LR1** | The not-qualified rule gates on `leads >= min_leads` (a second threshold, default 10), not on attempts; the wrong-number rule keeps `attempted`. Pure function plus its settings field (optional, defaulted). | F-LR2 | W | 0.5 |
| **LR2** | The sink reads what `ingest_lead` already returns before ringing: a held number rings nobody; a current driver rings nobody and is listed "already a driver"; a person with an earlier lead rings the earlier lead's owner once, worded "applied again", and is left out of the quality denominators. The exact wording of the three is Q-AD74. | F-LR6 | S | 1 |
| **LR3** | `no_contact_detail` is counted where the lead is first stored, whichever road stored it, and a lead with nothing to dial does not ring `lead_new`. | F-LR9 | W | 0.5 |
| **LR4** | The quality reader counts closures by reason per campaign; the brief sheet gains "closed: not interested a, out of area b, unreachable c, spam d". Analyst eval re-run twice. | F-LR5, part of F-LR3 | W | 1 |
| **AG1** | The copy that ships is the best-ranked candidate **that the overlay can draw**: try ranked[0], on an overlay refusal try the next, record which was used and why. A preset save refuses a headline slot longer than the overlay's measured capacity for its layout. | F-AG6 | W | 1 |
| **AG2** | A preset save refuses a format set with no feed format (4:5 or 1:1). | F-AG13 | S | 0.25 |

### Next — before the first real render, so V4 measures the right thing

| Step | What | Closes | Track | ~Days |
|---|---|---|---|---|
| **AG3** | **Composition is directed.** The art director's input gains the preset's layout, the text zone as a plain phrase ("keep the lower third clear"), the formats, and the chosen headline. Its answer gains fixed-vocabulary fields — focal subject, camera distance, where the empty space is — that `composeImagePrompt` writes into the prompt. Prompt v3, fixtures re-recorded, baseline twice. | F-AG2 | W | 2 |
| **AG4** | **Composed per format, not cropped** — Q-AD75. Either one render per aspect, or one render at the tallest used aspect with the crop anchored on the subject, and in both cases only the formats the publisher will send are rendered and checked. | F-AG3 | W | 1–2 |
| **AG5** | **A judge that sees the finished ad** — Q-AD76. One vision call on the composed image per format: subject legible, text and image agree, hierarchy reads, looks like the kit. A floor below which the creative is not shown for review. Its eval set is ads a person rated, never planted defects alone. | F-AG4 | W | 2–3 |
| **AG6** | **Starter presets and the concept fields** (CQ5's unbuilt half) — Q-AD77. Recipe gains `hook_family` and `scene_family`; a save refuses two live presets with the same pair; five starter presets a carrier can adopt and edit. | F-AG5 | S + owner | 2 |
| **owner** | The Higgsfield API key (Q-AD20), so V4 can choose a model and its price. Until then no real image exists and AG3–AG5 are proven on the simulator only. | F-AG1 | owner | — |

### Stage 2 — proven on the Meta sandbox first, never assumed

| Step | What | Closes | Track | ~Days |
|---|---|---|---|---|
| **LR5** | **The first sandbox reading is the quality goal (Q-AD17).** If EMPLOYMENT accepts it: the ad set's goal becomes the conversion-leads goal once the outcome feed has enough events, behind a setting; the feed defaults on for a carrier that connects a dataset. If it does not: say so in the plan and stop — the lever does not exist, and LR1/LR4 plus the recruiter's close-out are the whole quality loop. | F-LR1 | W | 2 |
| **LR6** | LQ8b as already planned (Telnyx lookup after store, never before the ring), then wrong-number share by line type. | F-LR8 | W | 1.5 |
| **LR7** | LQ9 as already planned (re-judge open leads on a profile save; an opening follows its profile's newest version or says it is behind). | F-LR7 | S | 1.5 |
| **LR8** | Read `is_organic` and whatever marks a test-tool lead (field names read in the sandbox, not guessed); list them apart, ring nobody. A dated key for the quality alert so it can ring again after a quiet period. | F-LR10, F-LR11 | W | 1 |

### Later — worth doing, not before real ads exist

| Step | What | Closes |
|---|---|---|
| **AG7** | The reviewer picks another ranked candidate (CQ4c) or re-renders the image alone; the reject reason is given to the next attempt as a fixed clause, never as free text into a prompt. | F-AG10 |
| **AG8** | Overlay craft: the kit's colours and an optional brand face, a drawn button for the call to action, a logo contrast check, sizes from the format instead of three constants. | F-AG9 |
| **AG9** | Concept results weight the next draw and appear in the analyst's brief; with Q-AD68, a retired ad is replaced by the next concept. | F-AG11 |
| — | The copywriter baseline gains a craft half once the owner's rating sheet exists (Q-AD57); the judge's `hook` criterion stops penalising the varied angles the writer is told to produce; Spanish judged by a second reader. | F-AG7, F-AG8, F-AG12 |
| — | The model pin moves when a newer model accepts a forced tool, with every baseline re-recorded. | F-AG14 |

**Order across the two halves:** LR1–LR4 first (three days, recruiters feel them at once). Then AG1–AG6, so the
first real render is a composed one. LR5 is the single most valuable item and waits only on the sandbox.

---

## 4. Open questions (pointer in `ADS-AGENT-PLAN.md` §9)

- **Q-AD74 · What a returning person does to the bell (owner).** (a) held number: no ring; current driver: no
  ring, listed; earlier lead: one ring to that lead's owner, "applied again", not counted as a new lead in the
  quality shares; (b) ring every time, add a badge only; (c) (a), and a second submission inside N days does not
  ring at all. **Recommended: (a).** A held number must not ring (TCPA is why the hold exists); a second
  application is a signal of interest and worth one call.
- **Q-AD75 · Composed per format (us).** (a) one render per aspect the publisher will send — two renders, twice
  the credits, each composed for its frame; (b) one render at the tallest used aspect, crop anchored on the
  subject the art director named; (c) keep the centre crop and only stop checking unused formats.
  **Recommended: (c) at once (it is a bug: an unused crop fails a good ad), then choose (a) or (b) from V4's
  price and the model's aspect behaviour** — neither is known until a model is chosen.
- **Q-AD76 · A judge for the finished ad (owner).** (a) a vision judge with a floor, creatives below it never
  reach review; (b) the same judge, score shown to the reviewer, no floor; (c) none — the person is the judge.
  **Recommended: (b) first, (a) once its scores have been compared with the owner's own approvals on 30 ads.**
  A floor set before that comparison is a number somebody picked.
- **Q-AD77 · Starter presets (owner).** (a) five starter presets shipped as adoptable data, the carrier edits
  them; (b) the owner types five for this carrier and other carriers start empty; (c) a wizard asks three
  questions and writes them. **Recommended: (a).** An empty Campaigns tab that cannot compose is the first thing
  every new carrier meets.

Questions this audit leans on and does not reopen: Q-AD17 (conversion leads under EMPLOYMENT), Q-AD20 (Higgsfield
key), Q-AD51 (the quality alert pauses nothing), Q-AD57 (the rating sheet), Q-AD68 (the next concept on a live
campaign).

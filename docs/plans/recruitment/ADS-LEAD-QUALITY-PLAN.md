# Ads lead quality — plan (LQ1–LQ4)

**Status:** planned 2026-11-09. **Owner ruled every recommendation the same day ("proceed as recommended"):** Q-AD47 (a), Q-AD48 (a) else (b), Q-AD49 (a), Q-AD50 (a), Q-AD51 (a). LQ1 built 2026-11-09 (#2131); LQ2a (0574, #2134) and LQ2b built the same day; LQ3a (0575 alert category) and LQ3b (the alert, its reader and its settings) built the same day; still to do: LQ2c (the queue's "Mine" filter: `recruiting_lead_queue` takes an assignee — a migration, then its reader) and LQ3c (the daily brief's quality figures, with the Analyst eval re-run); LQ4 waits on counsel. Owner's ask (2026-11-09): "make sure we get leads that are not random,
that are real and reliable", and "these updates must have no assumptions, gaps or blockers".
**Parent:** [`ADS-AGENT-PLAN.md`](ADS-AGENT-PLAN.md) (D-AD*, Q-AD*); build order and tracks per
[`ADS-AGENT-BUILD-WORKFLOW.md`](ADS-AGENT-BUILD-WORKFLOW.md). Opens Q-AD47–Q-AD52 (§9 of the parent; detail here).

## 0. Why this plan exists — what the audit of main (cd9180b) found

The pipeline after the form is sound (dedupe, verdicts, never-lost intake, outcome feed). The FORM itself is the
weakest link, and it is the one industry practitioners name first for junk leads:

| # | Gap on main | Where it is in code |
|---|---|---|
| G-LQ1 | The Instant Form is Meta's default "more volume" type: two taps submits, no review screen | `publisher.ts` `formParams` sends name, locale, questions, privacy, `block_display_for_non_targeted_viewer` — nothing else |
| G-LQ2 | The phone number is never verified | same — no SMS verification |
| G-LQ3 | The form never states the requirements before someone fills it | same — no intro (context card) |
| G-LQ4 | Someone who answers "no Class A" still becomes a lead, and the thank-you screen offers no next step | same — no thank-you page; filtering only happens after intake (`leadMatch`) |
| G-LQ5 | Nobody owns a lead: `recruiting_leads.assigned_to` exists (0553) but nothing writes it | `leadNotify.ts` header: "⚠ NO ASSIGNEE TIER" |
| G-LQ6 | The monitor judges an ad by cost per lead, which rewards cheap junk; nothing measures wrong numbers or time to first call | `monitorChecks.ts` (cpl_max, no_lead_spend); `recruiting_contacts.outcome` records `wrong_number`/`no_answer` but nobody reads it per campaign |
| G-LQ7 | The form collects no texting consent | Not a live risk: no path texts a lead automatically; a recruiter's text needs the attestation of `applicationInviteText.ts` (47 CFR §64.1200(a)(2)) |

## 1. Facts this plan stands on — each one read, with its source (2026-11-09)

Our client pins Graph **v26.0** (`META_GRAPH_VERSION`); Meta's official Business SDK `facebook-python-business-sdk`
main is `API_VERSION v26.0` (SDK 26.0.4), so its field lists are the same API version as ours.

| Fact | Source | Confidence |
|---|---|---|
| `POST /{page_id}/leadgen_forms` accepts `is_optimized_for_quality`, `is_phone_sms_verify_enabled`, `context_card`, `thank_you_page`, `custom_disclaimer`, `questions[]` (with `conditional_questions_group_id`, `dependent_conditional_questions`) | Page leadgen_forms reference; SDK `page.py` `create_lead_gen_form` params | Documented |
| `is_optimized_for_quality=true` "adds a step to the form submission flow where a person reviews and confirms their answers" | Marketing API, Lead Ads › Create | Documented |
| The LeadgenForm object READS BACK `is_optimized_for_quality`, `context_card`, `thank_you_page`, `legal_content`, `questions` — but **not** `is_phone_sms_verify_enabled` | SDK `leadgenform.py` field list | Documented by omission → Q-AD48 |
| `thank_you_page.button_type` includes `CALL_BUSINESS` (with `business_phone_number`, `country_code`) and `NONE`; `title` and `button_type` are required | Page leadgen_forms reference | Documented |
| `context_card`: `title`, `style` (`LIST_STYLE`/`PARAGRAPH_STYLE`), `content[]`, `button_text`; a custom cover photo upload needs `pages_manage_posts` (we send none) | Page leadgen_forms reference | Documented |
| Intro headline ≤ 60 characters; list bullet ≤ 80 characters | Meta Business Help "Add an Introduction section" (help/1664458123767694) | Documented |
| Thank-you headline/button ≤ 60 characters | Third-party guide only (Raka) | **Not documented** → we hold ourselves to it (stricter is safe) and L4 records Meta's answer |
| Ads Manager "Conditional logic" can CLOSE the form for a disqualifying answer (no lead created) | Meta help + practitioners | Ads Manager only. The API's `dependent_conditional_questions` is undocumented (no shape, no example) and reported invisible on read-back → **not used** (Q-AD49) |
| Higher-intent forms are delivered on mobile Facebook/Instagram feeds only | Practitioner guides (adsuploader, leadsync) | Not on a Meta page we could read → L4 reading; it does not change what we build (feed formats 4:5/1:1 already, Q-AD29) |
| Higher intent: −20–40 % volume, fewer "never signed up" leads; SMS verification: −32 % invalid numbers, 2.2× conversions (Cosentino) | Practitioner and vendor reports, not Meta measurements | Used as the reason, never as a threshold |
| Tenstreet: answering in ≤ 5 min → 6.2 % hire rate vs 3.7 % average; after 4 h below average | Tenstreet press release / Driver Pulse blog | Carrier data, 1.5 M drivers |

What is **not** known from any document, and how each one is closed (none is assumed):

1. Whether `is_optimized_for_quality`, SMS verification and the context card are accepted under the **EMPLOYMENT**
   special ad category → L4 sandbox reading (the contract suite creates the form; Meta's answer is recorded in
   `readings.recorded.json`). If Meta refuses one, the publisher drops nothing silently: the reading fails and Launch
   stays refused (`launchCertification.ts`) until this plan is revised.
2. Whether SMS verification is ON after create (no read-back field) → Q-AD48.
3. Meta's exact thank-you limits → L4 reading; we refuse above 60 before calling.

## 2. The steps

Each step is one PR to merged, under the workflow's rules (mutation-proved tests, `lint:ads-readiness` pins,
progress entry file, `pnpm ci:local --job gates,typecheck` + touched suites, CI the authority).

### LQ1 · The form asks better (Track W) — closes G-LQ1, G-LQ2, G-LQ3, G-LQ4 (the part Meta's API allows)

No migration. No new setting (Q-AD47 rec). Files: `packages/shared/src/ads/metaLeadForm.ts` (pure builders),
`platforms/meta/publisher.ts` (`formParams`, `FORM_FIELDS`, verify), `publishCampaign.ts` (brand kit phone in),
`simulator/fakeMetaForms.ts`, `contract/readings.ts` + `readings.recorded.json`, `publisher.contract.test.ts`.

1. `is_optimized_for_quality: true` on every form. Read back and verified (a form without it = `wrong` → refused,
   never adopted).
2. `is_phone_sms_verify_enabled: true` on every form; the form already carries Meta's `PHONE` prefilled question.
   Verified per Q-AD48.
3. `context_card` (`LIST_STYLE`), EN and ES, **derived, never written by a model**:
   - title: fixed sentence per language ("What this job needs" / "Lo que pide este trabajo"), ≤ 60;
   - bullets, each ≤ 80, built only from the frozen brief: "Class A CDL" always (the brief always asks
     `class_a_held`); "N+ years of Class A" from the brief's `quantity/year` claim; "N or older" from the
     `quantity/age` claim; "Hazmat endorsement" when `form_questions` holds `hazmat_endorsement`. **No pay bullet:** the
     ad already states pay, and no deterministic money formatter exists in shared today (pay wording is the
     Copywriter's, checked by `checkClaims`) — adding one is a separate change, not slipped in here;
   - the bullets pass `checkClaims` like any copy (a figure not in the brief cannot appear).
4. `thank_you_page`, EN and ES, fixed sentences: "Thanks — a recruiter will call you" + "Please keep your phone
   nearby." / "Gracias — un reclutador le llamará" + "Por favor, tenga su teléfono a la mano." No promised time (the
   office's hours are not recorded anywhere; promising "in 5 minutes" at 23:00 would be false). Button: **`NONE`**.
   *Changed while building (2026-11-09):* the plan said `CALL_BUSINESS` with the brand-kit phone, but Meta's
   reference documents `business_phone_number` only as "phone number string" and `country_code` with no format at
   all — sending either would be a guess. Q-AD53 below.
5. Preflight refuses, before any call, a context card or thank-you text over its limit (`form_text_too_long`).
6. FakeMeta's form endpoint accepts and echoes the new fields (except SMS verify, which it accepts but does not echo
   — mirroring the SDK), refuses `CALL_BUSINESS` without a phone, and the contract suite asserts all of it on fake
   AND sandbox. New readings (OURS until L4): employment acceptance of each field; thank-you limits; SMS verify
   behaviour per Q-AD48.
7. Only NEW campaigns get the new form. Meta forms are per campaign (`nameFor(..., "form", lang)` carries the
   campaign's short id). Nothing can be LIVE on Meta (Launch has refused every real account since #2078), but a
   campaign created paused before LQ1 would re-verify on its next publish and refuse
   `wrong: is_optimized_for_quality` — wanted: archive it and start a new one. The LQ1 chat counts such campaigns
   on production (`ads_campaigns` with `platform_refs ? 'meta_form_ids'`) before merging and reports the number.

Proof: unit (builders, both languages, every claim combination, limits), publisher verify (missing/false field →
refused), contract suite on fake; L4 reruns the same file on the sandbox (Publisher's certification is redone —
it is pending anyway). Owner approves the four EN/ES sentences in the PR (they are in the diff).

### LQ2 · Every lead has one owner (recruiting; Track S) — closes G-LQ5. Waits on Q-AD50.

With Q-AD50 (a) as recommended:
- **LQ2a migration** (next number at build time, read from main): `recruiting_openings.recruiter_id uuid null`
  (composite same-org FK pattern of 0553; identity row, not the version — the owner of an opening is not part of
  what the opening says). A column and its first reader ship in two merges (`lint:migration-ordering`).
- **LQ2b reader:** `ingest_lead` path sets `assigned_to` from the lead's opening's `recruiter_id` (an UPDATE in the
  sink, never a partial upsert); `lead_new` rings the assignee first, the alert list as today when there is none
  or the assignee no longer holds recruitment manage (derived from the access matrix, never a copied role list);
  `lead_uncontacted` escalates to the alert list. Openings drawer gets a "Recruiter" picker (people who hold
  recruitment manage, from the matrix). The lead queue gets "Mine".

### LQ3 · Quality is measured per campaign (recruiting reader + ads; Tracks W and S) — closes G-LQ6

- **Recruiting-owned `LeadQuality` interface** (the Q-AD34 pattern: recruiting reads its own tables, injected
  into the ads handlers), per Meta campaign id (`recruiting_leads.campaign_ref` holds Meta's `campaign_id`), over a
  window: leads; leads with ≥ 1 call attempt; `wrong_number` outcomes; `reached`; leads with a hard
  `does_not_meet` verdict; median minutes from `received_at` to the first attempt.
- **Daily brief** gains those figures (fact sheet rows; `checkNarration` unchanged). The Analyst eval is re-run
  and must pass twice again; until it does, the brief falls back to `plainBrief` with the same figures.
- **Monitor check `lead_quality`** — an ALERT (bell `ads_lead_quality`), **not a pause**, for the first weeks
  (Q-AD51): fires when, after a minimum number of attempted leads, the wrong-number share or the hard-does-not-meet
  share is above the owner's threshold. Thresholds live in the versioned ads settings (`auto_pause` group gets an
  optional `quality` sub-group, absent = off, the `outcome_feed` pattern of #2109 — the form must round-trip it).
  Settings screen section = Track S.
- Cost per lead stays (Meta measures it in minutes; a call outcome takes hours) — quality is ADDED, not swapped.

### LQ4 · Texting consent on the form (counsel) — G-LQ7. Deferred, not a blocker (Q-AD52)

Nothing texts a lead today without a recruiter's recorded attestation. A `custom_disclaimer` checkbox would let the
office text the application link right after the form. Wording is counsel's; until counsel answers, nothing is built.

## 3. Order and what blocks what

| Step | Needs | Blocks the first real ad? |
|---|---|---|
| LQ1 | Q-AD47 + Q-AD48 rulings; owner OK on 4 sentences | **Yes** — a form cannot be edited once published; the first campaign should carry it |
| LQ2a/b | Q-AD50 ruling | No — needed before more than one recruiter works leads |
| LQ3 | Q-AD51 ruling; LQ2 not needed | No — needed before scaling spend |
| LQ4 | Counsel (Q-AD52) | No |

Calendar if ruled today: LQ1 ~1 day (lands before the sandbox L4 runs, so Publisher is certified once, with it);
LQ2 ~1.5 days; LQ3 ~1.5 days. None needs a vendor credential to BUILD; LQ1's Meta acceptance is proven on the
sandbox run already planned (Stage 2).

## 4. Open questions (also in ADS-AGENT-PLAN §9)

- **Q-AD47 · Higher intent and SMS verification: always on, or a switch?** (owner) (a) Always on, in code, every
  form. (b) A switch in Ads control. **Rec (a):** every lead is called by a person, the case every source says
  calls for higher intent; a switch is a later, small change if measured volume falls below Q-AD18's floor.
- **Q-AD48 · How we prove SMS verification is on, when Meta does not return the field** (us). (a) At L4, read the
  form with `fields=is_phone_sms_verify_enabled`; if Meta answers, verify it like the others. (b) If Meta refuses
  the field: the owner opens the sandbox form's preview in Ads Manager once, sees the code step, and the
  certification record carries that as manual evidence — repeated only when `formParams` changes. (c) Drop SMS
  verification. **Rec (a), else (b).** Never (d) "sent it, so it is on".
- **Q-AD49 · Filtering out non-qualifying answers inside Meta's form** (us). The Ads Manager "close form" logic has
  no documented API shape. (a) Do not use it: the intro states the requirements (LQ1), our verdicts mark the lead
  (`leadMatch`), LQ3 measures the share. (b) Reverse-engineer `dependent_conditional_questions` from a form built by
  hand. **Rec (a):** (b) builds on an undocumented shape Meta can change without notice.
- **Q-AD50 · Who owns a new lead** (owner). (a) Each opening names a recruiter; their leads are theirs; no
  recruiter → everyone with recruitment manage, as today. (b) Round-robin among recruitment managers. (c) A
  "Claim" button, first to claim owns it. **Rec (a)** — also answer: how many people work leads today, and who.
- **Q-AD51 · Lead-quality alert thresholds** (owner). (a) Alert only for the first 4 weeks, owner-set thresholds,
  defaults 40 % wrong numbers / 40 % hard does-not-meet after 10 attempted leads (the 40 % is a practitioner rule of
  thumb — Upgrowth — shown as such in the help text). (b) Pause at the threshold from day one. **Rec (a)**, then
  re-decide with our own four weeks of numbers (plan §8).
- **Q-AD53 · A "Call us" button on the thank-you page** (us, found building LQ1, 2026-11-09). `CALL_BUSINESS` needs
  `business_phone_number` ("phone number string", error 192 "Invalid phone number") and `country_code` (no
  description) — neither format is documented, and no Meta example shows them. (a) After the L4 run, create one
  sandbox form with `CALL_BUSINESS`, `country_code` "US" and the number as `normaliseUsPhone` gives it, read it back,
  and record the reading; then add the button from the campaign's brand-kit phone. (b) Leave it `NONE`.
  **Rec (a), after L4** — a small change once Meta's answer is recorded; until then `NONE` (built).
- **Q-AD52 · A texting-consent checkbox on the form** (counsel; adds to Q-AD8). Wording and whether a form tick is
  prior express consent for an informational text. Deferred; nothing is built until answered.

## Sources (read 2026-11-09)

- Meta: [Page leadgen_forms reference](https://developers.facebook.com/docs/graph-api/reference/page/leadgen_forms/) ·
  [Lead Ads › Create](https://developers.facebook.com/docs/marketing-api/guides/lead-ads/create) ·
  [Intro section help](https://en-gb.facebook.com/business/help/1664458123767694) ·
  [Conditional answers help](https://www.facebook.com/business/help/154286325106161) ·
  SDK field lists: [`leadgenform.py`, `leadgenquestion.py`, `page.py`](https://github.com/facebook/facebook-python-business-sdk/tree/main/facebook_business/adobjects) (API v26.0)
- Practice: [adsuploader — form types](https://adsuploader.com/blog/facebook-instant-form) ·
  [leadsync — SMS verification](https://leadsync.me/blog/meta-leads-sms-verification/) ·
  [Upgrowth — false lead rate](https://upgrowth.in/facebook-lead-ads-fake-leads-never-filled-form/) ·
  [Raka — character limits](https://www.rakacreative.com/blog/digital-advertising/ad-character-limits-an-always-up-to-date-guide) ·
  [Tenstreet — speed to hire](https://www.tenstreet.com/blog/press-releases/tenstreet-reveals-how-carriers-can-cut-ad-spend-and-increase-speed-to-hire) ·
  [Tenstreet — Pulse](https://www.tenstreet.com/blog/driver-pulse/the-power-of-a-pulse-message) ·
  [Boostpoint — CDL leads](https://boostpoint.com/industries-trucking/truck-driver-leads/) ·
  [Meta CRM result (Salesgem)](https://salesgem.io/blog/conversion-leads-optimization-crm/)

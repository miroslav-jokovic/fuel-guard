# SMS opt-in — where an applicant agrees to be texted, and what that unlocks

**Created 2026-09-25.** Execution-grade. Companion to `SMS-PROVISIONING.md` (the carrier half, which
is finished) and to `docs/plans/recruitment/APPLICATION-SYSTEM-PLAN.md` §A11b (D-APP13, the consent
regime, whose table, gates and opt-out already exist). This document owns the one link that chain is
missing: **the place a person says yes**.

Every "today" below was read at the call site on `main` `cc87d86` or measured on production the same
day.

---

## 1. Where it stands (measured 2026-09-25)

| Layer | State |
|---|---|
| Telnyx number +1 833 352 1766 | `active`, toll-free, A2P, bound to profile `4001a077-…` |
| Railway `@fleetguard/api` | `SMS_PROVIDER=telnyx`, key, public key, from, profile — all set |
| Transport (`lib/sms.ts`) | built; tested against a stub; **never talked to a carrier** |
| Gates (`applicationSms.ts`) | consent, draft wording, number, quiet hours — built |
| Inbound (`/api/webhooks/sms`) | Ed25519-verified; STOP revokes, HELP answers — built |
| Callers that would text | the 48-hour nudge and the approval notice |
| `sms_consents` rows in production | **0** |
| Toll-free verification requests | **0** |
| Balance | $28.07 |

**Why nothing can be sent.** `recordSmsConsent` has no caller: no route, no screen. So `liveConsent`
is always null and every send holds on `no_consent`. And `SMS_CONSENT` is `v0-draft`, which refuses
both the grant and the send until counsel answers memo **Q12**.

**And why the application itself could never be texted, even with a route.** A11b's comment put the
checkbox *inside* the application form. The application link is the thing we want to text — a
consent collected behind it cannot authorise sending it. `applicationSend.ts` says as much ("SMS
cannot carry it"). The placement was the defect, not only the missing screen.

---

## 2. Decisions

| ID | Decision | Reason |
|---|---|---|
| **D-SMS1** | **Consent is offered on the applicant's own link as an optional card on the WAITING screens** — "We have your permissions", "They have your application", and approved-awaiting-the-office. It is never a step in the required path. | Three rules meet here. 47 CFR §64.1200(f)(9)(i)(B): agreeing must not be a condition of anything. CTIA and toll-free verification reviewers reject opt-ins that are required, pre-ticked, or bundled with terms. And the first waiting screen comes **before** the office sends the application, so a consent given there covers texting the application link. A waiting screen is also the moment the offer is useful to the person — "we will text you when the next step is ready" — rather than a hurdle between them and a form. |
| **D-SMS2** | **The box starts unticked, stands alone, and nothing else on the page depends on it.** It is not inside the ESIGN consent, not a sixth permission, and not part of any "terms and conditions". | §604(b)(2)'s stand-alone rule is already this product's idiom for instruments (`SmsConsentDocument.body`'s comment); here it is also what a carrier reviewer checks in the screenshot. |
| **D-SMS3** | **The applicant types the number; the number on file is never served on the bare link.** `autocomplete="tel"` makes that one tap on most phones. | Consent attaches to a NUMBER (0233). A number the person typed is a number they gave; a number we pre-filled is one they may not have read. And D-APP16's reasoning — an email is forwarded, a phone is shared — keeps personal data off an unauthenticated read. |
| **D-SMS4** | **The card links to two public pages: `/sms-terms` (the programme) and `/privacy#text-messages` (what happens to the number).** Both sit under `LEGAL_VERSION` beside the existing policy, and their facts are read from `@silvicom/shared` — the STOP keywords from `SMS_STOP_KEYWORDS`, the HELP answer from `SMS_HELP_REPLY` — never retyped. | Verification requires a privacy policy and terms URL a reviewer can open. The P3 legal pages (`/privacy`, `/terms`, `/support`) are already public, indexable and versioned, so these join them rather than living on a second website. Deriving the keywords means the page cannot promise a word the webhook does not honour. |
| **D-SMS5** | **One confirmation text after agreeing**, through `sendApplicationSms` with every gate — so outside civil hours it is held, and the card says "we will text you" rather than "we texted you". | CTIA's messaging principles expect an opt-in confirmation naming the programme, frequency, rates, HELP and STOP. It is also the first real round trip this system will ever make. |
| **D-SMS6** | **Withdrawing is as easy as agreeing**: a "Stop texts" control on the same card, and an office control to record a stop the applicant asked for any other way (a call, an email). Both go through `revoke_sms_consent`. | 47 CFR §64.1200(a)(10) (FCC 2024 order, in force 2025-04-11): consent may be revoked "by any reasonable means" and must be honoured within ten business days. STOP by text is one means; a phone call to a recruiter is another, and today the office has nowhere to record it. |
| **D-SMS7** | **Sending the application texts the link as well**, when there is a live consent. Email and the on-screen link are unchanged; the office's screen says which went. | The purpose the owner named (2026-09-25). Text and email both go regardless of one another, exactly as the nudge and the approval notice already do — a refused text is never an applicant hearing nothing. |
| **D-SMS8** | **While `SMS_CONSENT` is draft the card is not shown at all**, and the office panel says texts are not available yet. The server decides (`offered`), not the page. | The same rule the ESIGN consent and the ceremony follow: never ask for something the server will refuse to record. |
| **D-SMS10** | **The wording is published now, ahead of counsel** (owner, 2026-09-25: "for now we need to be able to use some texts"). `SMS_CONSENT.version = "sms-2026-09-25"`; counsel's redline (memo Q12) ships as the next version. | D-PR9's precedent for the privacy policy: carriers need a working opt-in to verify the number, and a review has no date. The risk is bounded by what the texts are — informational, about the person's own application, collected with full written consent anyway — and every row stores the text and version it was given under, so a later redline is visible in the data, not silent. |
| **D-SMS9** | **The wording stays a platform constant, not a carrier-published instrument** (it is not added to `org_disclosures`). | The sending number, the verification and the registered message content belong to one programme. A per-carrier wording would drift away from what the carrier network verified, and a verification is revoked for exactly that. Revisit with Q-SMS3. |

---

## 3. Steps

One PR may carry several; each is independently testable.

### SMS1 · The public API

`GET /api/public/application/:token/sms-consent` → `{ offered, document, granted }`: whether the
wording is final, the composed text, and — when there is a live consent for this applicant — the
last four digits of the number and when it was given. Never the full number (D-SMS3).

`POST /api/public/application/:token/sms-consent` with `smsConsentGrantSchema` (`{ phone, agreed: true }`)
→ `recordSmsConsent`, then the confirmation text (D-SMS5). Refuses: dead link (404), draft wording
(409 `sms_consent_not_final`), ESIGN consent missing (409, `requireEsignConsent`), a number that is
not a US mobile (400). A second grant on the same number returns the existing consent rather than a
second row.

`POST /api/public/application/:token/sms-consent/withdraw` → `revoke_sms_consent` on the live
number, reason `withdrawn on the application page`.

Own module (`publicApplicationSms.ts`), mounted inside the public router — `publicApplication.ts` is
at 421 of its 500 lines.

**Done when**: the three routes answer as above, every refusal has a test, and a mutation that drops
the ESIGN check or the draft check turns a test red.

### SMS2 · The applicant's card

`SmsOptInCard.vue` under the three waiting screens. Four states: offer, working, agreed ("Texts on
for the number ending 0123 · Stop texts"), withdrawn. The consent text is SERVED and shown in full
beside the box — never shortened into a summary — followed by the two links. The button is
disabled until the box is ticked and the number parses; "No thanks" is simply not ticking it.

**Done when**: the card renders only when `offered`, the box starts unticked, the Continue-style
action is absent (nothing on the page waits on it), and the agreed state survives a reload.

### SMS3 · The two public pages

`/sms-terms` — the programme: who texts, about what, how often, rates, STOP (all keywords), HELP (the
exact reply), support contact, carriers not liable for delays. `/privacy` gains a
`#text-messages` section: what is kept (`sms_consents`' columns, in words), never sold or shared for
marketing, how to withdraw. Route table snapshot and reachability test updated.

**Done when**: both pages render with no session, the keywords on the page are read from
`SMS_STOP_KEYWORDS`, and a test fails if a keyword is added to the constant but the page is not
rebuilt from it (it cannot be — that is the point of deriving it).

### SMS4 · The office

- `GET /api/recruitment/applicants/:driverId/sms-consent` (recruitment `view`) → state, last four,
  dates.
- `POST …/sms-consent/withdraw` (recruitment manage) → records a stop said any other way (D-SMS6),
  audited.
- `sendApplication` texts the link when there is a live consent (D-SMS7); `ApplicationSent` gains
  `texted`.
- `SendApplicationPanel` shows "Texts: on (…0123)" / "not agreed" / "stopped" / "not available yet",
  and after the press whether the text went.

**Done when**: the panel's four states render from the server's answer, and `sendApplication`'s test
proves a held or refused text leaves the email untouched.

### SMS5 · Owner and counsel acts (not engineering)

1. ~~Counsel publishes the wording.~~ Superseded by D-SMS10: published 2026-09-25 as
   `sms-2026-09-25` (§6). Counsel's answer to **Q12** (and Q-SMS1) still comes, and lands as the next
   version. ⚠ Until verification (step 3) the toll-free number is unverified, and carriers block
   unverified toll-free traffic — so an applicant can agree before then, and their confirmation text
   will come back `failed`. The card still shows "Texts are on", which is true of the consent.
2. Screenshot the card (SMS2) and the two pages (SMS3); host the images.
3. Submit toll-free verification (`SMS-PROVISIONING.md` §3) with those URLs.
4. First live round trip: agree on a test applicant, receive the confirmation, reply HELP, reply STOP,
   confirm the row is revoked.

---

## 4. Open questions

**Q-SMS1 — counsel, rides with memo Q12.** Approve the proposed wording, plus one sentence the card
adds: "See our SMS terms and privacy policy." And confirm that prior express consent (not *written*
consent) is enough for informational texts about the applicant's own application.
*Recommendation*: collect the written form anyway (it is what we already store), and ask only for
the wording.

**Q-SMS2 — counsel.** May the opt-in confirmation (D-SMS5) go outside civil hours, since it answers
an act the person just took, the way HELP does? *Candidates*: (a) hold it like every other message;
(b) send it immediately. *Recommendation*: (a) until counsel says otherwise — the cost is a
confirmation that arrives the next morning.

**Q-SMS3 — owner.** When a second carrier joins the platform, whose number texts their applicants?
One Silvicom number with each carrier's name in the message, or a number and a verification per
carrier? *Recommendation*: decide before onboarding one; nothing here blocks on it, and D-SMS9 keeps
the wording single until then.

**Q-SMS4 — owner.** The verification form needs a `corporateWebsite`. Is there a public
silvicominc.com, or does `360.silvicominc.com` serve? *Recommendation*: the company site if it
exists, with the privacy and terms URLs pointing at `360.silvicominc.com`.

**Q-SMS5 — owner.** The 48-hour nudge skips any applicant without an email, even one who agreed to
texts (`applicationNudgeSweep.ts`, `if (!nudge.email …) continue`). *Recommendation*: text-only
nudge for them; a separate, small step after SMS4.

---

## 6. The texts, and the verification submission they make

Every word below is rendered from code — this section is a copy for reading and for pasting into
Telnyx, and **the code is the source**: `packages/shared/src/smsConsentContract.ts` for the consent
and every message, `SmsTermsPage.vue` and `PrivacyPolicyPage.vue#text-messages` for the pages. If
the two ever disagree, the code is right and this section is stale.

### 6.1 What they were measured against (2026-09-25)

| Source | What it requires, and where we meet it |
|---|---|
| Telnyx toll-free verification guide — transactional checkbox template | "you consent to receive transactional text messages for [use case] from [Company]. Reply STOP to opt out. Reply HELP for help. Standard message and data rates may apply. Message frequency may vary." + links to Terms and Privacy; checkbox optional, never pre-checked; form branded with the registered business. → every clause is in `SMS_CONSENT.body`; the links sit under it on the card. |
| Toll-free verification, from 2026-09-15 | Privacy Policy and Terms URLs are required fields; they must state rates, frequency, HELP, STOP, and that mobile information and opt-in consent are not shared with third parties for marketing. → `/sms-terms` and `/privacy#text-messages`. |
| Carrier-expected privacy sentence | "No mobile information will be shared with third parties/affiliates for marketing/promotional purposes… opt-in data and consent… will not be shared with any third parties." → verbatim in substance on the privacy section. |
| CTIA Messaging Principles §5.1.2.1 (May 2023) | Confirmation carries: programme name, customer care, how to opt out, frequency, charges. → `smsOptInConfirmation`. HELP answer carries a way to reach support → `smsHelpReply` names the terms page. |
| Carrier sample-message rules | Business name in the first message; opt-out in at least one sample; no public link shorteners. → every message starts with the sender and ends with STOP; links are full, on our own domain. |
| 47 CFR §64.1200(f)(9)(i)(B) | Agreeing is not a condition of anything. → "not a condition of applying or of being considered for a job". |

Sources: [Telnyx verification guide](https://support.telnyx.com/en/articles/10729979-toll-free-verification-request-guide),
[Telnyx opt-in workflow](https://support.telnyx.com/en/articles/11898569-toll-free-opt-in-workflow-description),
[Twilio: Privacy/Terms URLs required](https://www.twilio.com/en-us/changelog/toll-free-verification-now-requires-privacy-policy-and-terms-and),
[CTIA Messaging Principles, May 2023](https://api.ctia.org/wp-content/uploads/2023/05/230523-CTIA-Messaging-Principles-and-Best-Practices-FINAL.pdf).

### 6.2 The consent (beside the unticked box)

> By checking this box, you agree to receive text messages from Silvicom Inc about your driver
> application at the mobile number you entered above — for example, a link to your application
> form, reminders about steps you have not finished, and updates on its status. These are not
> marketing messages. Message frequency varies. Message and data rates may apply. Reply HELP for
> help. Reply STOP at any time to opt out. Agreeing is optional: it is not a condition of applying
> or of being considered for a job.
>
> ☐ I agree to receive text messages from Silvicom Inc about my application.
>
> Text message terms · Privacy policy

### 6.3 Every message the programme sends

| Message | Text (carrier = Silvicom Inc) |
|---|---|
| Opt-in confirmation | Silvicom Inc: You're signed up for texts about your driver application. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out. |
| Application ready | Silvicom Inc: Your driver application is ready. Fill it in here: https://360.silvicominc.com/apply/… Your earlier link no longer works. Reply STOP to opt out. |
| 48-hour reminder | Silvicom Inc: Your driver application is saved. Pick up where you left off: https://360.silvicominc.com/apply/… This link replaces any earlier one. Reply STOP to opt out. |
| Approved | Silvicom Inc: Your driver application has been approved. We will contact you to arrange a visit to our office to sign it. Reply STOP to opt out. |
| HELP reply | Silvicom 360 driver application texts. Help: 360.silvicominc.com/sms-terms. Msg & data rates may apply. Reply STOP to opt out. |

⚠ No STOP confirmation is sent by us, and whether the toll-free network sends its own is unmeasured.
Find out on the first live round trip (SMS5.4) before adding one — the FCC allows one confirmation
within five minutes of an opt-out, and it must not try to win the person back.

### 6.4 The verification submission, field by field

| Field | Value |
|---|---|
| businessName | Silvicom Inc |
| corporateWebsite | ⚠ owner — Q-SMS4 |
| businessAddr1 / City / State / Zip | 1301 Armitage Ave / Melrose Park / IL / 60160 |
| Business registration number | ⚠ owner — the EIN, required since 2026-01-01 |
| entityType | Private for-profit |
| businessContact* | ⚠ owner — a named person, email, phone |
| phoneNumbers | +18333521766 |
| messageVolume | 1,000 (the lowest option; real volume is a few per applicant) |
| useCase | Account Notifications |
| useCaseSummary | Transactional text messages to truck-driver job applicants about their own application with Silvicom Inc: a link to their application form, a reminder when a step is unfinished, and a notice when it is approved. Messages go only to applicants who opted in on their own application page; no marketing, no third-party content. Messages are held outside daytime hours in every US time zone. |
| productionMessageContent | §6.3's first four rows, with a real link |
| optInWorkflow | Subscribers opt in digitally. An applicant receives a private application link by email from Silvicom Inc (https://360.silvicominc.com/apply/…). After signing their background-check permissions they reach a waiting page, where an optional, unchecked box offers text messages about their application, with the full disclosure, links to our SMS terms (https://360.silvicominc.com/sms-terms) and privacy policy (https://360.silvicominc.com/privacy#text-messages), and a field for their mobile number. The link is private to each applicant, so a screenshot of the form is provided. |
| optInWorkflowImageURLs | `https://360.silvicominc.com/compliance/sms-opt-in/sms-opt-in-1-offer.png`, `…-2-ticked.png`, `…-3-agreed.png` — taken from the production bundle on 2026-09-25 with only the applicant data mocked (the card is behind a private link). They live in `apps/web/public/compliance/sms-opt-in/`; **retake them if the card or the consent wording changes**, because a screenshot that no longer matches the live form is a verification a carrier can revoke. |
| Privacy policy URL | https://360.silvicominc.com/privacy#text-messages |
| Terms URL | https://360.silvicominc.com/sms-terms |
| additionalInformation | Silvicom 360 is Silvicom Inc's own driver compliance software, served at 360.silvicominc.com; the application pages and the SMS terms are on that domain. Opt-in is optional and is never a condition of applying. |

---

## 7. Progress log

Append dated lines here; never edit a table row above to record progress.

- 2026-09-25 — Plan written. Branch `claude/sms-opt-in`.
- 2026-09-25 — SMS1–SMS4 built on `claude/sms-opt-in`. Every step is dormant in production until
  `SMS_CONSENT` leaves `v0-draft` (D-SMS8): the card is hidden, grants answer 409, the office panel
  says "not available yet". Mutation-checked: dropping the ESIGN check, the double-press guard, the
  unticked default or the draft gate each turns a named test red. Screenshots taken at 390px against
  the preview build with the API mocked. ⚠ The terms page does NOT promise a STOP confirmation text:
  `handleInboundSms` sends none, and whether Telnyx's toll-free profile auto-replies is unmeasured —
  find out during SMS5.4's round trip before adding the sentence back.
- 2026-09-25 — The texts written (§6) against Telnyx's verification guide, the 2026-09-15 Terms and
  Privacy URL requirement, CTIA §5 and §64.1200(f)(9); published by the owner's ruling (D-SMS10).
  Every message moved into `smsConsentContract.ts` so the verification sample set is one file, and
  each carries sender-first, STOP, plain ASCII — pinned per message. HELP now names the terms page on
  the deployment's own host (`smsHelpReply(siteHostOf(WEB_APP_URL))`). Still owed by the owner for
  §6.4: the website, the EIN, a named contact, and the hosted screenshots.
- 2026-09-25 — #1050 merged and live (terms page in the production bundle). Owner's HELP test: webhook
  received and verified it, reply sent, Telnyx `delivery_failed` **40329 "Tollfree number is not
  verified"** — the wiring is proven and verification is the only blocker. Account read the same day:
  one number, profile enabled and US-only, no verification request, no 10DLC brand, $28.05. The EIN
  is the company's (Silvicom Inc), never a related company's: the registration number must match the
  legal name, and the verified business is the sender on record. Opt-in screenshots added to
  `apps/web/public/compliance/sms-opt-in/`.

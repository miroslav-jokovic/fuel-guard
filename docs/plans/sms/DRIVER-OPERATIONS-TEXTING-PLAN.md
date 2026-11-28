# Driver-operations texting: a second number and a second consent (Q-TR9 (a), Q-LMR9 (a))

Started 2026-11-27. Owner, on sending safety training to any phone number: "do as proposed and with
best practices", which ruled **Q-TR9 (a)**: a separate toll-free number, verified for driver
operations, with the office copying the link until it is live. This plan says what (a) actually
takes, because drafting its verification form showed it is more than buying a number.

## 1. Why a number alone is not enough

A toll-free number is verified for a **use case with an opt-in**. Our first number (+1 833 352 1766)
was verified on 2026-09-30 for applicants, and its opt-in is the unticked box on the application
(`SMS-OPT-IN-PLAN.md` §6). The carriers check three things before they verify a second one, measured
against the same sources as §6.1 of that plan:

1. **Who agrees, and how.** The verification form's `optInWorkflow` and `optInWorkflowImageURLs`
   need a real screen where the person agrees, with the full disclosure (programme name, frequency,
   rates, HELP, STOP, links to the terms and privacy pages). **For training sent to a typed phone
   number there is no such screen today**: the office types the number, the person agrees to nothing.
   Texting them would be texting without consent, which is what verification exists to stop.
2. **What the texts say.** Sample messages, with the business name first and STOP in at least one.
3. **Where the terms live.** `/sms-terms` and `/privacy#text-messages` describe the applicant
   programme only; they would need a section for driver operations.

`lib/sms.ts` checks nothing by design (its caller owns consent and quiet hours), so the day a second
number exists, any caller could text with it. The consent check has to exist first.

## 2. Proposed shape

| # | Step | Who | Size |
|---|---|---|---|
| T1 | A second consent instrument, `DRIVER_OPS_CONSENT`: "safety training, dispatch and load messages", next to `SMS_CONSENT` in `smsConsentContract.ts`, with its own rows in `sms_consents` (a new `source`). | Claude; counsel reads the wording | migration + shared, ½ day |
| T2 | **Where people agree:** an optional unticked box on the training page (`/t/<token>`, the link they already opened): "Text me when Silvicom Inc sends me safety training". Hired drivers also agree at onboarding (Q-LMR9 (a)'s office-recorded route). | Claude | 1 day |
| T3 | `/sms-terms` and the privacy section gain the driver-operations programme. The screenshots for the form are taken from T2's live box, as the first ones were. | Claude | ½ day |
| T4 | Buy the second toll-free number in Telnyx, about $1 a month. | **Owner** (spends money, account access) | 10 minutes |
| T5 | Submit the verification: same business fields as the first (EIN, contact), use case "Account Notifications", the T2 opt-in, the T3 links, sample texts. About a week. | **Owner** submits; Claude fills every other field | ~1 week waiting |
| T6 | Switch on: the training texter answers `canText` from the new consent, and the Send tab's "Can we text?" column and the phone-number option start texting. Dispatch (Q-LMR9) uses the same number and consent. | Claude | ½ day |

Until T6, the office copies the link (shipped: migration 0663 and its Send option).

## 3. Open questions

- **Q-DOT1: one number for training AND dispatch, or one each?** Recommendation: **one**. One opt-in
  ("driver operations") is clearer to the driver than two near-identical boxes, and carriers verify
  one use case per number. Dispatch quiet hours differ (a 02:00 load is work; Q-LMR9's own
  recommendation), so quiet hours are per message type, not per number.
- **Q-DOT2: may the office record a phone recipient's verbal "yes, text me"?** Recommendation: **no,
  not for people outside the roster**. A recorded verbal consent for a stranger's number is the
  weakest evidence there is, and the person is one tap away from agreeing on the training page
  themselves (T2). For hired drivers it stays Q-LMR9 (a)'s onboarding form.
- **Q-DOT3: counsel.** The new wording joins the Q1–Q17 memorandum. Building T1–T3 can go ahead;
  T5 waits for counsel's read, as the first number did.

## 4. Progress log

- 2026-11-27: written while drafting T5; the missing opt-in (§1.1) found. Q-TR9 (a) ruled by the
  owner the same day; T1–T6 not started. 0663 + the Send tab's phone-number option ship the
  copy-the-link path meanwhile.

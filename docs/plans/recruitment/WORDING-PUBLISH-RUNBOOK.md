# Publishing the application wording — runbook

> # ⚠ SUPERSEDED 2026-09-14 by D-WORD1. There is nothing to publish and nothing to press.
>
> The owner ruled that asking a carrier to approve six legal documents before their product works
> was the wrong shape. The product now **ships** the wording — FMCSA's mandated PSP form, FMCSA's
> Clearinghouse sample with the scope §382.701(b) forces, the 7001(c) statute, and the carrier's own
> counsel off packet pages 19/14/21 — at versions that are not drafts, so every gate is open on
> deploy. `/settings/application-wording` was deleted with the same change.
>
> **Read `WORDING-REVIEW-2026-09-13.md` and `defaultWording.ts` instead.** What survives below is
> the production measurement in §1, which is still true about which applicants can be reached, and
> §2, which records three defects that were fixed on the way here.
>
> ⚠ Publishing still EXISTS, as an override for a carrier whose counsel wants different text — but
> it has no UI by deliberate choice, and `POST /api/recruitment/wording` is the only safe writer.


**The owner ruled path (b) on 2026-09-13**: rather than wait for `COUNSEL-REVIEW-PACKAGE.md` to come
back, the carrier publishes now at `/settings/application-wording`.
`HANDOFF-2026-09-13-QUEUE.md` §3.1 is the decision this closes.

> ⚠ **REVISED the same day, and the revision changes what you press.** The original plan was to
> adopt OUR placeholder text, and §0 below was written for that. It is no longer the plan. Four of
> the six instruments now have a proper source — three from your own packet and one from FMCSA — so
> **the editor must be loaded from that source before you publish**, not published as it opens.
> `WORDING-REVIEW-2026-09-13.md` is the sheet that says where each one comes from and what was
> changed on the way. §3 below is the corrected procedure.

This document is what that costs, what it frees, and the three defects that had to be fixed first —
because **publishing is what arms them**. Every one was invisible while `org_disclosures` was empty.

---

## 0. Read this before you press Publish

Publishing makes a text **the one every applicant signs from then on**, numbered and kept for ever.
Where it comes from now differs by instrument:

| Instrument | Whose words | Yours to change? |
| --- | --- | --- |
| Consumer reports (FCRA) | your lawyers, packet page 19 | yes |
| Previous employer | your lawyers, packet page 14 | yes |
| Drug & alcohol | your lawyers, packet page 21 | yes |
| **PSP** | **FMCSA, mandatory** | **no — publishing anything else is refused** |
| Clearinghouse | ours (placeholder) | yes — and no applicant signs it |
| Electronic-records consent | ours, quoted from 15 U.S.C. 7001(c) | yes |

⚠ For the two still on our placeholders you are becoming the author of record for text an engineer
wrote. That is the trade the owner has weighed; counsel's eventual wording lands as `v2`.

⚠ **It is per-carrier, and there are two organisations.** Publishing in one does nothing for the
other. `Silvicom Inc` (`86d6b3ea-4361-4f71-877f-e8373615769b`) is the one that matters;
`FuelGuard EFS QA` (`07fe4058-…`) holds one revoked test link and six seeded authorizations.

---

## 1. What publishing actually frees — measured 2026-09-14 00:34 UTC

⚠ **Not four drafts. One.** `HANDOFF-2026-09-13-QUEUE.md` §2.1 counted four `application_drafts`
rows and read them as four people waiting. Three of the four links they hang on are already dead:

| Applicant | Invited to | Furthest screen | Link expires | Nudged | Usable now |
| --- | --- | --- | --- | --- | --- |
| Marija Varmeda | `safety@silvicominc.com` | **`certify`** — the end | 2026-09-27 | **2026-09-13 19:28 UTC** | **yes** |
| Marija Varmeda | `safety@silvicominc.com` | *(nothing typed)* | 2026-09-18 | no | yes |
| VINCE STEFANOV | `vince@silvicominc.com` | `licence` | 2026-09-12 | 2026-08-29 | **no — expired** |
| Tanja Vlaisavljevic | `safety1@silvicominc.com` | `addresses` | 2026-09-09 | 2026-08-26 | **no — expired** |
| Miroslav Jokovic | personal Gmail | `documents` | 2026-09-05 | no | **no — revoked, and the QA org** |

So publishing frees **one** application — and it is the valuable one, the only form in the product
that has ever reached its last screen. The other two Silvicom drafts need a fresh invitation, and
⚠ **a fresh invitation resumes an EMPTY form**: `application_drafts` is keyed on the invitation, so
Vince's and Tanja's typing does not follow them to a new link. That is a decision to take
deliberately, not a side effect to discover.

⚠ **The certify link was rotated by the abandonment sweep at 2026-09-13 19:28 UTC** — `nudged_at` is
set and `expires_at` is exactly fourteen days after it. 0232 rotates the token when it nudges, so
**the link Marija was originally sent no longer works**; the one in the most recent nudge email does.
Anybody who tells her to "reopen the link we sent you" will send her to a 404. This is the
interaction `HANDOFF-2026-09-13-QUEUE.md` flagged as a risk; it has happened.

⚠ Every invitation went to a carrier mailbox (`safety@`, `safety1@`, `vince@`) rather than to the
applicant's own address. Three distinct named drivers, all reachable only through the office.

---

## 2. Three defects that publishing arms, all fixed 2026-09-13

Each was invisible for one reason: **the tests publish by mocking a module constant, and production
publishes a row.** Since 0338 the constants stay `v0-draft` for ever, so any code that reads them
never notices the carrier. That substitution is the trap to remember.

### 2.1 The §390.32(d) consent gate was a no-op on three write paths — measured

`requireEsignConsent(invitation, wording)` had a default: the code's placeholders, under a comment
asserting a forgetful caller therefore failed CLOSED. **That polarity is inverted for this one
function.** It refuses only while the consent *can* be given, so `v0-draft` means "do not ask" — and
`saveDraft`, `openSession` (captures) and `recordRelease` all took the default.

Measured against a seeded `org_disclosures`, consent not given:

| Path | Before | After |
| --- | --- | --- |
| `PUT /:token/draft` | **200** | 409 `esign_consent_required` |
| `POST /:token/capture` | **201** | 409 |
| `POST /:token/release` | **201 — signature written** | 409, nothing written |
| `POST /:token` (submit) | 409 | 409 |

The release is the one that matters: a `driver_authorizations` row, signed electronically, for
somebody who had never agreed to sign electronically. That is the gap A4 exists to close, and it
would have opened the instant the first carrier pressed Publish. The parameter is now required, so
the type system asks the question. Pinned by "with the carrier's wording published as rows, and no
consent given" (`publicApplication.test.ts`), and each of the three proved by mutation.

### 2.2 The office's own signature carried the placeholder text

`POST /recruitment/authorizations` — the recruiter recording a wet or verbal signature — composed the
instrument from the code catalogue. After a publish, the same instrument for the same carrier would
be `v1` when the driver signed it on their phone and `v0-draft` when the office recorded the paper
copy: one driver's file, two texts, no way to tell afterwards which they read. It now reads the
carrier's published wording, falling back to the placeholder exactly as everywhere else.

⚠ This path still has **no draft refusal**, unlike the applicant's. Whether the office may record a
wet signature on placeholder text is a policy question, not an engineering one — left as it was
rather than silently withdrawing a capability. Raise it with counsel.

### 2.3 A revocation named the wrong version

The revoke route's own comment says the version is "carried from the grant so the revocation names
what was withdrawn, not a newer wording". It read the current catalogue instead — indistinguishable
while everything is `v0-draft`, and wrong from the first publish: a `v1` grant would have been
revoked under `v0-draft` and the append-only history would stop joining up. It now reads
`disclosure_version` off the grant row, which is what the comment always claimed.

---

## 3. The runbook — about ten minutes

Nothing needs typing. The editor opens on whatever is live, and where a proper source exists a
second button loads it.

1. Sign in to the production web app as a user with **manage `settings`** in **Silvicom Inc**.
   Reading the page needs only `recruitment view`; publishing needs `settings`.
2. **Settings → Application wording** (`/settings/application-wording`). The callout at the top reads
   *"6 of 6 documents still use our placeholder wording."* That number is the only thing on the page
   worth watching.
3. For each card: **Review and publish** → ⚠ **if the card offers "Use our packet's wording" or
   "Use the FMCSA wording", press it first** → read what is now in the boxes → **Publish**. A toast
   names the assigned version, which will be `v1`.
   - Four cards offer that button. The sentence beside it says where the text comes from.
   - ⚠ **PSP is the one you cannot get wrong quietly.** Press **Use the FMCSA wording**; if you
     publish anything else the API refuses and names the paragraph that is missing. FMCSA requires
     its language *"in whole, exactly as provided"*, and a report pulled behind an edited consent
     breaches the account-holder agreement your API token is issued under.
   - ⚠ The electronic-records consent is six fields, not one — 15 U.S.C. 7001(c)(1)(B)(i)(I) through
     (c)(1)(C)(i). It has no source button; publishing refuses a gap and names the empty clause.
4. Stop when the callout turns green: *"All 6 documents are published. Applicants can sign and send."*

⚠ **Publish all six even though only five gate the applicant.** `clearinghouse` is deliberately
absent from `APPLICATION_RELEASE_ORDER` — §382.701(a)'s consent is given inside the FMCSA portal —
so the driver's path is unblocked by the other five. But the page counts all six, and an office
staring at a permanent "1 of 6 outstanding" will eventually stop reading the number.

There is no migration and no deploy. The rows take effect on the next page load.

## 4. Verify, in this order

```sql
-- 1. Six rows, all v1, for Silvicom Inc and nobody else.
select instrument, version, published_at, left(body, 60) as opens_with
  from org_disclosures
 where org_id = '86d6b3ea-4361-4f71-877f-e8373615769b'
 order by instrument;
-- ⚠ `psp` must open with "In connection with your application for employment with Silvicom Inc".
-- `fcra_disclosure` with "The Federal Motor Carrier Safety Regulations (FMCSR) require". If either
-- opens with anything else, our placeholder was published instead of the real thing.

-- 2. The audit says who, and names the instrument rather than copying the text.
select action, meta, created_at from audit_logs
 where action = 'disclosure_published' order by created_at desc;
```

3. Open Marija's application link — **from the 2026-09-13 nudge email, not the original** — and check
   that it opens on the electronic-records consent rather than on the form. That is the gate from
   §2.1 doing its job; before today it would have gone straight to the form.
4. Agree, sign the four releases, and confirm the certify button is no longer refused. The
   application files, the driver becomes a `driver_applications` row, and the packet has something to
   render for the first time.

## 5. What this does not do

- **It is not counsel's review.** `COUNSEL-REVIEW-PACKAGE.md` has been packaged since 2026-08-23 and
  is still the correct path; publishing now means counsel's eventual text lands as `v2`, which is
  what the version numbering is for. ⚠ If counsel returns text staged, **A6 — the ESIGN consent —
  first**: it gates every other write path.
- **It does not resurrect the two expired drafts.** Vince and Tanja need new invitations and will
  find empty forms.
- **It does not settle page 3 of your packet**, which combines a consumer-report disclosure with a
  liability release — `WORDING-REVIEW-2026-09-13.md` §4.1. Page 3 keeps printing as it is; the
  owner ruled on 2026-09-13 that it stays unchanged for now.
- **It does not fix `MAIL_FROM`.** It is still a bare personal Gmail address in production, which is
  the sender an applicant will see on the approval notice Q-AX4 now sends.

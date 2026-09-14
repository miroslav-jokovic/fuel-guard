# Checklist — from here to drivers actually using it

**One item at a time, in this order.** Each has a done-when that is checkable, because "looks
right" is how the last four defects in this feature reached production.

State at the top of this list: `main` `3e21d3c`, no open PRs, no migration pending, production
serving it. **0 applications have ever been filed.** Background is
`HANDOFF-2026-09-14-WORDING.md`; the wording research is `WORDING-REVIEW-2026-09-13.md`.

⚠ **Do not start B, C or D before A2 is green.** Everything below A is built on the assumption
that a driver can complete the flow, and nobody has ever seen one do it.

---

## A. Prove it works at all — before any stranger gets a link

### A1 · The sender address — ⏳ OWNER, in progress, and it is now also a PROVIDER decision
Currently `MAIL_FROM=uncchicago85@gmail.com`. Owner is setting up a verified domain sender;
`silvicominc.com` was added to Brevo 2026-09-14 17:03 UTC and is `authenticated: false` so far.

⚠ **Verify that domain at Resend, not at Brevo.** Measured 2026-09-14, and it is the reason the
provider preference in `env.ts` was reversed:

- **Brevo rewrites every link for click tracking and keeps the destination URL in its event log.**
  An applicant's live invitation link was read straight out of `GET /v3/smtp/statistics/events` in
  plaintext, and `sha256(token)` matched that invitation's `token_hash` byte for byte. Anyone with
  `BREVO_API_KEY` can enumerate live applicant links — a 256-bit bearer token that
  `applicationIntake.ts` deliberately keeps out of the database, out of later API responses and out
  of the audit row.
- **It cannot be turned off.** Brevo's staff say disabling transactional tracking is not planned and
  is an Enterprise-plan request; this account reports `enterprise: false`. The `X-Mailin-Track`
  headers that circulate as a workaround are absent from Brevo's API reference — do not ship one.
- **Resend has open and click tracking off by default** on every domain, and per-domain via
  `PATCH /domains/:id`. The mailer already supports it (`MAIL_PROVIDER=resend`, `RESEND_API_KEY`).

**Our part once it lands** (not before):
- Confirm `MAIL_FROM`, `MAIL_PROVIDER` and the key in Railway, prod, on the `api` service. The boot
  log now warns on every start that lands on Brevo — `railway logs` is the check.
- Send one real invitation and confirm it arrives — ⚠ `lib/mailer.ts` documents Brevo's
  `422 Invalid from field`; Resend's equivalent is a 403 "domain not verified".
- ⚠ Confirm the link in it is NOT rewritten to a tracking host, and that no `clicks` event carries
  the token.

**Done when:** an invitation sent from the new address arrives in an external mailbox, the link in
it opens the apply page, nothing in the log says `send_failed`, and the token does not appear in any
provider-side event log.

### A2 · ⚠ THE ONE THAT MATTERS — walk a real application end to end
Nobody has. Eight PRs of behaviour change ride on it.

Use **Marija's existing link** — `safety@silvicominc.com`, draft at `certify`, expires
**2026-09-27**. ⚠ **Her token was rotated by the abandonment sweep on 2026-09-13 19:28 UTC, so only
the link in THAT email works.** The original is dead; sending her to it gives a 404 and wastes the
one finished draft in production.

Expect, in this order: the 7001(c) consent screen first (her `consented_at` is null and the gate is
now armed) → four signature screens, one instrument each → the form, already filled in → certify.

**Done when:** `select count(*) from driver_applications` is **1**, and
`select purpose, disclosure_version from driver_authorizations where org_id = '86d6b3ea-…'` shows
four rows with `fmcsa-2016-02-11` on the PSP one — i.e. she signed FMCSA's text, not a placeholder.

#### A2 pre-flight — measured 2026-09-14, everything that can be checked without spending her token

`GET /api/public/application/:token` only reads, so none of this cost anything. What is left is the
part only the applicant can do.

- **The walk will exercise exactly this code.** Production serves `9e557f8`, HEAD is `8086eef`, and
  `git diff --stat` between them is five doc files and `CLAUDE.md` — no source. `/api/version`
  reports schema `applied: 0338`, `state: current`, `drift: false`.
- **She will be served the shipped defaults, not an override.** `org_disclosures` is **0 rows fleet
  wide**, so `loadCarrierWording` falls through to `defaultWording("Silvicom Inc")`. Resolved from
  the deployed build:

  | instrument | version | body |
  | --- | --- | --- |
  | `fcra_disclosure` | `packet-2026-08-21` | 498 ch |
  | `psp` | **`fmcsa-2016-02-11`** | 6,018 ch |
  | `previous_employer` | `packet-2026-08-21` | 3,085 ch |
  | `drug_alcohol` | `packet-2026-08-21` | 728 ch |
  | `esignConsent` | `15usc7001c-2026-08-21` | — |

  None is a draft, so `applicationWordingIsDraft` is false: the ceremony and the submission are both
  open, and the consent gate is armed. **The done-when's `fmcsa-2016-02-11` is therefore already
  determined by the code** — if she signs, that is the version the PSP row carries.
- **The baseline is a clean zero.** Silvicom holds **0** `driver_authorizations`. All six `v0-draft`
  rows are the QA org (3 `fcra_disclosure`, 3 `psp`) — D2's, not hers.

#### ⚠ A2 trap — there are TWO live invitations for the same driver row

Both point at driver `Marija Varmeda`, and only one carries her typing:

| invitation | created | expires | nudged | draft |
| --- | --- | --- | --- | --- |
| `6e03a1e5-6fe0-4831-b017-9450f2635626` | 09-11 | **2026-09-27** | 09-13 19:28 | **`certify`** |
| `3836e5a3-e4a8-49c6-b534-4bff9b2d22ce` | 09-04 | 2026-09-18 | never | **none** |

The 09-04 link was never rotated, so **it still works** — and it opens an EMPTY form. Finishing on
it produces the application row the done-when asks for while quietly costing her the whole form
again. The link to use is the one in the **2026-09-13 19:28** email, not the 09-04 one.

#### A2 delivery — measured 2026-09-14, and "it stopped working" is not what happened

Brevo's event log for `safety@silvicominc.com`, and a month of events besides:

- **Today's invitation was delivered.** `requests` 16:39:20.944 UTC → `delivered` 16:39:22 UTC,
  two seconds later. Across 2026-08-15 → 09-14: **60 requests, 60 delivered**, one deferred that
  then delivered, and **zero** bounces, blocks or spam complaints. Delivery has never been broken.
- **It worked on 09-11, and the trail proves it.** That invitation was delivered 17:42:30 UTC and
  clicked at 17:51, 17:53, 18:59 and 19:50 — and the draft was saved at 18:00:23 UTC, between two
  of them. That is a human using the link.
- ⚠ **`opened` NEVER fires for an `@silvicominc.com` address.** Sixteen `opened` events in the
  month, every one of them to an external mailbox (`admin@lorddigital.com`, `mike@fleetpal.io`,
  `stalxdevelopment@gmail.com`). Their gateway strips the tracking pixel, so **we cannot tell from
  the provider whether anyone at the carrier has read anything.**
- ⚠ **Every link is machine-clicked within ~15 seconds of delivery**, on every alert, at 02:14 and
  03:14 and 05:38, several IPs at once. On this domain **"delivered" is evidence and "clicked" is
  not** — do not read a click as the applicant opening their link.
- The scanner does no harm: `GET /:token` only reads, and the link returned HTTP 200 with all four
  instruments after being scanned. It does mean the token reaches the scanner's operator too.

So today's email is delivered and unread by a human. That is a mailbox question — junk or
quarantine — not a product one, and ⚠ the `uncchicago85@11580692.brevosend.com` envelope sender is
the likeliest reason a filter took it. **That is A1.**

#### ⚠ A2 blocker — the working link exists in exactly one place, and it is not here

`mintInvitationToken` (`applicationIntake.ts:44`) stores a SHA-256 and nothing else, so the
plaintext is **not recoverable from the database, the audit log, or the API**. Her link exists only
in that one nudge email. And nothing can mint a replacement for that invitation — see Q-AX5 in
`APPLY-EXPERIENCE-PLAN.md` §4: the staff routes are list / create / revoke, the sweep is the only
rotator and it fires once (`nudged_at` stamped; the copy says "we will not send another reminder").
Creating a new invitation starts her from an empty form, which is D1's finding.

**So A2 needs one of:** the link pasted out of that mailbox, or Marija opening it herself. The four
signatures and the §391.21 certification are attestations by a named person about her own SSN, date
of birth and employment history — they are hers to give, not something to type on her behalf.

**When she finishes, verify with:**

```sql
select count(*) from driver_applications;                         -- expect 1
select purpose, disclosure_version, signed_at
  from driver_authorizations
 where org_id = '86d6b3ea-4361-4f71-877f-e8373615769b'
 order by purpose;                                                -- expect 4; psp = fmcsa-2016-02-11
select consented_at, releases_completed_at, submitted_at
  from application_invitations
 where id = '6e03a1e5-6fe0-4831-b017-9450f2635626';               -- expect all three stamped
```

### A3 · Document capture on a real phone
Nine screens and a photo upload have never run on real hardware in production. The staging →
promotion path (`applicationCapture.ts` → `documents` at submit) is tested and unexercised.

**Done when:** a licence photographed on a phone appears as a `documents` row after submit, and the
stored object is in `compliance-docs` rather than left in `application-captures`.

### A4 · Check two production variables — ✅ DONE 2026-09-14
Read off the `@fleetguard/api` service, `production` environment (79 variables in all).

- **`TELNYX_FROM` = `+18333521766`**, and `TELNYX_MESSAGING_PROFILE_ID` =
  `4001a077-1066-4b5d-b44e-50fdb9a96843`. **Both are set, so the approval notice's SMS half does
  send.** ⚠ This corrects the standing note that SMS is "dark for want of a phone number" — a
  number exists now, and the first approval notice will text as well as email.
- **`APPLICATION_NUDGE_ENABLED` is absent from all 79.** `env.ts:191` defaults it to `"true"`, so
  **the abandonment sweep is live** and rotates tokens when it fires. Confirmed in the data rather
  than only in the schema: three of the five invitations carry a `nudged_at` stamp, which is how
  A2's link moved.
- Recorded alongside, because A1 turns on them: `MAIL_FROM` is still **`uncchicago85@gmail.com`**,
  `MAIL_PROVIDER=brevo`, `WEB_APP_URL=https://fleetguardweb-production.up.railway.app` (so a link
  is `https://fleetguardweb-production.up.railway.app/apply/<token>`).

**Done when:** both values are written down in this file. ✅

---

## B. Make a hire completable — needed before you act on what comes back

⚠ You can safely COLLECT applications after A. You cannot lawfully DECLINE one, or finish a
qualification file, until B is done.

### B1 · ⚠ Adverse action (R10) — the biggest exposure, and it is new
`R10` was deferred on the reasoning that §604(b)(3)(B) carves trucking out of the
before-adverse-action copy requirement. **That reasoning is now incomplete.** FMCSA's PSP
disclosure — which every applicant reads and signs from #764 onward — *promises* them a copy of the
report and a written FCRA summary before final adverse action, and within three business days after
it for applications taken by mail, telephone or computer. The carve-out governs the **timing**; it
does not release you from a promise you made in your own signed instrument.

Read the exact words in `docs/plans/recruitment/psp-disclosure/…​.txt`, paragraphs 2 and 3.

**Done when:** counsel has ruled on what the promise obliges, and either the sequence is built or
the ruling is written into `ADVERSE-ACTION` with a date.

### B2 · MVR — procurement, not a build
§391.23 requires a driving record at hire. There is no vendor, no `mvr` member in
`AUTHORIZATION_PURPOSES`, and `SCREENING_PREREQUISITES.mvr_order` is called by nothing.
⚠ Your lawyers already wrote the authorization — **packet page 18** — and the product has nowhere
to put it. SambaSafety was deprecated on cost 2026-08-26; that decision is revisitable.

**Done when:** a vendor is chosen. Then: the instrument, the purpose, the pull, in that order.

### B3 · Counsel sign-off on electronic use
The wording is now FMCSA's forms, the statute, and your own counsel's packet pages — far stronger
than the placeholders. ⚠ But their pages 14/19/21 were written for **paper**, and nobody has asked
them whether they are content to have them signed electronically, with our spelling repairs.
`WORDING-REVIEW-2026-09-13.md` §2 lists every character we changed, and §2.3 the seven defects we
deliberately left.

**Done when:** counsel has seen that review sheet and said yes, no, or "change these".

### B4 · Clearinghouse limited-query consent has nowhere to be collected
The instrument now exists (FMCSA's sample + the scope §382.701(b) forces) and nothing asks for it.
It is deliberately NOT on the applicant's path — §382.701(a)'s pre-employment FULL query consent is
given inside the FMCSA portal — so this belongs to a safety-manager workflow (D-REC4 / R5).

**Done when:** a safety manager can collect it, and it lands as a `driver_authorizations` row.

---

## C. Finish the artifacts

### C1 · P12 — the derived PSP tables
`psp_inspections` / `psp_violations` / `psp_crashes`, derived inside the same transaction as the
`qualification_records` row and re-derivable from `response_raw` alone. Done-when is already
written in `PSP-PLAN.md` §P12. **Next migration number is 0339.**

⚠ **`response_raw` is a one-element ARRAY** — the records are at
`response_raw[0].driverInformationResponse.driverRecord.{inspectionRecords, crashRecords}`, not at
the top level as the OpenAPI document and §5b.1's table both imply. Build the fixture from the
production row.

### C2 · The cross-match panel — only after applications exist
`crossMatchEmployment` is written; its only callers are two tests. ⚠ **D-PSP5, twice deliberate:**
it corroborates and discovers, it can NEVER refute. A driver can work two years somewhere and never
be inspected once, so a UI that reads silence as doubt manufactures accusations against exactly the
drivers who drive cleanly. Also: there is still **one** `psp_requests` row in all of production.

### C3 · P5/P6 — the packet, 26 of 31 pages
The largest piece, and the one that makes "complete, ready to print" true.
`packages/shared/src/packetPlacements.ts` is the measured inventory — **28 placements, 22 the
driver's across 19 pages** (p17 added 2026-09-14, D-PKT12) — each pinned by a test that re-reads the
workbook. **`driverPlacements()` IS the queue**;
there is no arithmetic left, only interaction. ⚠ Its old blocker (would be built twice against
`v0-draft`) is **gone** — the wording is final.

---

## D. Housekeeping

- **D1 · Reissue the two expired links** (Vince `2026-09-12`, Tanja `2026-09-09`). ⚠ A replacement
  invitation resumes an **EMPTY** form — `application_drafts` is keyed on the invitation, so their
  typing does not travel. Decide that deliberately rather than discover it.
- **D2 · The 6 `driver_authorizations` in the QA org** were signed under `v0-draft` placeholder
  text, before any of this. They are historical rows in a test org; decide whether they are deleted
  or left as a record.
- **D3 · The git hooks are not committed.** `.git/hooks/post-commit` and `post-merge` keep the
  graphify graph fresh on this machine only. Another machine needs them re-created plus one
  `pnpm graph:update`. Moving them to a committed `core.hooksPath` is a small job if it matters.

---

## Rules that apply to every item above

- ⚠ **Prove a test can fail.** Mutate the code it covers and watch it go red. Ten assertions in this
  feature once passed while proving nothing.
- ⚠ **Seed `org_disclosures`; never publish by mocking a constant.** That substitution hid a live
  §390.32(d) hole for the whole of A4's lifetime.
- ⚠ **Ask the database before ordering work.** Two queue items were ranked by size and neither
  ranking survived one afternoon of counting rows.
- One step per PR, gates green, merge commit — never direct to `main`.
- `pnpm graph:update`, never a bare `graphify update .` (the PATH copy drops all 351 migrations).

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

### A1 · The sender address — ⏳ OWNER, in progress, expected 2026-09-15
Currently `MAIL_FROM=uncchicago85@gmail.com`. Owner is setting up a verified domain sender.

**Our part once it lands** (not before):
- Confirm `MAIL_FROM` and `MAIL_PROVIDER` in Railway, prod, on the `api` service.
- Send one real invitation and confirm it arrives — ⚠ `lib/mailer.ts` documents Brevo's
  `422 Invalid from field`, which is what an unvalidated sender returns.
- ⚠ Check the invite link survives the recipient's scanner. `invite-links-are-opened-by-Proofpoint`
  is a live trap in this product's history: a scanner that follows the link can spend it.

**Done when:** an invitation sent from the new address arrives in an external mailbox, the link in
it opens the apply page, and nothing in the log says `send_failed`.

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

### A3 · Document capture on a real phone
Nine screens and a photo upload have never run on real hardware in production. The staging →
promotion path (`applicationCapture.ts` → `documents` at submit) is tested and unexercised.

**Done when:** a licence photographed on a phone appears as a `documents` row after submit, and the
stored object is in `compliance-docs` rather than left in `application-captures`.

### A4 · Check two production variables — 10 minutes, do it alongside A2
- `TELNYX_FROM` or `TELNYX_MESSAGING_PROFILE_ID`: if neither is set, the approval notice's **SMS
  half silently does not send**. The email always goes, so this degrades rather than breaks.
- `APPLICATION_NUDGE_ENABLED`: unset means **true**, so the abandonment sweep is live and rotates
  tokens when it fires (that is how A2's link moved). Fine — but know it before telling anyone to
  reopen an old link.

**Done when:** both values are written down in this file.

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
`packages/shared/src/packetPlacements.ts` is the measured inventory — 27 placements, 21 the
driver's — each pinned by a test that re-reads the workbook. **`driverPlacements()` IS the queue**;
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

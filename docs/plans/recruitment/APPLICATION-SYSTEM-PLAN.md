# The application system — one link, a signed document, and a driver's own camera · 2026-08-21

The owner's framing, verbatim: *"an application system that will be automated and sent to drivers via
email or text message in form of a link where he can click and it will open application for him. We
have application typed in Excel, but we need to make it like forms that he will fill out. When he
fill out all forms, we will have our document and then driver will need to have (we need to create
something similar as DocuSign) all places and dates to sign easy and fast. That application will be
then saved and we will be able to see it in DQF. In application we will also need a flow to driver
can take images of all documents necessary (from same link)."*

Scope: **A0–A11**, below. This plan sits under `RECRUITING-SYSTEM-PLAN.md` — it does not replace it.
It is the execution detail for what that plan calls the application, and it slots between **R2**
(pre-qualification) and **R3** (MVR orders). Its execution protocol is `RECRUITING-SYSTEM-PLAN.md`
§4, unchanged; nothing here restates a rule that lives there.

**Re-verified 2026-08-21** by a three-track audit (every §0 claim re-read against the tree at
`8c80671`/`75020bf`; regulatory claims re-checked against psp.fmcsa.dot.gov, ecfr.gov and
clearinghouse.fmcsa.dot.gov primary sources). Corrections are folded in place and marked ⚠ where a
fresh session might repeat the original error. The notable ones: the PSP instrument's text is
FMCSA's, not counsel's (A0); §391.21(b)(4) has no field in the contract (A3 closes it); a resumed
draft needs an unlock, not just the link (D-APP16).

**This document contains no open questions.** Every fork raised in research has a decision in §3 with
the reasoning that produced it. Where an input is owned outside engineering (§6), the decision the
code takes is written down and the code ships taking it — a fallback that cannot be wrong is a
decision, not a deferral.

---

## 0. Ground truth — measured 2026-08-21 against the tree at `8c80671`, not recalled

Every claim below was read out of the source on this date. File and line references are to that
commit.

### 0.1 What already exists and must not be rebuilt

| Capability | Where | Note |
|---|---|---|
| Hashed single-use invitation | `supabase/migrations/0220_driver_applications.sql` | SHA-256 only; the plaintext never reaches a query |
| Session-free applicant page | `apps/web/src/pages/ApplyPage.vue` | No session store, no `apiFetch`, no app-shell toasts |
| Public unauthenticated API | `apps/api/src/routes/publicApplication.ts` | `GET /:token`, `POST /:token`, `POST /:token/release` |
| Rate limit on that surface | `apps/api/src/app.ts:147` | 20 req/min, its own tighter bucket — ⚠ the general `/api/public` limiter (`app.ts:231`) stacks on top; the effective budget is the intersection |
| One schema, both sides | `packages/shared/src/applicationContract.ts` | `driverApplicationSchema`, `.strict()` (⚠ top level only until A3a made the four nested schemas strict too — which immediately exposed a live defect, see A3a), §391.21(b) numbering — ⚠ **this row had (b)(1) and (b)(4) swapped**: (b)(4) is the submission date and IS satisfied by `certified_at`; (b)(1) is the carrier's name and address and is satisfied nowhere. (b)(5)'s "each" was the real missing field. A3a corrected all three; read its entry, not this row's original claim |
| Submit as one transaction | `submit_driver_application` (0220; ⚠ **live body replaced wholesale by 0222's `create or replace`** — extend 0222's definition, never 0220's) | Files, spends the link, patches the driver, creates employment rows, cites §391.51(b)(1) |
| Application immutable | trigger `DA010` (0220) | Fires for the service role too — a correction is a new row |
| **Per-instrument signing endpoint** | `publicApplication.ts:101` → `recordRelease` | Server-composed text, version stamped, `method: "esign"` |
| Draft disclosures refused | `applicationIntake.ts:196` | Returns `disclosure_not_final` → HTTP 409 |
| ESIGN attribution | `publicApplication.ts:44` | IP + user-agent + server timestamp, on applications and authorizations alike |
| SSN sealed or dropped | `sealSsn`, `applicationIntake.ts:114` | secretBox AES-256-GCM bound to org+purpose; no key ⇒ last-four only |
| Document register → signed upload | `apps/api/src/services/compliance.ts:110` | Bytes never traverse the API process |
| Capture engine | `packages/capture-engine/` | **Zero runtime dependencies**; pure gate + provider seam |
| PDF toolkit | `apps/api/src/services/dqBinder/pdfDraw.ts` | PDFKit: `title`, `heading`, `body`, `field`, `muted`, 612×792 |
| Email delivery | `apps/api/src/lib/mailer.ts` | Brevo / Resend (and `none`) behind `sendEmail` — ⚠ no Graph *send* path exists; `graphMail.ts` is inbound ingest only |
| It reaches DQF already | `submit_driver_application` | The application is cited as the §391.51(b)(1) record today |

**The four instruments an applicant is asked to sign** — `APPLICATION_RELEASE_ORDER`
(`packages/shared/src/applicationIntake.ts:80`): `fcra_disclosure`, `psp`, `previous_employer`,
`drug_alcohol`. `clearinghouse` is deliberately absent and stays absent: §382.701(a)'s full-query
consent is given *inside the Clearinghouse* by a driver registered there (D-REC4), so an applicant
signing our paper for it would be signing something that does not do the job.

### 0.2 The defect this plan exists to fix

`ApplyPage.vue:83–85` tells a driver, after they submit: *"If they take it further you will be asked
to sign the authorisations you read on this page — each one separately, and each one on its own."*

`resolveInvitation` (`applicationIntake.ts:85`) reads:

```
if (row.revoked_at || row.used_at) return dead;
```

`POST /:token/release` resolves through that same function. **`submit_driver_application` stamps
`used_at`.** So the signing the page promises is unreachable through the link that promised it. The
only remaining path is a staff member recording the driver's signature through the authenticated
route — which is a materially weaker artifact than the driver signing it themselves, and it is not
what the page said would happen.

Nobody has hit this in production because `DISCLOSURES` is entirely `v0-draft` and the gate refuses
drafts, so no signature has ever been attempted. **The bug is latent behind a blocker, and publishing
the v1 text is what would expose it.** A1 fixes it before A0 can.

⚠ **Fixed 2026-08-21 by A1 (migration 0225).** This section is kept as the argument for the shape the
rest of the plan is built on — the link is a session, not a fuse — not as a live defect. Do not
re-derive it; read A1's "What shipped".

### 0.3 What is genuinely missing

Save-and-resume; a signing ceremony over multiple documents; web-side camera capture; the ESIGN
15 U.S.C. 7001(c) consent record; the carrier's own Excel questions; SMS.

---

## 1. What the market does, and the one lesson worth copying

- **Tenstreet IntelliApp** — 89% of completed applications are filled on a phone; the headline
  feature is pre-population from a cross-carrier driver database.
- **DriverReach** — 90% mobile completion, up to 97%; prefills 83% of the time; **"Magic Links"
  recapture drivers who abandoned mid-form.**

The lesson is one sentence: **these forms are long, they are filled on a phone at a truck stop, and
the entire product battle is not losing the driver mid-form.** Our current design is one link, one
shot, submit-or-lose-forty-minutes-of-typing, and the link is burnt either way.

We cannot copy their prefill — it works because they hold a cross-carrier database and we are one
carrier's system. We can prefill from the lead (R1/R2) and from a prior application by the same
person (rehire), and we say so honestly rather than claiming a capability we do not have (D-APP14).

---

## 2. Architecture — where each new thing sits

D-REC1 stands: **process state is an act ledger plus a fold.** Nothing here introduces a stage
column, and `ApplicantStage` does not grow (RECRUITING-SYSTEM-PLAN §1 ⚠).

The new entities sort cleanly onto the existing evidence line:

| New thing | Side of the line | Why |
|---|---|---|
| `application_drafts` | **Operational** — prunable, 0213-style trigger | A half-typed form is transcription, not a certification. It must be deletable the moment it stops being useful, because it holds a DOB. |
| `application_captures` | **Operational** — prunable | A driver's third attempt at photographing a blurry CDL is not evidence of anything. |
| `esign_consents` | **Evidence** — `RETENTION_FORBIDDEN`, EI010-style trigger | §390.32(d) requires proof of consent per 15 U.S.C. 7001(c). The proof is the record. |
| `driver_authorizations` rows | **Evidence** — already so (0215) | Unchanged by this plan. |
| `driver_applications` rows | **Evidence** — already so (0220) | Unchanged by this plan. |
| `documents` rows (filed captures) | **Evidence** — already so (0146) | Created only at submit (D-APP10). |
| The rendered PDF | **Derivative** — regenerable | D-APP9. |

The invitation itself changes category slightly and deliberately: it stays in `RETENTION_FORBIDDEN`
(it is the provenance of an unauthenticated signature) but stops being a one-shot fuse (D-APP1).

---

## 3. Decisions

Each of these resolves a fork. None of them is provisional.

**D-APP1 — the invitation is a session with per-phase spend, not a single act.**
One `used_at` column cannot express "the releases are signed, the form is not yet sent". Replace it
with a set of dated phase stamps on the invitation — `consented_at`, `releases_completed_at`,
`submitted_at` — plus the existing `revoked_at` / `expires_at`. `resolveInvitation` refuses a
*revoked or expired* invitation and returns the phase stamps; each write path refuses **its own**
phase being already spent, not somebody else's. `used_at` is retained as a generated mirror of
`submitted_at` for one migration so nothing reading it breaks, and is dropped in the step that
removes its last reader.
*Why not just move the release signing before submit and keep one flag:* because a driver who signs
four releases and then loses signal has spent the link, and the four signatures they gave are real
and must not be re-solicited. Phase stamps make a resumed session pick up exactly where it stopped.

**D-APP2 — the draft is a separate, prunable table; the submission stays immutable.**
`application_drafts`: one row per invitation, `payload jsonb` (partial, unvalidated),
`updated_at`, `section` (the furthest section reached). Header declares it **operational, not
evidence**, on 0208's argument. Append-only guard in **0213's style** (`auth_role() is null` passes)
so retention can actually prune it; explicitly NOT in `RETENTION_FORBIDDEN`; cascade-deleted with its
invitation.
*Why not a `draft jsonb` column on `application_invitations`:* that table today holds hashes and
timestamps and nothing a leak could read. Putting a half-typed date of birth in it changes its
sensitivity class and would drag it out of the "a database leak yields hashes, not working links"
property 0220's header is built on.
*Why the draft is unvalidated:* a form that refuses to save until it is valid is a form that cannot
save at all until it is finished, which defeats the entire point.

**D-APP3 — the SSN never enters a draft.**
It is collected in the final step and travels straight into `sealSsn` at submit. A draft is prunable
and unencrypted-at-column; nine digits do not go in it, ever. The form's SSN field is therefore the
one field that does not autosave, and the UI says so in one sentence rather than silently losing it.

**D-APP4 — the releases are signed BEFORE the certification, in the same session.**
Order within the link: ESIGN consent → the four releases → the form → review → certify → submit.
*Why before:* §391.21(b)'s certification is the last act of the application, and submit is what makes
the application exist. Anything that has to happen "with" the application must happen before it, or
it needs a second link. And the driver is *in the flow* — the market's whole finding is that a
second touch loses people.
*What this changes, stated plainly:* the carrier will hold signed FCRA authorizations for candidates
they never pursue. That is lawful, it is what Tenstreet and DriverReach both do, and it is the price
of one link. It is mitigated, not ignored: A11's retention rule prunes drafts and captures for
dispositioned candidates, and the signed authorization itself stays because a signature is evidence
of what a person consented to and pruning it would leave PSP pulls citing consent that no longer
exists.
*This decision is what makes §0.2's defect fixable rather than merely documented.*

**D-APP5 — ESIGN consent is its own recorded act, it comes first, and it gates everything.**
49 CFR §390.32(d) requires an electronic record to "include proof of consent per 15 U.S.C. 7001(c)".
7001(c) is not a checkbox; it is a disclosure with named contents: the right to have the record on
paper, how to request it, whether consent covers only this transaction or future ones, how to
withdraw it and any consequences, and a statement of the hardware and software needed to access and
retain the record. New table `esign_consents`, evidence-side, one row per invitation, storing the
disclosure version and text served, the intent statement, and the same three attribution fields.
Nothing else on the link is reachable until it exists.
*Why a table and not a boolean on the invitation:* the consent is a signed instrument like the other
five, and the thing that makes a signature worth anything is that the exact text is stored beside it
(the `DISCLOSURES` pattern, 0092's `hazmat_reviews.attestation` before that).

**D-APP6 — we build the signing ceremony. No AGPL product, no e-signature vendor.**
DocuSeal, Documenso and OpenSign are all **AGPLv3**; offering them over a network as part of this
SaaS triggers the source-disclosure obligation, and legal exposure is not a thing to design around.
Beyond the licence: any of them would mean a second identity system, a second document store, and —
the disqualifier — an audit trail living *outside* the evidence tables, when the whole architecture
of this product is "the ledger is the evidence".
A paid embedded-signing API (DocuSign / Dropbox Sign / BoldSign) is rejected for a different reason:
per-envelope cost forever, and a third party holding drivers' PII and DOT evidence that §391.51
requires *us* to reproduce.
**We are not solving DocuSign's problem.** DocuSign is hard because it handles arbitrary uploaded
PDFs, arbitrary field placement, multi-party routing and counterparty negotiation. We have **one
known document set, authored by us, versioned in code, with one signer**. `DISCLOSURES` is already
the hard part their templates exist to solve, and it shipped in 0215. What is left is a ceremony and
a renderer.

**D-APP7 — the signature is adopted once and affirmed per instrument.**
The driver adopts a signature once (typed name, rendered in a script face, **plus** an optional drawn
mark on a canvas — see D-APP8). Each instrument then presents its own text and its own `intent`
sentence with its own affirmative control. ESIGN's intent-to-sign attaches to *a record*, so one
"sign all" button across four separate FCRA-governed instruments is exactly the omnibus consent
§604(b)(2) forbids on paper, expressed in a database — the sentence `applicationIntake.ts:176–180`
already makes about why a partial set is a real state.
"Easy and fast" is delivered by the *adoption* being once and the per-instrument act being one tap,
not by collapsing four instruments into one act.

**D-APP8 — typed name is the signature of record; the drawn mark is decoration, stored as evidence
of nothing more than itself.**
§390.32(c)(2) accepts "any available technology". The legally load-bearing artifact is the tuple
already stored: the intent statement, the exact disclosure text and version, the timestamp, the IP
and the user-agent. A drawn squiggle adds no legal weight and adds a failure mode (a driver on a
cracked screen who cannot produce one). We render a drawn mark when the driver gives one, because
drivers expect to see a signature on their document, and we never require it.

**D-APP9 — dates are stamped server-side, and the rendered PDF is a derivative.**
No signing date, consent date or certification date is ever accepted from a request body — the same
rule that already makes the API compose disclosure text from `DISCLOSURES` rather than from the
client. The "places and dates to sign" the owner asked for are therefore *placements in our
renderer*, not fields a client fills.
The PDF is generated from `driver_applications.payload` + the `driver_authorizations` rows + the
`esign_consents` row. It is filed in `documents` with its sha256, and it is **regenerable**: if the
renderer improves, a new PDF is a new `documents` row, and the evidence — the payload and the signed
rows — never moved. This is D-PSP2's rule ("a wrong projection is re-derivable without re-buying")
applied to our own document.

**D-APP10 — captures are staged, and filed only at submit.**
`documents` is `RETENTION_FORBIDDEN` and append-only; three attempts at one CDL photo must not
become three rows in a qualification file. Captures land in `application_captures` (operational,
prunable, replaceable by slot), and `submit_driver_application` promotes the accepted set into
`documents` inside the same transaction that files the application.
*A consequence that is a feature:* a candidate who never submits leaves no evidence rows at all.

**D-APP11 — the web capture provider extends the engine we own; the gate gains a `web` platform.**
`@fuelguard/capture-engine` is pure and zero-dependency with an explicit provider seam
(`provider.ts`), and its own header says implementations live where the IO lives. A web provider is
exactly the extension it was designed for.
`GateInput.platform` is today `"ios" | "android"` and the gate is platform-tuned. It gains `"web"`
with its own thresholds rather than borrowing Android's — borrowing would be an assumption, and this
plan does not make those.
**Shipping order inside A7:** `<input type="file" accept="image/*" capture="environment">` first —
it opens the phone's native camera, which is already very good, and the existing gate runs on
whatever comes back with `longEdgePx` as the only reliably measurable metric (exactly the degraded
mode `gate.ts` already documents for the JS fallback provider). `getUserMedia` + OpenCV.js
auto-crop/deskew is a **second provider behind the same seam**, added only if the measured re-shoot
rate justifies its weight. That is the same v1/v2 progression `provider.ts` describes.

**D-APP12 — the carrier's Excel questions live in a versioned questionnaire, outside the regulated
contract.**
`driverApplicationSchema` is `.strict()` and numbered to §391.21(b)(1)–(11) so a reader with the CFR
open can check it line by line. Carrier-specific questions (position applied for, availability, pay
history, referral source, EEO) must never dilute that. One contract change adds two fields —
`questionnaire_version: string | null` and `questionnaire_answers` — and thereafter a carrier's form
changes without touching the regulated schema.
⚠ **The answers stay in `payload` and are projected nowhere.** They do not reach `drivers`, they do
not reach `driver_employment_history`, and they do not create DQF items. (The inverse of 2026-08-20's
lesson: a projection can silently drop a field the contract collects — here nothing must project it
at all, and a test pins that.)
EEO questions, if the carrier asks any, are stored in a separate `questionnaire_answers.eeo` object
excluded from every recruiter-facing projection — voluntary self-identification must not be visible
to the person deciding the hire.

**D-APP13 — email ships first; SMS ships as its own step, gated on a consent record, and the 10DLC
registration starts on the day A1 starts.**
TCPA requires *prior express written consent* — standalone, naming the sender and message type, with
opt-out — and penalties are $500–$1,500 **per message**. So SMS is not a delivery mechanism, it is a
consent regime, and it gets its own table and its own step (A11). It is last in the order because
nothing else waits on it and because 10DLC brand/campaign registration has a multi-week lead time
that belongs on the calendar from day one rather than discovered at the end.

**D-APP14 — prefill comes from the lead and from a prior application by the same driver.**
Nothing else. No cross-carrier database exists here and none is implied to the driver. A prefilled
field is always editable and always visibly marked as prefilled — a driver certifying "true and
complete" must be able to see what they are certifying and where it came from.

**D-APP15 — the abandonment sweep extends the existing daily scheduler; no new scheduler is added.**
Schedulers must run in exactly one process fleet-wide (`docs/WORKER-DEPLOYMENT.md`), and every new
one adds a fleet-wide invariant somebody must keep. `startDqAlertScheduler` already runs **every six
hours** (⚠ `CHECK_INTERVAL_MS = 6 * 3_600_000` — not daily, corrected 2026-08-21), per-org, emits
notification rows and sends one office email per run — the right shape and audience, and the sweep's
own selection (stale >48 h, nudged once) makes the extra runs harmless. The stale-draft sweep
becomes a second pass inside it.

**D-APP16 — a resumed draft is unlocked by something the driver knows, not by the link alone.**
D-APP1 makes the link a session, D-APP2 gives that session a draft full of PII, and A10 re-sends the
same link in a nudge email. A forwarded email or a shared phone therefore reads a half-typed
application — D-APP2 defended the *database* leak, not the *link* leak. The fix is one low-friction
check: once a draft contains a date of birth, `GET /:token` returns the phase stamps and the
furthest section but **not the draft body**; the body is released by `POST /:token/unlock` carrying
the matching DOB (constant-time compare, inside the same 20 req/min bucket, which is what throttles
guessing). Before a DOB is typed there is nothing sensitive to protect and no gate is shown. A
failed unlock reveals nothing and burns nothing — the driver who genuinely forgets can always ask
the carrier to re-issue.
*Why DOB:* it is among the first things the form asks, the driver always knows it, and it is
precisely the field whose exposure the gate exists to prevent. A second factor would be security
theatre bought with abandonment.

---

## 4. Facts the design is bound by — each verified 2026-08-21, none recalled

**Regulatory**

- **49 CFR §390.32(b)** — electronic methods may satisfy any document requirement in 49 CFR 300–399,
  which includes §391.21. **§390.32(c)(2)** — an electronic signature "may be made using any
  available technology that otherwise satisfies FMCSA's requirements." We are not obliged to use any
  particular product. **§390.32(d)** — the record must accurately reflect the required content, be
  retainable, be accurately reproducible, **and include proof of consent per 15 U.S.C. 7001(c)**.
- **15 U.S.C. 7001(c)** — the consent disclosure's required contents are enumerated in D-APP5.
- **ESIGN / UETA** — four pillars: intent to sign, consent to transact electronically, attribution
  (the signature logically associated with *that* record and *that* signer), and retention. The
  product already satisfies attribution and retention better than most vendors, because the evidence
  tables are append-only and in `RETENTION_FORBIDDEN`.
- **FCRA §604(b)(2)** — the disclosure must be "in a document that consists solely of the
  disclosure". This is why there are five instruments and not one, why each is served alone, and why
  D-APP7 refuses a single sign-all control.
- **PSP (verified 2026-08-21, psp.fmcsa.dot.gov primary sources)** — the Disclosure & Authorization
  text is FMCSA's, mandatory, whole and standalone (A0). Electronic signature is explicitly
  acceptable ("both electronic and paper forms are acceptable"). The signed form is retained **at
  least three years from the hiring decision, hired or not**, and FMCSA audits monthly random
  samples of signed forms through the PSP site — both already satisfied by the append-only
  `driver_authorizations` row carrying the exact text signed. ⚠ The account agreement requires a
  signed authorization *in advance of each request*: a **re-pull needs a fresh signature**, which
  `hasLiveAuthorization`'s evergreen model does not express. That is `PSP-PLAN.md`'s to resolve,
  not this plan's — but no step here may quietly assume one application-time signature covers a
  later re-screen.
- **§391.21(b)** — the applicant signs that all entries are true and complete. That sentence is the
  application's entire legal weight; anything editable afterwards certifies nothing (0220's header).
- **TCPA** — prior express written consent, standalone; sender identification; opt-out honoured;
  quiet hours 8 p.m.–9 a.m. recipient-local; $500–$1,500 per message.

**Technical, in this codebase**

- `resolveInvitation` kills a token on `used_at`, and `POST /:token/release` goes through it
  (§0.2). This is the plan's first fix.
- `recordRelease` returns `disclosure_not_final` for any `v0-draft` instrument, mapped to HTTP 409.
  **Every instrument in `DISCLOSURES` is `v0-draft` today**, so no signature can land until A0.
- `application_invitations`, `driver_applications`, `documents`, `certifications` and
  `qualification_records` are all in `RETENTION_FORBIDDEN` (`dataRetention.ts:148`).
- `capture-engine`'s `GateInput.platform` is `"ios" | "android"`; `ImageMetrics` requires only
  `longEdgePx` and treats every unmeasured check as `na`, never a silent pass.
- `pdfDraw.ts` exports a complete PDFKit toolkit at 612×792 with a 54pt margin. `pdf-lib` (also a
  dependency) has **no `createSignature` API** — which does not matter, because we render the
  document ourselves and place fields by layout rather than by `{{ANCHOR}}` text-matching.
- The public surface is rate-limited to 20 requests/minute (`app.ts:147`), with the general
  `/api/public` limiter (`app.ts:231`) stacked on top. Autosave must respect the intersection (A2
  debounces to well inside it).
- `submit_driver_application` already does five things in one transaction; A8 and A10 extend it
  rather than adding a second write path.

---

## 5. Steps — each stands alone; migration numbers are next-numbered at execution, never pinned

One step per branch (`claude/<topic>`), PR to `main`, merge after CI. Mark each **— DONE \<date\>
(migrations NNNN–NNNN)** in place when it ships, with "What shipped" and "Verified by:".

### A0 · Publish the instrument text as v1 — content, no code

**Prerequisites:** none from engineering.

**Build.** Counsel's reviewed wording replaces **four** of the five `body`/`intent` strings in
`DISCLOSURES` and the five `version` strings become `v1`. ⚠ The fifth — `psp` — is **not counsel's
to draft** (verified 2026-08-21 on psp.fmcsa.dot.gov): FMCSA mandates the exact text of the
"Important Disclosure Regarding Background Reports from the PSP Online Service" + Authorization
(`PSPDisclosureandAuthorizationForm.pdf`, last updated 2016-02-11), used *in whole, exactly as
provided, as one stand-alone document, combined with no other consent form or language*. Its `body`
is that text verbatim — counsel's pass over it is transcription review only. The official form
carries fill-in blanks for the Prospective Employer's name, so the serving path substitutes the
org's legal name server-side and the stored `disclosure_text` is the **filled** text the driver saw
(the same server-composed rule as D-APP9; `DISCLOSURES.psp` becomes the one template in an
otherwise static record). Add the sixth document — the 7001(c) ESIGN consent disclosure (A4 defines
its shape; its text is counsel's on the same pass). ⚠ Same commit: unify the two draft predicates —
`isDraftDisclosure` (`startsWith("v0")`, the enforcement path at `applicationIntake.ts:193`) and
`disclosuresAreDraft` (`endsWith("-draft")`) agree today and diverge on a string like `"v1-draft"`;
one predicate, used by both. The commit is the publication event: the version string is stored on
every signed row, so the moment a real signature differs from a draft one is visible in the data and
in `git log`.

**The code takes no position while this is outstanding.** `disclosure_not_final` → 409 is already the
right refusal and stays. Every ceremony step below is verified against a **test fixture** that stubs a
non-draft version, so A1–A11 are all buildable and provable today; only the first *real* signature
waits on this commit.

**Done when:** `disclosuresAreDraft()` returns false, and one end-to-end signature lands in the
`FuelGuard EFS QA` org (`07fe4058-…`, the sandbox with a null `dot_number`) — never against Silvicom.

### A1 · The invitation becomes a resumable session — DONE 2026-08-21 (migration 0225)

**Prerequisites:** none. **Fixes §0.2, and must land before A0 can be exercised.**

**Build.**
- Migration: add `consented_at`, `releases_completed_at`, `submitted_at` to
  `application_invitations`; backfill `submitted_at := used_at`; keep `used_at` as-is for this
  migration (its last reader is removed in A5, and it is dropped in the step that does).
- `resolveInvitation` refuses only `revoked_at` / `expires_at` and returns the phase stamps. Each
  write path refuses its own phase: `recordRelease` refuses when `releases_completed_at` is set,
  `submitApplication` refuses when `submitted_at` is set — each with its own named SQLSTATE mapped to
  an answer, never a 500.
- `GET /:token` returns the phase stamps so the page opens where the driver left off.
- `ApplyPage.vue`'s post-submit copy is corrected in the same commit: it promised signing that the
  new order (D-APP4) performs *before* submission, so the sentence becomes a statement of what
  happened, not a promise about what will.

**Verify.** PGlite matrix `supabase/tests/application-session.test.mjs`: RLS deny-all holds; a
release recorded after `releases_completed_at` refuses; a submit after `submitted_at` refuses; a
revoked token refuses every phase; an expired token refuses every phase; the backfill leaves every
existing row's behaviour identical. `expectOrgScoped` on every touched service query.
**Done when:** a driver can sign, close the browser, reopen the same link, and be on the next step —
and the same link cannot re-sign what it already signed or re-submit what it already sent.

**What shipped.**
- `0225_application_invitation_phases.sql`: `consented_at`, `releases_completed_at`, `submitted_at`
  on `application_invitations`, backfilled `submitted_at := used_at` (exact, not approximate —
  `used_at` had exactly one writer). `submit_driver_application` re-expressed as phases from **0222's**
  body, splitting one refusal into two: **DA021** the credential is dead (revoked or expired),
  **DA022** the credential is live and the submit phase is spent. DA020 unchanged.
- `resolveInvitation` refuses only `revoked_at` / `expires_at` and returns the phase stamps;
  `used_at` is **out of the public path's select entirely** so that path has one source of truth.
  It survives on the staff side (`INVITE_COLS`, the revoke guard's `.is("used_at", null)`, the web
  `inviteState` fold) and is still stamped for them — A5 removes the last reader and drops it.
- `submitApplication` refuses `already_submitted`; `recordRelease` refuses `releases_complete`
  (nothing stamps that column until A5, and the refusal ships with the column anyway). Both are
  **409, not 404**: a spent phase is a conflict on a good link, and only its holder can reach it, so
  saying so discloses nothing that `GET` did not. `invalid_link`'s neutrality is untouched.
- `GET /:token` returns `phases`; `ApplyPage.vue` opens on the submitted state when the server says
  so rather than only when this tab did it, and its post-submit copy states what happened instead of
  promising a signing step through a link it had just closed. The dead-link card stopped saying
  "already been used", which stopped being one of the ways a link dies.
- ⚠ RECRUITING-SYSTEM-PLAN §4's last surviving local tone record is gone: `STATE_TONE` /
  `STATE_LABEL` in `ApplicationInviteCard.vue` are now `applicationInviteBadge` in `lib/badges.ts`,
  folded into this UI-touching PR as that plan required.

**Verified by:** `pnpm test` (393-table `rls`, `application-intake` 21 — its spent-link assertion now
reads DA022 — and the new `application-session` matrix, 14 passed, which pins the backfill by
replaying it over a simulated pre-0225 row); `pnpm typecheck`; `pnpm lint`; `lint:filesize`,
`lint:funcsize`, `lint:migrations`, `lint:rls`, `lint:upserts`, `lint:tests`, `lint:secrets`,
`lint:boundaries`, `lint:comment-claims`, `lint:tokens-parity`, `lint:ui-adoption`,
`lint:ui-contrast`, `pnpm --filter web lint:tokens`. The §0.2 defect is pinned at the boundary that
created it: `publicApplication.test.ts` "the link survives its own submission" proves
`POST /:token/release` after a submission reaches the **draft-wording** gate (409
`disclosure_not_final`) instead of a dead link — the same call A0 turns into a signature.

### A2 · Drafts and autosave — DONE 2026-08-21 (migration 0226)

**Prerequisites:** A1.

**Build.**
- Migration: `application_drafts` — `id`, `org_id`, `invitation_id` FK **`on delete cascade`**,
  `driver_id`, `payload jsonb not null default '{}'`, `furthest_section text`, `updated_at`,
  `created_at`. Header declares it operational-not-evidence and states its prunability. BEFORE
  UPDATE/DELETE guard in **0213's style** (`auth_role() is null` passes). Unique on `invitation_id`
  — one draft per link. RLS enabled, no client policies.
- `PUT /api/public/application/:token/draft` — accepts a *partial, unvalidated* body, size-capped,
  and upserts. ⚠ It is an UPDATE-or-INSERT written as an explicit insert-then-update RPC, **never a
  partial `.upsert()`** (root `CLAUDE.md`; `lint:upserts`).
- `GET /:token` returns the draft alongside the phase stamps — **until the draft contains a DOB**;
  from then on the body comes only from `POST /api/public/application/:token/unlock` carrying the
  matching date of birth (D-APP16: constant-time compare, same rate bucket, a failure reveals
  nothing and burns nothing).
- Web: a debounced autosave (2 s idle, and on every section change) in
  `features/apply/useApplicationDraft.ts`, with a visible "Saved" / "Saving…" / "Not saved — check
  your signal" state. The debounce keeps a whole session well inside the 20 req/min bucket — ⚠ and
  inside the general `/api/public` limiter that stacks on top of it (`app.ts:231`); the budget is
  the intersection of the two.
- ⚠ **The SSN field is excluded from the draft payload by construction** (D-APP3) — not filtered on
  the way out, but never placed in the draft object at all, with a test that pins it.

**Verify.** Matrix: RLS deny-all; the 0213-style guard lets a service-role DELETE through (the
prunability pin) and refuses a client UPDATE; cascade from the invitation removes the draft. Unit:
the draft builder never emits an `ssn` key for any input; a `GET` on a DOB-bearing draft returns no
draft body; an unlock with a wrong DOB returns no draft body and leaves the invitation live.
**Done when:** a driver can fill half the form, lose signal, and find their answers on return — no
draft anywhere contains nine digits, and nobody holding only the link reads a typed date of birth.

**What shipped.**
- `0226_application_drafts.sql`: the table as specified — `on delete cascade` from the invitation,
  unique on `invitation_id`, RLS on with no client policies, 0213-style guard (**DA030**), header
  declaring it operational-not-evidence, and deliberately absent from `RETENTION_FORBIDDEN`.
  `save_application_draft` is an explicit UPDATE-then-INSERT with a `unique_violation` retry for the
  concurrent-autosave race — never a partial `.upsert()` (0174's incident, `lint:upserts`).
- `services/applicationDraft.ts` as its own service beside `applicationIntake.ts`: the draft is on
  the other side of the evidence line from everything that file handles, and keeping them apart means
  D-APP16's gate cannot be confused with the neutral refusals that protect the invitation.
- `GET /:token` carries `draft`; `PUT /:token/draft` saves partial and unvalidated, capped at
  **128 KB**; `POST /:token/unlock` releases a gated body against a hashed constant-time DOB compare.
  A wrong date returns the same locked view with **200**, not 401 — it changes nothing, burns
  nothing, and the rate limiter is what throttles guessing.
- ⚠ **The SSN refusal is in the shared schema, not a filter.** `applicationDraftSaveSchema` rejects a
  payload carrying an `ssn` key (→ 400) and `toDraftPayload` enumerates its keys explicitly rather
  than spreading the draft, so A3's SSN field is invisible to autosave until somebody deliberately
  adds it. A silent strip would let the client regress unnoticed, and this is the one field where
  unnoticed is unacceptable.
- Web: `features/apply/useApplicationDraft.ts` (2 s idle debounce, "Saving…" / "Saved" / "Not saved —
  check your signal"), draft restore through `fromDraftPayload`, and the unlock card. A restored
  draft always comes back **uncertified**: §391.21(b) is certified once, about the finished document,
  and a restored tick would certify answers the driver has since changed.

**⚠ Correction to this step's own text, found while building it.** A 2-second idle debounce alone is
**not** "well inside" the rate budget. The intersection of the two stacked limiters is **20 req/min**
(`app.ts:147`'s 20 is tighter than `/api/public`'s 60), and a driver pausing every two seconds — which
is what typing an address looks like — would produce up to 30 saves a minute and start collecting
429s mid-application. So autosave has a **second timer**: a floor of one save per 5 s, with changes
inside the window moving the pending save rather than queueing another (the payload is always the
whole current form, so coalescing loses nothing). Measured in the unit test: 25 s of two-second
pauses produces **4** saves, not 12. A3 and A10 must keep the floor, not just the debounce.

**Also noted:** the section-change trigger is wired (`options.section`) but has nothing to fire on
until A3 defines the section vocabulary — which is why `furthest_section` ships as free text with no
CHECK. A3 gives both a vocabulary.

**Verified by:** `pnpm test` (new matrix `application-drafts` 20 passed — including the prunability
pin, the cascade, and the guard proved the way it actually fires; `rls` now covers **89** tables with
`application_drafts` seedable); `pnpm typecheck`; `pnpm lint`; `lint:filesize`, `lint:funcsize`,
`lint:migrations`, `lint:rls`, `lint:upserts`, `lint:tests`, `lint:secrets`, `lint:boundaries`,
`lint:comment-claims`, `lint:tokens-parity`, `lint:ui-adoption`, `lint:ui-contrast`,
`pnpm --filter web lint:tokens`. `expectOrgScoped` holds on the read, the save and the unlock, with
`application_invitations` exempted and the reason written beside it — the token is resolved BY HASH
to discover the org, so there is no org to filter by yet and accepting one from the request is what
this surface exists to refuse.

⚠ **A matrix lesson worth not re-learning** (it cost time here): with RLS deny-all and no
UPDATE/DELETE policy, a browser session's write matches ZERO ROWS AND SUCCEEDS, so the guard trigger
never fires and a test expecting `DA030` passes for the wrong reason. The guard is proved the way it
actually fires — a connection that bypasses RLS while carrying a user's JWT claims — and the RLS half
is proved by asserting the row is unchanged. Also: `set local role` and `set_config(..., true)` are
**transaction scoped**; outside an explicit `begin` they are discarded before the statement runs and
the query executes as the owner with no claims.

### A3a · The form becomes a wizard — DONE 2026-08-21 (no migration)

**Prerequisites:** A2. No migration (one shared-contract change, below).

**Build.** `ApplyPage.vue` splits into a sectioned flow: Identity → Addresses → Licence → Employment
→ Safety history → Documents (A7) → Review → Certify. One section per screen on mobile, a progress
indicator, forward/back, and **per-section validation using the same `driverApplicationSchema`** —
validated by picking the section's keys, so the client and server can still never disagree about what
§391.21 requires.
⚠ The contract closes its audited gap in this step — **but the audit cited the wrong paragraph, and
the correction is the interesting part.** §391.21(b) was re-read verbatim on 2026-08-21 (Cornell LII;
current text, Part 391 last amended 87 FR 13208, 2022-03-09):

- **(b)(4)** is *"The date on which the application is submitted"* — not licences. It is satisfied by
  `driver_applications.certified_at`, stamped server-side, and it must **never** become a field:
  D-APP9 forbids accepting a date of signing or submission from a client. Nothing to build.
- **(b)(5)** is *"The issuing driver's licensing authority, number, and expiration date of **each**
  unexpired commercial motor vehicle operator's license or permit that has been issued to the
  applicant"*. **"Each"** is the gap the audit actually found: the schema carried exactly one licence.
  A3a adds `additional_licences`. Note also "issuing driver's licensing authority" rather than
  "issuing State" — the current text admits an authority that is not a US state, so the extra entries
  take free text while `cdl_state` stays a state code (PSP and SambaSafety both match on one).
- **(b)(1)** — *"The name and address of the employing motor carrier"* — is the paragraph with
  genuinely no home, and §0.1's note had it swapped with (b)(4). It is not an applicant field; it
  belongs in the rendered document (A6). ⚠ **It cannot be satisfied today:** `organizations` carries a
  `name` and a `dot_number` and **no address at all**, so A6's renderer has nothing to print. Raised
  in §6 — it needs the carrier's legal address, an owner input, plus one column.

And the four nested schemas (address, employer, accident, violation) become `.strict()` like their
parent. The SSN request states, in one sentence, why the
number is asked for and that it is optional (Q-H2) — a sensitive-field ask with no stated reason is
an abandonment spike. All applicant-facing strings live in one extractable map from the start:
English ships alone, but a second language must be a translation pass, not a refactor — these forms
are filled by drivers for whom English is often a second language.
Prefill (D-APP14) from the lead's pre-qual answers and from the most recent prior
`driver_applications` row for the same `driver_id`, each prefilled field marked as such and editable.
⚠ **Split out as A3b** (§4 allows a named sub-step per branch) for two reasons found while building
A3a: the lead half is not buildable at all until R1/R2 exist — there is no leads table — and the
prior-application half re-opens exactly the hole D-APP16 closed. Prefilling a previous application
into a page opened with only the link would hand a bare token that driver's date of birth, licence
number and address history. A3b therefore puts prefill **behind the same DOB gate**, compared against
the prior application's own date of birth.
Design contract: this is a session-free page and stays on the `lint:ui-adoption` exemption list with
its existing reason; primitives are `App*` from `@fuelguard/ui`; no local tone records; house voice
(fact, then next action).

**Verify.** Component tests per section; a test that the union of the sections' field sets equals
`driverApplicationSchema`'s key set — so a field added to the contract cannot go homeless. `vue-tsc`,
`lint:ui-adoption`, `pnpm --filter web lint:tokens`.
**Done when:** the whole application is completable one thumb-width at a time, and every field in the
contract appears in exactly one section.

**What shipped (A3a).**
- **The section vocabulary is shared, not a UI detail**: `packages/shared/src/applicationSections.ts`
  carries the tokens, the label map beside them (the vocabulary-pair rule), the §391.21(b) citation
  each screen discharges, and the key set each screen owns — because `furthest_section` is a database
  value A10's sweep will read, not a component name. `sectionsCoverTheContract()` is the union
  assertion, and it names the offending field rather than counting.
- Seven screens: identity → addresses → licence → employment → safety → review → certify. ⚠ **No
  documents screen**: A7 has nothing to put on one yet, and a section that renders nothing is a dead
  screen in the middle of somebody's application. A7 inserts it before `review`.
- Per-screen validation picks the screen's keys out of `driverApplicationObject` — the unrefined base,
  exported for exactly this — and applies the cross-field rules whose message lands on a key that
  screen owns. Those rules moved out of the `.refine()` chain into `APPLICATION_CROSS_FIELD_RULES` so
  the whole-document parse and the per-screen parse cannot drift. **Send** runs the real
  `driverApplicationSchema` and attributes each failure to the screen that can fix it.
- Forward is gated; **back never is**. A driver who realises on the employment screen that they
  mistyped a licence must be able to go and fix it.
- ⚠ `furthest_section` stores the **furthest** screen reached, not the current one — stepping back to
  fix an address is not un-reaching where you got to, and sending the current screen would walk the
  stored value backwards and resume an almost-finished driver at the top of the form.
- The SSN field ships with its Q-H2 sentence (why it is asked, that it is optional) and a second
  saying it is the one answer autosave does not keep (D-APP3). The review screen deliberately does
  **not** reprint it.
- All applicant-facing strings in `features/apply/strings.ts`, section titles re-exported from shared
  rather than retyped. The disclosures moved to the last screen, still unsigned (Q-H3) — beside the
  certification rather than half-way down a form, and still shown, so nobody is asked weeks later to
  sign four documents they have never read.

**⚠ A live defect found by making the nested schemas strict.** The form has collected each traffic
conviction's place into `location` since H5b; `applicationViolationSchema` defines `state`; the nested
schema was not strict, so **zod dropped the key without a word**. Every conviction declared since H5b
was filed with no place attached, and the field the contract defines has never been populated. This is
2026-08-20's lesson in the mirror — there a projection dropped a field the contract collected; here the
contract dropped a field the form collected — and the general rule is worth keeping: *when a field
exists on one side of a boundary and not the other, somebody's answer falls through the gap.* Fixed in
the same PR, pinned by "carries a conviction's place, which used to fall through the gap between form
and contract".

**Verified by:** `pnpm test` (all 13 matrices; the new `applicationSections` coverage test; the page
test walks all seven screens, which is also a working proof that every screen's field set validates —
a field on the wrong screen strands the driver on a step they cannot pass); `pnpm typecheck`
(`vue-tsc`); `pnpm lint`; `lint:ui-adoption`, `lint:ui-contrast`, `lint:tokens-parity`,
`lint:filesize`, `lint:funcsize`, `lint:comment-claims`, `lint:boundaries`,
`pnpm --filter web lint:tokens`. **Not verified in a browser:** the apply page is session-free and
needs a real minted invitation to reach, which would mean writing to production; the component tests
mount the real page and walk it.

### A3b · Prefill — NOT STARTED

**Prerequisites:** A3a. The lead half additionally needs R1/R2 (there is no leads table yet), so A3b
ships the prior-application half alone and R1/R2 adds the other.

**Build.** On `GET /:token`, when there is no draft and the invitation's driver has a previous
`driver_applications` row, offer its payload as prefill — **behind D-APP16's gate**, compared against
the prior application's own date of birth. Prefilled values are marked and editable; a driver
certifying "true and complete" must be able to see what they are certifying and where it came from.
*Why gated:* A3a's page opens on the bare link, so prefilling a previous application into it would
hand whoever holds the link that driver's date of birth, licence number and address history — the leak
D-APP16 exists to prevent, re-opened through a different door.

### A4 · The ESIGN consent gate — DONE 2026-08-21 (migration 0227)

**Prerequisites:** A1.

**Build.**
- Migration: `esign_consents` — `org_id`, `driver_id`, `invitation_id`, `disclosure_version`,
  `disclosure_text`, `intent_statement`, `consented_at`, `applicant_ip`, `applicant_user_agent`.
  **Evidence-side**: EI010-family trigger (fires for the service role too), and the table joins
  `RETENTION_FORBIDDEN` in the same PR with the §390.32(d) reason written above it.
- `packages/shared/src/authorizationContract.ts` gains `ESIGN_CONSENT` as a sixth
  `DisclosureDocument` carrying the 7001(c) contents (D-APP5). It is **not** added to
  `AUTHORIZATION_PURPOSES` — it is not a screening authorization and must not appear in
  `SCREENING_PREREQUISITES` or in `hasLiveAuthorization`.
- `POST /api/public/application/:token/consent` records it and stamps `consented_at` on the
  invitation. Every other write path on the link refuses with a named code until it exists.
- Web: the first screen of the link. Full disclosure text, the hardware/software statement, the
  right to a paper copy and how to request it, and how to withdraw — then one affirmative control.

**Verify.** Matrix: RLS deny-all; the EI010 guard refuses a service-role UPDATE and DELETE;
`RETENTION_FORBIDDEN` guard test picks up the new table. API tests: every other endpoint refuses
before consent; a second consent on the same invitation refuses.
**Done when:** nothing on the link is reachable without a stored 7001(c) consent, and the stored row
reproduces the exact text the driver saw.

**⚠ The decision that changed this step's shape: the gate is armed by A0, not by A4.**
"Nothing else on the link is reachable until a consent exists" cannot ship as an unconditional rule
today. `ESIGN_CONSENT.version` is `v0-draft`, no consent may be recorded against text no lawyer has
read, and an unconditional gate would therefore refuse **every write on the live application** with no
way through it — taking a working production capability offline to enforce a rule nobody could
satisfy. So the requirement is tied to the same hazard the signing gate is tied to: while the wording
is draft the link behaves exactly as it did before A4, and the moment A0 publishes the reviewed text
the gate closes by itself on the draft save, the release and the submit. That is `DISCLOSURES`' own
argument — *a flag would have to be remembered, and what would need remembering is "start requiring
the consent the regulation requires"*. Both branches are pinned by tests, the closed one against a
published version.

**What shipped.**
- `0227_esign_consents.sql`: evidence-side, **EI010-family guard (`EC010`) that fires for the service
  role too** — the exact mirror of 0226's prunable draft, and each header states which side of the
  line it is on and why. `withdrawn_at` may be set once and never unset: withdrawing is a fact ABOUT a
  consent (7001(c)(1)(B)(i)(II) makes it a right), and un-withdrawing is a new consent, not an edit.
  `record_esign_consent` files the row and stamps the invitation's phase in one transaction, with its
  own SQLSTATEs (EC020/EC021/EC022) on 0225's model. The table joins `RETENTION_FORBIDDEN` in the same
  PR — a consent that can be aged out cannot answer the question it exists to answer, and pruning it
  would retroactively turn every application it stands behind into a record FMCSA does not recognise.
- ⚠ **The document is a record of CLAUSES, not one `body` string.** 15 U.S.C. 7001(c)(1) was read
  verbatim (Cornell LII, 2026-08-21) and enumerates six things the consumer must be told before
  consenting: the paper option (c)(1)(B)(i)(I), the right to withdraw and what withdrawal costs
  (c)(1)(B)(i)(II), the scope (c)(1)(B)(ii), how to withdraw and update contact details
  (c)(1)(B)(iii), how to get a paper copy and any fee (c)(1)(B)(iv), and the hardware/software
  statement (c)(1)(C)(i). A prose blob can be missing one with nobody noticing until a §390.32(d)
  challenge; a `Record<EsignConsentClause, string>` cannot, and it makes A0's pass six named strings
  with a citation each. `esignConsentBody()` composes the stored text server-side in statutory order.
- `ESIGN_CONSENT` is **not** in `AUTHORIZATION_PURPOSES` and must never be: those unlock vendor calls
  through `SCREENING_PREREQUISITES`, and this unlocks nothing. Adding it would make a PSP pull look
  satisfiable by the wrong consent.
- `POST /api/public/application/:token/consent` — the body carries nothing; version, text and intent
  are composed from `ESIGN_CONSENT`. `GET /:token` serves the document with a `required` flag, so the
  page never asks for a consent the API would refuse.
- Web: `EsignConsentGate.vue` as the first screen, the whole served text on it (7001(c)(1)(C)(ii)'s
  "manner that reasonably demonstrates that the consumer can access information" is a button under the
  text they just read, in the browser they will use for the rest of it). Autosave is disabled behind
  the gate — a "Not saved" banner on a screen the driver has not been allowed to reach would be a lie
  about their signal.
- ⚠ **A0's checklist item for unifying the draft predicates is DONE, pulled forward.** There were two
  — `isDraftDisclosure` (`startsWith("v0")`, enforcement) and `disclosuresAreDraft` (`endsWith("-draft")`,
  display) — agreeing on every string in use and diverging on `"v1-draft"`, which would have been
  enforced as final and shown as draft. The union now lives once, in `authorizationContract.ts`, beside
  the documents it judges. A4 pulled it forward rather than adding a third copy for the sixth document.

**⚠ A test-harness fact that cost time here, worth adding to the 2026-08-19 list.** The public
application surface's real rate limiter (20/min per IP) runs in the route tests too, and every test in
`publicApplication.test.ts` shares one Express instance — so the twenty-first request in the FILE
starts returning 429 and the failure looks like whatever that test was about (it surfaced as "expected
429 to be 400" on an unrelated assertion). `trust proxy` is set, so each call now carries its own
`X-Forwarded-For`; the limiter itself is pinned by one deliberate test that hammers a single address.

**Verified by:** `pnpm test` (new matrix `esign-consents` 20 passed — including the service role
being refused an UPDATE and a DELETE, which is the assertion the trigger style was chosen for; `rls`
now covers 90 tables); `pnpm typecheck`; `pnpm lint`; `lint:filesize`, `lint:funcsize`,
`lint:migrations`, `lint:rls`, `lint:upserts`, `lint:tests`, `lint:secrets`, `lint:boundaries`,
`lint:comment-claims`, `lint:tokens-parity`, `lint:ui-adoption`, `lint:ui-contrast`,
`pnpm --filter web lint:tokens`. The `RETENTION_FORBIDDEN` guard test picks up the new table.
`expectOrgScoped` holds with `application_invitations` exempted and the reason beside it.
**Not verified in a browser** — the apply page needs a real minted invitation to reach.

### A5 · The signing ceremony — DONE 2026-08-21 (migration 0228)

**Prerequisites:** A1, A4. Real signatures additionally need A0 — the ceremony is verified against a
non-draft test fixture, so this step does not wait.

**Build.**
- Web `features/apply/signing/`: signature adoption (typed name rendered in a script face; optional
  canvas mark, D-APP8), then one screen per instrument in `APPLICATION_RELEASE_ORDER` with a "3 of 4"
  counter, each showing that instrument's served `body` and `intent` and its own affirmative control.
- Each control posts to the existing `POST /:token/release` — **unchanged**. The endpoint was right
  the first time; this step gives it a caller.
- The drawn mark, when given, is stored once as a `documents` row of kind `other` at submit time
  (A8's promotion — ⚠ corrected; A10 is the abandonment sweep), and referenced by the rendered PDF.
  It is never stored per instrument.
- On the fourth release, stamp `releases_completed_at`.
- `used_at`'s last reader disappears here; the column is dropped in this step's migration.

**Verify.** Component tests: the flow cannot skip an instrument; a 409 `disclosure_not_final` renders
as the carrier's problem, not the driver's ("This carrier has not published its final wording yet —
they have been told"). API test with a stubbed non-draft `DISCLOSURES` proving four rows land with
four distinct `disclosure_version` values and four distinct `intent_statement`s.
**Done when:** four signatures exist as four rows, each carrying the exact text signed, and no single
control in the UI can produce more than one of them.

**What shipped.**
- `0228_release_ceremony.sql`: `driver_authorizations.invitation_id` (nullable — staff-recorded
  signatures have no link, and neither does anything written before today), a unique index on
  `(invitation_id, purpose)` where `revokes is null`, and `record_driver_release`. The RPC files one
  signature and **stamps `releases_completed_at` when the last one lands**, in the same transaction:
  a signature without the stamp would leave the ceremony asking for an instrument already signed.
  `p_expected_count` is `APPLICATION_RELEASE_ORDER.length`, passed in — the vocabulary stays in
  TypeScript (0218/0220's division), so a fifth instrument is one array entry, not a migration.
- ⚠ **Why the signature now names the link.** "Has this driver signed the four?" is the wrong
  question: a rehire may have signed the same purposes a year ago on a different application, and
  those do not discharge a new screen — PSP's account agreement requires a signed authorization *in
  advance of each request* (§4). The right question is whether THIS session collected them, and it
  was unaskable without `invitation_id`. The unique index is per link for the same reason.
- `POST /:token/release` is unchanged, as the plan said; the service beneath it gained the
  transaction and now returns `signedCount` / `completed` so the page advances without refetching.
  `GET /:token` serves `releasesSigned`, so a resumed ceremony opens on the next instrument.
- Web `features/apply/signing/`: adoption once (typed name, rendered in a system script face — no
  webfont, so it cannot fail to load on a truck-stop connection), then one screen per instrument with
  a "2 of 4" counter, its served text, its own intent sentence and its own control. **The index only
  advances on a 201**, which is what makes skipping impossible. A `disclosure_not_final` refusal
  renders as the carrier's problem, in those words.
- The office can now see a state that could not exist before: `inviteState` gains **`signing`** — the
  driver opened the link, agreed to sign electronically, and is part-way through the authorizations.

**⚠ Two deliberate deviations from this step's text, both with reasons.**

1. **`used_at` is NOT dropped here.** Every reader is gone (the staff `INVITE_COLS`, the revoke
   guard's `.is("used_at", null)`, and the web `inviteState` fold — all three now read
   `submitted_at`), but the column stays until a later step. `migrate.yml` and Railway finish at
   different times and in no guaranteed order; 2026-08-20 recorded a Railway incident holding deploys
   in a queue for hours while CI stayed green. If the migration lands first, the deployed old code's
   `select … used_at` returns a PostgREST error and the recruiter's invitation list breaks until the
   deploy catches up. Expand then contract: the drop is a one-line migration in **A6**, by which time
   reader-free code is provably live. Cost of waiting: one line. Cost of not: a recruiter-facing 400
   during a platform incident.
2. **The drawn signature mark is not collected yet.** D-APP8 makes it decoration that is never
   required, and A8 is what gives it somewhere to be stored (`documents`, kind `other`, promoted at
   submit). A canvas whose output is silently discarded is worse than no canvas, so the adoption
   screen ships with the typed name — the signature of record — and A8 adds the mark beside it.

**⚠ And the ceremony is skipped while any instrument is draft**, for the reason A4's gate is armed by
A0: `POST /:token/release` refuses draft wording with a 409, so a ceremony gated on it would be a wall
across a working application. While the wording is outstanding the instruments are shown read-only on
the last screen as they were before A5 — nobody should be asked weeks later to sign four documents
they have never seen — and the ceremony opens by itself when A0 publishes.

**Verified by:** `pnpm test` (new matrix `release-ceremony` 19 passed — four rows with four distinct
texts and four distinct intents, the fourth stamping the phase, the same instrument refused twice on
one link and accepted again on a new one, and a signature outliving the deleted invitation that
carried it); the service tests run against a **stubbed non-draft `DISCLOSURES`**, which is what lets
this ship before A0; `useSigningCeremony.test.ts` pins that a failed signature does not advance;
`pnpm typecheck`; `pnpm lint`; all twelve named lint gates plus `pnpm --filter web lint:tokens`.
**Not verified in a browser** — the apply page needs a real minted invitation to reach.

### A6 · The rendered application PDF — DONE 2026-08-21 (migration 0229)

**Prerequisites:** A5. ⚠ **Also carries two small debts from earlier steps:** drop
`application_invitations.used_at` (A5 removed its last reader; the drop waits for that code to be
provably deployed), and print §391.21(b)(1)'s carrier name and address — which needs the address
column §6 now asks the owner for, and prints the name alone until it exists.

**Build.** `apps/api/src/services/applicationPdf.ts` on `dqBinder/pdfDraw.ts`'s toolkit: the §391.21
application laid out in the regulation's own order, then the certification block, then one page per
signed instrument showing its text, the intent sentence, the signature (typed and, if present,
drawn), and the **server-stamped date**. Footer on every page: the driver's name, the application id,
and the sha256 — so a printed page identifies its own source.
Rendered inside `submit_driver_application`'s caller immediately after the transaction commits, filed
as a `documents` row of kind `employment_application` with its sha256, and cited by the existing
§391.51(b)(1) `qualification_records` row via `document_id`.
⚠ It is a **derivative** (D-APP9): a render failure is logged and retried, and it never fails the
submission — the evidence is the payload and the signed rows, both of which are already committed.

**Verify.** Unit tests over the layout helpers; a golden test that a fixed payload produces a stable
byte-length and a stable page count; a test that a thrown renderer does not roll back or fail the
submit. `lint:filesize` (the service starts split if it approaches 450 lines).
**Done when:** a recruiter opens one PDF and sees the whole application with every signature and
every date on it — and PSP's §0.2-style lesson holds: it is offered from the screen the recruiter
actually uses, not filed only where they would have to go looking.

**What shipped.**
- `services/applicationPdf/render.ts` — §391.21(b)(1) through (b)(12) in the regulation's own order,
  each block naming the paragraph it discharges, then the certification, then one page per instrument
  and one for the 7001(c) consent. Each instrument prints **the text stored on its row**, not today's
  constant: a page showing current wording beside an old signature would misrepresent what somebody
  agreed to. The SSN is deliberately absent — the last place nine digits belong is a document a
  recruiter emails.
- `services/applicationPdf/file.ts` — render → upload → `documents` row with the bytes' sha256 →
  `attach_application_document`. `0229` adds that RPC, which sets `document_id` **only where it is
  null**, only on an `employment_application` record, only for the owning org: a general "update a
  qualification record" path would be a way to rewrite evidence.
- Called after the submit transaction, wrapped so it **cannot fail the submission** (D-APP9), and
  called again by the recruiter's route.

**⚠ Three corrections and deviations, each with its reason.**

1. **The sha256 cannot be in the footer.** A6's text asks for it; a file cannot contain the hash of
   its own bytes — changing the footer changes the bytes, which changes the hash, forever. The footer
   carries the digest of the **source** instead: the certified payload the page was drawn from, which
   is stable and is what "identifies its own source" has to mean for a derivative. The hash of the
   bytes lives on the `documents` row, where it can.
2. **"Logged and retried" is `ensureApplicationPdf`, not a job kind.** It files a PDF if none is filed
   and returns the existing one if there is, so the same function serves the submit path (immediately,
   best effort) and the recruiter's download (on demand). A failed render heals the first time
   anybody asks for the document — for a derivative that is a better guarantee than a queue, with
   nothing to register, no `KIND_CAPS` entry and no fleet-wide invariant to keep.
3. **Every field is rendered through a null-tolerant helper**, including ones the contract marks
   required, because this reads STORED payloads: a row filed before A3a has no `additional_licences`,
   and a renderer that throws on an old payload is a qualification file that cannot be produced —
   precisely the §390.32(d) failure the PDF exists to prevent.

**⚠ A pdfkit trap that cost time, worth adding to the harness-facts list.** Text drawn below the
bottom margin is treated as overflowed content and **auto-adds a page**, so stamping a footer at the
foot of the sheet silently doubles the document — and the extra pages arrive after
`bufferedPageRange()` was read, so the "page N of M" printed on them is wrong too. It presents as
"every page added two pages". The fix is to zero `doc.page.margins.bottom` around the footer write and
restore it. Related: `newDrawing` gained an opt-in `bufferPages` flag, because the binder deliberately
does not want one (its footers are stamped across the merged file) and a standalone document does.

**And the two debts from earlier steps are paid.**
- `application_invitations.used_at` is **dropped**. A5 removed its last three readers; this migration
  waited until that code was verified live (deployment 6a1cffc7, schema 0228) so no deployed reader
  could break. ⚠ **The function that still wrote it went first**: `submit_driver_application`'s live
  body stamped `used_at` as well as `submitted_at`, and dropping the column under it would have left
  every submission raising 42703 — a schema change that compiles, deploys and breaks the one
  unauthenticated write path in the product.
- **§391.21(b)(1)** now has somewhere to live: `organizations.legal_address`, nullable, printed when
  present. The renderer prints the carrier's name alone until the owner supplies one, so a missing
  input costs one line rather than the document. §6 still tracks the ask — this is the schema half.

**Verified by:** `pnpm test` (the `application-intake` matrix gained the citation RPC — attached once,
a no-op the second time, and refused across orgs; `application-session` proves the dropped column is
gone); `render.test.ts` inflates and decodes the PDF's own content streams so the assertions read what
is actually on the page (⚠ pdfkit deflates its streams AND emits kerned **hex** runs — grepping the
raw bytes finds nothing and makes every such assertion vacuous); a determinism test; a test that a
thrown renderer leaves the submission standing; `expectOrgScoped` across the whole filing path.
`pnpm typecheck`; `pnpm lint`; all twelve named lint gates plus `pnpm --filter web lint:tokens`.
**Not verified in a browser** — the recruiter card is covered by the API tests behind it.

### A7 · The web capture provider — DONE 2026-08-21 (no migration)

**Prerequisites:** A3.

**Build.**
- `packages/capture-engine`: `GateInput.platform` gains `"web"` with its own thresholds in
  `config.ts`, chosen from measured samples rather than copied from Android (D-APP11). The package
  stays zero-dependency and pure — `lint:boundaries` holds.
- `apps/web/src/features/apply/capture/webFileProvider.ts`: a `CaptureProvider` over
  `<input type="file" accept="image/*" capture="environment">`, reporting `longEdgePx` and leaving
  every other metric unmeasured (`na`, never a silent pass — the mode `gate.ts` already documents).
  Client-side downscale to the config long edge, WebP q80 with a JPEG fallback, EXIF stripped —
  mirroring `expoImagePickerProvider.ts`, which is the reference implementation.
- A rejected capture prompts a re-shoot **without uploading**, which is the whole point of the gate
  living in front of the network.

**Verify.** Unit tests over the new platform's gate thresholds; a provider test that a rejected page
never calls the upload path; the existing capture-engine suite stays green.
**Done when:** a driver photographs a CDL on a phone, a blurry one is refused before it costs
bandwidth, and the accepted image is EXIF-free and under the configured size.

**⚠ The instruction about thresholds cannot be followed as written, and should not be.** A7 says the
`web` platform gets "its own thresholds in `config.ts`, chosen from measured samples rather than
copied from Android (D-APP11) — borrowing would be an assumption, and this plan does not make those."
Building it produced three reasons that is the wrong shape, and they are worth keeping:

1. **There are no measured samples and none can be obtained without shipping first.** A number
   invented from nothing is the same assumption as a number copied from Android, wearing a better hat.
2. **The web provider measures exactly one metric**, `longEdgePx` — the plan says so itself two
   sentences later. A web-specific blur or glare floor would be a threshold the gate never reads,
   because the check is `na`. A number that does nothing is worse than no number: the next reader
   believes it was measured.
3. **The one threshold that does apply must not diverge.** `config.ts`'s own header pins the
   resolution floor to the server's authoritative usability gate and says client and server must
   agree. A client floor above the server's rejects photographs the server would accept; one below
   spends a driver's bandwidth on photographs the server then refuses.

So `web` ships as a platform token with no numbers of its own, the reasoning is written into
`config.ts` where the next person will meet it, and a test asserts the web path reaches the **same
verdict as the driver app's JS fallback for the same measurements** — because a licence photographed
in the driver app and one photographed from the application link are the same photograph. If a
measured re-shoot rate later justifies a web-specific floor, it arrives as a signed config override,
which is what that file exists for.

**What shipped.**
- `capture-engine`: `GateInput.platform` gains `"web"`, `platformOverrides` gains a `web` entry for
  totality (inert — no OCR runs in a browser), and the package stays pure and zero-dependency.
- `features/apply/capture/webImageIo.ts` — the browser half behind an interface: `createImageBitmap`
  → canvas downscale → WebP q80 with a **type-checked** JPEG fallback (a browser that cannot encode
  WebP hands back a PNG or a null rather than failing loudly, so the check is on `blob.type`, not on
  truthiness) → `crypto.subtle` sha256. ⚠ `imageOrientation: "from-image"` is not optional: EXIF
  orientation is part of what is being discarded, and without it a portrait photograph re-encodes
  sideways.
- **EXIF stripping is a property of the pipeline, not a step.** Decoding to a bitmap and re-encoding
  through a canvas yields pixels and nothing else, so the original file's metadata — on a phone, the
  GPS coordinates of wherever the driver photographed their licence — cannot survive. There is no
  `stripExif()` to forget to call.
- `webFileProvider.ts` — the third implementation of the engine's provider seam, mirroring the driver
  app's JS fallback deliberately. ⚠ Resolution is measured on the **original**, before the downscale:
  gating the resized copy would be circular, since everything is resized to the same long edge.
- A rejected capture returns `{ ok: false, reason }` with **no page**, so there is nothing for a
  caller to upload, and its object URL is revoked rather than left for the browser to collect — a
  driver re-shooting four times should not accumulate four rejected photographs in a phone's memory.

**Verified by:** `pnpm test` — `webFileProvider.test.ts` pins the property the step exists for (a
photograph that fails the gate never becomes a page, so nothing can be uploaded), that unmeasurable
checks are `na` rather than silent passes, and that the original long edge is what the gate sees;
`gate.test.ts` gains the web platform, including the same-verdict-as-the-fallback assertion. The IO is
behind an interface so all of it runs without a camera, a canvas or a GPU. `pnpm typecheck`;
`pnpm lint`; all twelve named lint gates plus `pnpm --filter web lint:tokens` — `lint:boundaries`
confirms `capture-engine` stayed clean of `@fuelguard/*` and of clocks.
**No UI yet, by design:** A8 owns the capture screen, the slots and the upload. A7 is the provider it
will call, and shipping a screen with nowhere to put the bytes would be the dead-screen mistake A3a
already declined to make.

### A8a · Staged captures, filed at submit — DONE 2026-08-21 (migration 0230)

⚠ **A8 is split into two named sub-steps**, on A3's precedent. A8a is the whole of the step's Build
list: the table, the bucket, the endpoints, the promotion and the capture screen. A8b is the drawn
signature mark, which A5's deviation #2 deferred to "wherever it has somewhere to be stored" — it is
a canvas in the signing ceremony plus a change to A6's renderer, it writes to a slot A8a's closed set
already carries, and it is decoration by D-APP8. Bundling it would have put a change to the rendered
§391.51(b)(1) document in the same PR as the staging pipeline, and the mark must never delay the
thing that carries legal weight.

**Prerequisites:** A7, A2.

**Build.**
- Migration: `application_captures` — `org_id`, `invitation_id` FK cascade, `driver_id`,
  `slot text` (a closed set: `cdl_front`, `cdl_back`, `medical_card`, `ssn_card`, `signature_mark`,
  `other`), `storage_path`, `content_type`, `bytes`, `sha256`, `captured_at`. Operational, prunable,
  0213-style guard, cascade from the invitation. **Unique on (invitation_id, slot)** — a re-shoot
  replaces its slot rather than accumulating (D-APP10).
- Staging bucket, separate from `documents`: a candidate who never submits leaves nothing in an
  evidence bucket. The nightly `startStorageReconcileScheduler` orphan sweep gains this bucket.
- `POST /api/public/application/:token/capture` mints a signed upload URL scoped to that
  invitation's slot, with the same "bytes never touch the API" property `compliance.ts:110` already
  has. Allowed kinds are the closed slot set, not `DOCUMENT_KINDS` — the applicant does not choose
  from the carrier's whole vocabulary.
- `submit_driver_application` gains a promotion step inside its existing transaction (⚠ its live
  definition is 0222's `create or replace`, not 0220's — extend that body): each accepted capture
  becomes a `documents` row with `subject_type='driver'`, mapped slot → `DocumentKind`
  (`cdl_front`/`cdl_back` → `cdl`, `medical_card` → `medical_card`, `ssn_card` → `other`,
  `signature_mark` → `other`), carrying the sha256 forward. Storage objects are copied, then the staging rows are left for the retention
  rule — never deleted inline, because a delete inside the submit transaction cannot be rolled back.

**Verify.** Matrix: unique-per-slot holds; a re-shoot replaces; cascade removes staged rows and the
storage sweep collects the objects; promotion produces exactly one `documents` row per accepted slot
and is idempotent under a replayed submit.
**Done when:** a driver photographs everything from the same link, re-shoots freely, and the
qualification file receives exactly one copy of each — and an abandoned application leaves no
`documents` row at all.

**What shipped.**
- `0230_application_captures.sql`: the table as specified (0226's 0213-style guard, cascade from the
  invitation, absent from `RETENTION_FORBIDDEN`, unique on `(invitation_id, slot)`), the private
  `application-captures` bucket capped at 8 MB with **no client write policy at all** — every upload
  is a signed URL the API minted for somebody with no JWT for a policy to read — and
  `stage_application_capture`, an explicit delete-then-insert RPC that returns the superseded object's
  path so the caller can collect the bytes.
- `packages/shared/src/applicationCaptureContract.ts`: the closed slot set with its labels, the
  slot → `DocumentKind` and slot → `documents.page` maps, the storage key, and the two request
  schemas. **`cdl_back` is page 2 of the same `cdl` kind**: two sides of one licence are two pages of
  one document, which is what that column has meant since 0146, and two page-1 rows would order
  themselves by whichever upload won.
- `POST /:token/capture` and `PUT /:token/capture/:id`, plus `captures` on `GET /:token` — slots and
  dates, never the photographs, because re-serving them would mint a signed read URL per slot on an
  unauthenticated surface on every page load for no decision the driver has to make.
- `submit_driver_application` promotes the staged set inside its existing transaction; the API copies
  the objects Storage-to-Storage first, since bytes cannot be moved from SQL.
- A `documents` screen in the wizard, between `safety` and `review` — the driver photographs the
  documents while they are still holding them, then checks the answers they are about to certify.
- The nightly `startStorageReconcileScheduler` gains the bucket, and it is the first NON-evidence
  bucket in that sweep (see the ⚠ below).

**⚠ Four decisions the step's text did not make, each with its reason.**

1. **The row is written AFTER the bytes, not before — the opposite of `compliance.ts:110`.** The
   plan said the endpoint "mints a signed upload URL", which is 0146's register-then-upload shape.
   That shape is right for evidence: the claim that a document exists must outlive a dropped
   connection, which is why the orphan reconcile flags a missing object loudly as possible evidence
   loss. For staging it is exactly backwards — a row here is what tells the driver a slot is filled,
   so `POST /:token/capture` writes nothing and `PUT /:token/capture/:id` stages only after reading
   the object back out of the bucket. Every failure in the chain now leaves BYTES nobody references,
   never a slot claiming a photograph that was never taken. It costs one extra request per accepted
   photograph, and a re-shoot still costs none at all, because the gate runs before the network (A7).
2. **The function signature is widened by DROP-then-create, not `create or replace`.** Postgres
   identifies a function by (name, argument types), so `create or replace` with an extra parameter
   creates a SECOND function; an eleven-argument call would then match both — the twelfth defaults —
   and fail as *ambiguous*. Both halves of the deploy/migrate race 0229's header describes are
   covered instead: `p_captures` **defaults to `'[]'`**, so a migration that lands before the deploy
   leaves the old code working unchanged, and the API **omits the parameter** when there is nothing
   to promote, which is every submission in existence today. A matrix assertion pins that exactly one
   `submit_driver_application` exists.
3. **A failed promotion REFUSES the submission.** A6 established that the rendered PDF never costs a
   submission, because a derivative can be produced again from evidence that never moved. A
   photograph is the opposite: the only copy is in a staging bucket A11 will prune, and filing the
   application without it would put a driver's licence beyond reach of the file it belongs to,
   silently. Nothing is spent by the refusal — the phase stamp is inside the transaction that never
   ran — so pressing send again promotes the same set, and a copy onto a key that already exists is
   treated as done rather than as an error.
4. **Nothing on the capture screen is required, and `signature_mark` is not on it.** §391.21 is a
   form and none of its twelve paragraphs is a photograph; §391.51's file is assembled across the
   whole hiring process. A driver whose camera will not open must still be able to certify and send,
   or the carrier loses the candidate over a picture a recruiter can ask for by email
   (`APPLICATION_CAPTURE_REQUIRED` is empty, and says so in place). `signature_mark` belongs to the
   ceremony: a slot on this screen would collect a photograph of a piece of paper rather than the
   mark D-APP8 describes.

**⚠ And one thing worth knowing about `ssn_card`.** It is the one slot whose CONTENT is more
sensitive than the column it lands in. D-APP3 seals a typed Social Security number into a secretBox
envelope bound to the org, or drops it entirely where no key is configured; a photograph of the card
is the same nine digits as pixels in an evidence bucket that sealing cannot reach. It is collected
because a carrier lawfully collects it and `documents` is restricted at the row (0146's driver-scoped
RESTRICTIVE policy) and at the projection — but it is named in the contract so whoever writes A11's
retention rule meets the asymmetry rather than discovering it.

**Verified by:** `pnpm test` — new matrix `application-captures` (**37 passed**), which proves the
re-shoot replaces its slot and hands back the superseded path, that a browser session can neither
read nor write the table and a JWT-bearing writer gets DA040 while the service role can delete (the
prunability pin the 0213 trigger style exists for), that deleting the invitation collects the staged
rows **and leaves no `documents` row at all**, that promotion files exactly one document per capture
under the capture's own id with the sha256 carried forward, that a replayed submit raises DA022 and
files nothing, and that a promotion naming a capture from another invitation files nothing — the JOIN,
not the caller's array, is what decides. `applicationCapture.test.ts` (12) pins that the start call
writes nothing at all, that a confirm without an object in the bucket stages nothing, and that the
size recorded is the one Storage reports rather than one a request supplied;
`applicationIntake.test.ts` gains the three submit-path assertions (copy before the transaction, the
parameter omitted when empty, the submission refused rather than filed short);
`useApplicationCaptures.test.ts` (7) pins A7's property one layer up — a refused photograph produces
no network call at all — and that a cancelled picker is not a failure; `publicApplication.test.ts`
gains five route assertions including `capture_upload_failed` answering **422 and not 404**, because
the link is fine and the page's whole vocabulary for 404 is "this link is dead". `pnpm typecheck`;
`pnpm lint`; all twelve named lint gates plus `pnpm --filter web lint:tokens`.
**Not verified in a browser** — the apply page is session-free and needs a real minted invitation to
reach, so the wizard is exercised by mounting the real page in `ApplyPage.test.ts` (which now walks
all eight screens) rather than by clicking through one.

### A8b · The drawn signature mark — DONE 2026-08-21 (no migration)

**Prerequisites:** A8a (its `signature_mark` slot and staging pipeline), A5, A6.

D-APP8 stands: the typed name is the signature of record and the drawn mark is decoration, stored as
evidence of nothing more than itself. A5 shipped adoption with the typed name alone because a canvas
whose output is discarded is worse than no canvas; A8a gives the output somewhere to go.

**Build.** A canvas on the ceremony's adoption screen, optional and never required (a driver on a
cracked screen who cannot produce a squiggle has still signed); its PNG staged through the same two
capture calls into the `signature_mark` slot; `applicationPdf/render.ts` drawing it beside the typed
name in the signature block, where A6's own text already says "the signature (typed and, if present,
drawn)". Nothing about the `driver_authorizations` row changes — the mark is not what makes the
signature good, and a renderer that could not find one must still produce the document.

**What shipped.**
- `signing/SignaturePad.vue` — pointer-event strokes on a canvas sized by the device pixel ratio,
  with a Clear control, emitting a PNG blob after every stroke. Two things on a phone are easy to get
  wrong and both are commented in place: `touch-action: none`, without which the first stroke scrolls
  the page instead of drawing, and the backing-store scale, without which a retina signature arrives
  in the PDF as a blurred smear.
- `useSigningCeremony.adopt()` became async and stages the mark into `signature_mark` before adopting.
- `capture/stageCapture.ts` — the three network acts, extracted from `useApplicationCaptures` and now
  shared. Two producers that could not be more different — a phone camera through the gate, a finger
  on a canvas — must not each hold their own idea of what order those calls go in.
- `render.ts` gains `signatureMark: Buffer | null` and draws it under "Signed" on the certification
  page and on every instrument page.
- `applicationPdf/file.ts` finds it (see below) and passes the bytes in.

**⚠ How the mark is FOUND, which is the only hard part of this step.** It promotes into `documents`
as kind `other` — and so does a promoted `ssn_card`, so `documents` alone cannot say which row is a
signature. The index is the staged row: `application_captures` names the slot, and A8a's identity
property finishes the job, because **`documents.id` IS the capture id**. One lookup by slot gives the
id of the filed copy. The bytes are read from `compliance-docs` when the copy is there and from the
staging bucket when it is not (a re-render before any submission), and every failure returns null.

⚠ **That leaves one consequence for A11 to decide, not to discover.** Once the retention rule prunes
staged captures, a re-render years later finds no `application_captures` row and draws the document
with the typed name alone — which is what D-APP8 says the signature of record has been all along, and
the PDF filed on the day still carries the mark. If that is judged too lossy, A11's rule is one
exception away from keeping `signature_mark` rows. It is named in A11 for exactly this reason.

**⚠ Two other decisions worth the ink.**

1. **The upload is awaited but its failure is swallowed.** Awaited, because the submit transaction
   promotes whatever is staged *at that moment*, and a driver who signs four instruments quickly
   could otherwise certify an application whose mark had not landed. Swallowed, because a PNG that
   will not upload must not stand between a driver and four federally-required signatures — that
   would be a product that had confused the ornament for the thing.
2. **The renderer wraps `doc.image` in a try/catch and checks for room first.** pdfkit throws on
   anything that is not a PNG or a JPEG, and these bytes came from a canvas on a stranger's phone
   through a bucket: a truncated upload must cost the squiggle and never the document, because a
   §391.51(b)(1) record that cannot be produced is precisely the §390.32(d) failure this renderer
   exists to prevent. And `doc.image` will happily draw off the bottom of the sheet — unlike text, it
   gets no auto-added page — so without the room check a mark would be lost silently on whichever
   instrument happened to carry the longest disclosure.

⚠ **One gate is waived, in place and with its reason:** `lint:tokens` on the canvas stroke colour.
These pixels do not stay in the browser — they are re-encoded to a PNG and drawn on a printed white
sheet — so a stroke that inherited a dark theme's foreground would arrive as a near-white signature
on white paper. `chartTheme.ts` is allow-listed for the same reason; this uses the per-line
`token-check-disable-line` the gate provides.

**Verified by:** `pnpm test` — `render.test.ts` gains three assertions that are one assertion said
three ways (the document is produced with the mark, without it, and in spite of a buffer that will
not decode); `file.test.ts` gains four proving the capture→document lookup reads the promoted copy
from `compliance-docs`, falls back to the staged object, downloads nothing when no mark was drawn,
and still files the document when the download throws; `useSigningCeremony.test.ts` gains three, of
which the one this sub-step exists for is that a failed mark upload still adopts and the ceremony
carries on. ⚠ `useSigningCeremony.test.ts`'s module mock had to gain the three capture functions it
never calls — `stageCapture`'s default io binds them at load, so a partial mock is an import-time
crash rather than a call-time one. `pnpm typecheck`; `pnpm lint`; all twelve named lint gates plus
`pnpm --filter web lint:tokens`.
**Not verified in a browser** — same reason as every step since A1: the apply page is session-free and
needs a real minted invitation to reach. ⚠ And note what that means HERE specifically: the canvas
itself — whether a finger draws a legible line on a real phone — is the one thing in this plan that a
component test genuinely cannot answer. It is decoration, so shipping it unproven costs a squiggle
rather than a record; but the first real applicant is the first real test of it.

### A9 · The carrier questionnaire — DONE 2026-08-21 (migration 0231)

**Prerequisites:** A3. **Input required: the owner's Excel application** — this step's build begins
by transcribing it (§6).

**Build.**
- `packages/shared/src/questionnaireContract.ts`: a versioned definition (id, version, ordered
  questions with types `text | longtext | boolean | select | date | number`, required flags, and an
  exported label map), plus `questionnaireAnswersSchema` validating answers against a definition.
- `driverApplicationSchema` gains `questionnaire_version: z.string().nullish()` and
  `questionnaire_answers` — the one contract change, after which carrier form changes touch no
  regulated schema (D-APP12).
- Definitions live in code, org-scoped by id, versioned like `DISCLOSURES` — the same argument: what
  a person answered is only meaningful beside the exact question asked.
- ⚠ A test pins that no questionnaire key is read by `applicationDriverPatch`, by the employment
  projection, or by any DQF item — and that `questionnaire_answers.eeo`, if present, is absent from
  every recruiter-facing projection.

**Verify.** Unit tests for definition/answer validation and version mismatch; the projection-exclusion
tests above; a test that Silvicom's transcribed definition round-trips.
**Done when:** the owner's Excel exists as a versioned definition, a driver answers it inside the same
flow, and not one of those answers has touched §391.21's schema or the qualification file.

**What shipped.**
- `packages/shared/src/questionnaireContract.ts` — the definition type, `SILVICOM_DRIVER_V1`
  transcribed from `APPLICATION.xlsx` (read out of the workbook itself, not from §6.1's summary),
  `questionnaireAnswersSchema`, and `readableAnswers`. Eleven questions, addressed as
  `silvicom_driver@v1`.
- `driverApplicationSchema` gains `questionnaire_version` and `questionnaire_answers` — the one
  contract change D-APP12 budgeted for, after which the carrier's form changes without touching
  anything §391.21 numbers.
- A `questions` wizard screen between `safety` and `documents`, rendering whatever the definition
  holds and knowing none of the carrier's questions by name. Answers autosave with the rest of the
  draft (they carry no SSN and no D-APP3 field).
- `render.ts` prints them as their own section — see the deviation below.
- **And two corrections to the regulated contract**, made after checking the primary sources rather
  than the packet — see "What the sources actually say" below: `equipment_experience` (§391.21(b)(6))
  and `other_names` (§391.23(a)(2), migration 0231).

**⚠ Four deviations from this step's text, each with its reason.**

1. **A `table` question kind, which the plan's type list does not have.** Two of the things the packet
   asks for are grids: education, and three references. Flattening either would have produced scalar
   fields whose names encode their row and column — a table pretending not to be one, and unreadable
   in the rendered document. One more kind models what the paper is. On screen the rows are stacked
   cards, not a grid: nine in ten of these are filled on a phone, and a five-column table is a
   horizontal scroll inside a form, which is where drivers stop.
2. **There is no `required` flag, although the step asks for one.** A flag has to be enforced
   somewhere and there are only two places. In the wizard alone it breaks the property A3 built the
   wizard on — the client validates with the server's own object, so the two can never disagree. In
   the schema it lets a carrier's own question refuse a §391.21 application, which is the opposite of
   the decision A8a already took for photographs. A flag enforced in neither place is decoration that
   reads as a rule. So the questionnaire blocks nothing, both validators accept everything, and they
   agree exactly. If the carrier later wants an answer mandatory, the honest shape is an
   `APPLICATION_CROSS_FIELD_RULES` entry — one place, both validators — and that is a decision to make
   rather than inherit. The reasoning is written at the type, where the next person will meet it.
3. **The answers ARE rendered into the application PDF, and the step does not mention the renderer.**
   Checked against D-APP12 rather than assumed: it names three places the answers must not reach —
   `drivers`, `driver_employment_history`, DQF items — and this document is none of them; it is a
   derivative of the payload the answers live in. It had to be done, because
   `GET /drivers/:id/application` serves the PDF **and nothing else of the application's content**, so
   a questionnaire left out of it is a form collected and read by nobody. It is a separate section
   after everything the regulation numbers, under a heading that says whose questions they are, so a
   reader with the CFR open is never told §391.21 asks for a driver's references. ⚠ The reserved `eeo`
   key never appears on it, pinned by a test.
4. **No org column, and definitions "org-scoped by id" means the id is the scope.** Spending a
   migration on a column that would hold the same value in every row of a one-row table is generality
   that reads as a feature and is really an unused join. The day a second carrier's form differs, the
   selection becomes a column and `questionnaireForApplicant` grows an argument.

### What the sources actually say — two corrections A9 made to itself

Both of these were raised as open questions when the questionnaire was first transcribed, and both
were then settled against **primary sources** rather than against the packet or a search summary.
The sources: §391.21(b) read verbatim on Cornell LII, and **FMCSA's own sample driver employment
application** (`csa.fmcsa.dot.gov/SafetyPlanner/documents/Forms/Drivers_Employment_Application_508.pdf`),
both read 2026-08-21. ⚠ ecfr.gov still redirects to a bot-check and cannot be fetched.

**1. The driving-experience grid IS §391.21(b)(6). It moved into the regulated contract.**

(b)(6) verbatim: *"The nature and extent of the applicant's experience in the operation of motor
vehicles, **including the type of equipment (such as buses, trucks, truck tractors, semitrailers, full
trailers, and pole trailers) which he/she has operated**"*. The paragraph asks for two things in one
sentence, and `experience` — free text — answered only the first. FMCSA's own sample application lays
the second out as exactly the grid the owner's packet contains, column for column: class of equipment
× type (VAN, TANK, FLAT, ETC.) × date from × date to × approximate total miles. **The packet is a
near-verbatim copy of the government's form**; the grid is the regulation's, not the carrier's.

So `equipment_experience` is now a regulated field on the employment screen, rendered under (b)(6),
and the questionnaire no longer asks for it. Two further consequences, both deliberate:
  - the class list is FMCSA's form's, **plus `bus`** — which (b)(6)'s own parenthetical names first and
    that form omits;
  - a cross-field rule now refuses a document that answers **neither** half of the sentence. (b)(6) is
    mandatory content of the application form and this schema previously accepted it blank, because
    `experience` was nullish and there was nothing else. Either half satisfies it, and a driver can
    always give one.

**2. Aliases are NOT a §391.21 field — the plan's §6.1 note was right about the gap and wrong about
where it belongs.** (b)(2) verbatim is *"The applicant's name, address, date of birth, and social
security number"*, and FMCSA's sample application asks for first, middle and last name and **no other
name anywhere on its four pages**. ⚠ Secondary sources asserting that the FMCSRs require aliases are
simply wrong, and were not taken at face value.

It earns its place under **§391.23(a)(2)** instead: the carrier must investigate the previous three
years, and a driver who drove under a maiden name is a driver that employer's records do not contain
— the inquiry goes out naming somebody they have never heard of, the reply is "no record", and a clean
safety history is indistinguishable from an absent one. That is also exactly where the owner's packet
asks for it: nowhere on its application pages, and once on the "10 year employment history background
verification log", which is the office worksheet `employer_inquiries` (0223) replaced.

So `other_names` is on the identity screen, cited §391.23 rather than to any (b) paragraph, and —
this is the part that matters — it is **projected**. 0231 adds `drivers.other_names`, the intake fills
it, and `driverNameForInquiry` puts it in the letter: *"Susan Godfrey (also known as Susan Smith)"*.
It is deliberately NOT questionnaire material for that reason: D-APP12 projects questionnaire answers
nowhere, and this field's entire value is being projected. A fact we asked for, stored and never used
would be the same write-only failure that made A9 render its questionnaire rather than merely collect
it.

**Verified by:** `pnpm test` — `questionnaireContract.test.ts` (13) checks the definition is
internally coherent, carries every question §6.1's pile 2 lists, survives a version this build has
never served, and — the ones that matter — runs the **real projection** over an application carrying
answers and proves none of them reaches the driver patch or the employment rows, and that the
reserved EEO key is invisible to anything that reads answers; `render.test.ts` gains five, including
that a `no` is distinguishable from an unanswered question and that an EEO payload prints nothing;
`draft.test.ts` gains five on the round-trip, including that `false` survives and whitespace does not.
For the two corrections: `applicationContract.test.ts` gains seven — that a document answering neither
half of (b)(6) is refused, that either half satisfies it, that a day-precision date and a class the
regulation does not name are both refused, and that `other_names` defaults to none; `render.test.ts`
gains five more (the equipment prints under (b)(6) with its label rather than its stored token, an
open-ended row reads "present", a payload predating the field still renders, and "Also known as"
appears only when there is one); `employerInquiryContract.test.ts` is new and pins the line the whole
alias field exists for, including that a driver who types their own name is not introduced to
themselves; the `application-intake` matrix pins that the names are projected onto `drivers` and that
an application naming none leaves the column NULL rather than `{}` — "we never asked" and "they said
none" are different facts.
`pnpm typecheck`; `pnpm lint`; all twelve named lint gates plus `pnpm --filter web lint:tokens`.
**Not verified in a browser** — same reason as every step since A1.

### A10 · Abandonment recovery — DONE 2026-08-21 (migration 0232)

**Prerequisites:** A2.

**Build.** A second pass inside `startDqAlertScheduler`'s existing 6-hourly run (D-APP15): find
invitations with a draft, no `submitted_at`, not revoked, not expired, last touched more than 48
hours ago and not yet nudged. Send the driver a "your application is saved — here is your link back"
email through `sendEmail`, stamp `nudged_at`, and nudge **once**. Extend the invitation's expiry by
the configured TTL when a nudge is sent, because a link that expires between the nudge and the click
is worse than no nudge.
The office side: a `NotificationCategory` of `application_stalled`, with its `notificationRoute`
entry added web-side **in the same PR** (an alert that cannot deep-link to its queue is half an
alert), and the `notification_events` CHECK extended in the same migration.

**Verify.** Unit tests over the selection fold (fresh drafts excluded, already-nudged excluded,
revoked excluded, expired excluded); a test that a nudge extends expiry; `expectOrgScoped` on the
sweep query.
**Done when:** a driver who walked away at the employment section gets one link back, and the office
sees a count of who stalled.

**⚠ THE STEP'S CENTRAL INSTRUCTION CANNOT BE FOLLOWED AS WRITTEN.** "Here is your link back" assumes a
link exists to send. It does not. The invitation token is 256 bits that `application_invitations`
stores ONLY as a SHA-256 (0220); the plaintext is returned once at mint time and never again, and the
entire security posture of the public surface rests on it — a leak of that table yields hashes and
timestamps, not working links. **A scheduler cannot reconstruct what nobody kept.**

The repo already has an answer for a lost link — `applicationInvites.ts`: *"A lost link is replaced by
a NEW invitation, and the old one is revoked."* ⚠ **That answer is wrong here**, and the reason is the
whole feature: `application_drafts` is one row per invitation, so a new invitation resumes an EMPTY
form. An email promising a driver their saved application, whose link then shows a blank one, is worse
than sending nothing.

**Decision: the token is ROTATED IN PLACE.** Same invitation row — same draft, same phase stamps, same
signed releases — and a fresh hash. Considered and rejected: sealing a copy of the token with
secretBox, as `driver_applications.ssn_sealed` already does in this table family. That would let the
SAME link be re-sent so both emails keep working, at the cost of making "a leak of this table yields
no working links" true only while the key holds. Rotation keeps 0220's property exactly as written
and costs one thing instead: a driver who digs out the ORIGINAL email after being nudged gets the
neutral "this link is not valid" refusal. The nudge copy says so in as many words, and the newer
email is the one in front of them.

**What shipped.**
- `packages/shared/src/applicationNudge.ts` — the selection fold, pure. Five exclusions, each a fact
  about the invitation rather than a heuristic: submitted, revoked, expired, already nudged, and a
  draft touched inside the 48-hour window.
- `0232`: `application_invitations.nudged_at`; `nudge_application_invitation`, which rotates the hash,
  extends the expiry with `greatest()` (a recruiter's deliberate 60-day link is never cut to 14) and
  stamps `nudged_at` **in one transaction**; and the `notification_events` CHECK extended for
  `application_stalled`, on 0093/0154/0207's model.
- `applicationNudgeSweep.ts` — rotate FIRST, then send. The reverse would email a link that does not
  work yet, and any failure between the two would leave the driver holding a dead link with no way
  back. This order costs, at worst, an email they never got — with the office alert still telling
  somebody to phone them.
- A second pass inside `startDqAlertScheduler`'s existing six-hourly run (D-APP15), in its own `try`:
  an org whose DQ alerts throw must still have its stalled applicants found, and the reverse.
- `application_stalled` joins `NotificationCategory` with its label, and `notificationRoute` sends it
  to `/recruitment` — the applicant board IS the queue, and there is no per-applicant page to land on.
- `APPLICATION_NUDGE_ENABLED`, default **on**. This is the first thing in the product that emails an
  APPLICANT unprompted, so it gets its own switch rather than riding on `DQ_ALERTS_ENABLED` — but a
  recapture feature nobody turns on is one that does not exist, and the real safeguards are structural
  (one nudge per invitation ever, nothing before 48 hours, nothing at all without a mail provider).
  Setting it false stops the driver email and leaves the office alert, which is the half a carrier
  might legitimately want alone.

**⚠ One more decision the step did not anticipate: an invitation with no email address.** The recruiter
may have issued the link to be passed on by hand. Such a candidate still produces the OFFICE alert —
that is the cue to pick up the phone — and the invitation is **not touched**: not rotated, because
that would kill the driver's only link, and not stamped, because spending the one nudge on an email
nobody could receive is the failure this shape exists to avoid. The dedupe key means the office hears
once, and the candidate falls out of the fold by itself when the link expires.

**Verified by:** `pnpm test` — `applicationNudge.test.ts` (10) tests each exclusion on its own rather
than through one happy path, because the failure that matters is not "nobody was nudged" but nudging
somebody who finished, somebody whose link the carrier deliberately took away, or somebody twice;
`applicationNudgeSweep.test.ts` (7) pins the ORDER (a fresh 64-character hash reaches the RPC before
any mail is sent, and the emailed link carries the plaintext that rotation was derived from), that a
lost race sends nothing, and that a missing address alerts without touching the link; the
`application-session` matrix gains eight SQL assertions — the rotation, the extension, the stamp, the
refusal of a second nudge, of a submitted invitation and of a revoked one, that `greatest()` never
shortens a long link, and that the function is service_role only. `expectOrgScoped` on the sweep.
`pnpm typecheck`; `pnpm lint`; all twelve named lint gates plus `pnpm --filter web lint:tokens`.
**Not verified against a real inbox** — no mail provider is configured in test, so `sendEmail` is
mocked and what a driver actually receives has not been read by a person.

### A11a · The retention rule — DONE 2026-08-21 (no migration)

⚠ **A11 is split**, on A3a/A3b's and A8a/A8b's precedent: it bundles two unrelated features, and only
one of them has an external dependency. **A11a** is the retention rule — nothing waits on it, and it
is what makes D-APP2's and D-APP10's word "prunable" true rather than aspirational. **A11b** is SMS,
which is a consent regime with a multi-week procurement lead time and ships flag-default-off.

**What shipped.** Two entries in `RETENTION_RULES` and no new machinery at all. `dataRetention.ts` is
a declarative engine — one column, one cutoff, bounded batches — and both tables took 0213's trigger
style (`auth_role() is null` PASSES, which is the service role this runner is) specifically so that
these two lines could exist. The EI010/DA010 family, correct for evidence, would have made the promise
structurally false.

**⚠ The window is measured from the LAST TOUCH, not from the invitation's expiry.** A11's text asks
for "a configured window after their invitation expires or its lead is dispositioned"; that needs a
join this engine deliberately cannot express, because every rule compares one column on one table and
that is what keeps the policy readable as a list. The last touch is also the better measure: retention
answers "how long has this personal data sat here unused", not "how long ago did a credential lapse".
A draft somebody is still filling in is never pruned, because saving moves `updated_at`.

**⚠ `signature_mark` is pruned with everything else — the decision A8b deferred to this step, taken
rather than discovered.** The staged row is how the PDF renderer FINDS the drawn mark, so after the
window a re-render draws the typed name alone. That is exactly what D-APP8 says the signature of
record has always been; the PDF filed on the day keeps its mark for ever; and a retention rule with an
exemption in it is one the next reader gets wrong. The cost, stated plainly: the promoted PNG survives
in `documents` as a row of kind `other` that nothing can identify any more. That is cosmetic
untidiness, not a defect.

**Deleting the row is the whole mechanism for the bytes.** `load_stop_photos` set the pattern: a
staged capture's row is what the `application-captures` orphan sweep (A8a) checks Storage against, so
a deleted row makes its object an orphan and the object goes on the next pass after the 24-hour grace.
Two mechanisms built for other reasons compose into the policy, and neither had to change.

**Verify.** ⚠ The SQL half of this step's original Verify — "the retention rule actually removes draft
and capture rows" — was already proved by A2's and A8a's matrices, each of which pins that the service
role CAN delete its table and that a JWT-bearing writer cannot. Re-asserting it here would be a second
copy of somebody else's test.
**Verified by:** `pnpm test` — `dataRetention.test.ts` gains an assertion that pins the pair TOGETHER
with the forbidden list, because the whole design is the line between them: the half-typed form and the
staged photographs go, and `driver_applications`, `documents` and `application_invitations` — what a
submitted application turns that data into — are in `RETENTION_FORBIDDEN` and unreachable;
`storageReconcile.test.ts` gains the composition said out loud (a capture row retention deleted has
its object collected on the next pass, and the same object inside the 24-hour grace is an upload in
flight rather than an orphan) — because a reader of either half alone would reasonably conclude the
bytes were being left behind. `pnpm typecheck`; `pnpm lint`; all twelve named lint gates plus
`pnpm --filter web lint:tokens`.
**Done when:** an abandoned candidate's half-typed PII actually disappears on schedule — which is now
true, on a 90-day window from last touch.

### A11b · SMS delivery

**Prerequisites:** A10, A11a. **10DLC brand and campaign registration is started on the day A1 starts**
(D-APP13) — it is a procurement lead time, not a dependency to discover late.

**Build.**
- Migration: `sms_consents` — evidence-side, EI010-family guard, `RETENTION_FORBIDDEN`: `org_id`,
  `driver_id` or `lead_id`, `phone`, `consent_text`, `consent_version`, `granted_at`, `revoked_at`,
  `source`, plus the attribution fields. Consent is captured as a **standalone** control when the
  phone number arrives (the R1 lead form and the application's identity section), never bundled.
- `apps/api/src/lib/sms.ts` behind an env flag **default off**, mirroring `mailer.ts`'s shape.
  Quiet-hours enforcement (8 p.m.–9 a.m. recipient-local, derived from the number's area code with a
  configured carrier-timezone fallback), `STOP` handling that writes `revoked_at`, and sender
  identification in every message body.
- Invitation and nudge delivery gain an SMS path chosen only when a live consent row exists.
- ~~Same migration: the **retention rule**~~ — **shipped as A11a**, above, including A8b's
  `signature_mark` decision.

**Verify.** Unit: quiet hours refuse and reschedule rather than drop; a revoked consent refuses send;
no consent refuses send.
**Done when:** a driver who consented gets a text with their link, a driver who did not gets an email,
and `STOP` is honoured on the next send.

⚠ **One thing A11b must decide that A10 already made concrete.** The nudge ROTATES the invitation
token (there is no link to re-send — 0220 keeps a hash). An SMS nudge rotates it too, so a driver who
consented to SMS and also has the email link will find the older one dead. That is the same trade A10
took, but it is now taken twice on the same invitation and the copy has to say so in 160 characters.

---

## 6. Inputs owned outside engineering — and the decision the code takes for each

Nothing in §5 waits on an answer. Each item below names its owner, and the behaviour that ships
regardless.

| Input | Owner | What the code does |
|---|---|---|
| **The five instruments' v1 wording + the 7001(c) text** | Counsel, via the owner | Ships refusing drafts (409, already built). Every step is verified against a non-draft test fixture, so nothing is blocked from being built or proven — only the first real signature waits. A0. ⚠ Since A4 this text also **arms the 7001(c) gate**: publishing it is what makes the consent required on every write path, and until then the application runs exactly as it did before. A4 shipped the six clauses as placeholders with a statutory citation each, so counsel's pass is six named strings rather than a blank page. |
| ~~**The Excel application**~~ | Owner | **ARRIVED 2026-08-21, and TRANSCRIBED by A9 the same day** — `APPLICATION.xlsx`, committed beside this plan. ⚠ **It is not a questionnaire; it is a 31-page contractor packet**, and what it contains changed A9 and still changes A0. §6.1 is the inventory; pile 2 now exists in code as `silvicom_driver@v1`. Piles 3 and 4 remain outstanding work for A0 and for the R-side steps respectively. |
| **Which documents a driver must photograph** | Owner | **A8a shipped** the closed slot set `cdl_front`, `cdl_back`, `medical_card`, `ssn_card`, `signature_mark`, `other` — derived from `CERTIFICATION_KINDS` and §391.51's contents. The screen asks for the first four; adding a slot later is one enum entry plus one mapping line, and no migration column changes. ⚠ **None of them is required to send the application**, and the reason is written beside `APPLICATION_CAPTURE_REQUIRED`: §391.21 asks for no photograph, and a camera that will not open must not cost the carrier a candidate. If the owner wants one made mandatory, that is one array entry. |
| **10DLC brand/campaign registration** | Owner + Twilio | Started at A1. If it is not complete when A11 lands, the SMS flag stays off and email delivery is unchanged — the flag is default-off anyway. |
| **Draft/capture retention window** | Owner | A11 ships a default of **90 days after invitation expiry or lead disposition, whichever is earlier**. It is a config value; changing it is a config change, not a schema change, which is precisely what 0213's trigger style bought. |
| **Whether Silvicom wants an EEO section** | Owner | **A9 shipped the exclusion and defined no questions.** The reserved `questionnaire_answers.eeo` key is dropped by `readableAnswers` and never reaches the rendered document — pinned by a test that puts a marker string in it and greps the PDF. Adding questions later needs no change to the exclusion, which is the point of building it before there is anything to exclude. |
| ~~**The carrier's legal name and address**~~ | Owner | **ANSWERED 2026-08-21**, from the packet's own letterhead, which repeats it on all 31 pages: **Silvicom Inc, 1301 Armitage Ave, Melrose Park IL 60160** (safety contact `safety1@silvicominc.com`, 708-236-5732 ext 2). The schema half landed in 0229. All that remains is one production `update organizations set legal_address = …`, which is an owner act (writes go through the SQL editor), after which every rendered application carries §391.21(b)(1) in full. |

### 6.1 What the owner's packet actually contains — read before A9 or A0

`APPLICATION.xlsx` is one sheet holding **31 printed pages**, every one footed *"FOR DEPARTMENT OF
TRANSPORTATION VERIFICATION PURPOSE ONLY — THIS IS NOT AN EMPLOYMENT APPLICATION"*. Inventoried
2026-08-21. It sorts into four piles, and only the second is A9's:

**1. The §391.21(b) application we have already built.** Identity, three years of addresses, licences,
accidents, convictions, licence denials, ten-year employment history, the certification. It maps onto
`driverApplicationSchema` closely enough that almost no contract change falls out of it — ⚠ ~~with one
addition worth noting: the packet asks for **aliases** on the verification log, which the contract has
no field for.~~ **RESOLVED by A9 (0231):** aliases are not §391.21 material at all — (b)(2) does not
list one and FMCSA's own sample application does not ask — but they are §391.23(a)(2) material, and
the packet asks for them exactly where that is true: on the verification log, not on its application
pages. `other_names` now exists, cited to §391.23, and is projected into the inquiry letter.

**2. Carrier-specific questions — the actual A9 material, and there are few.** Position applied for ·
"How did you hear about this company?" · "Can you legally work in the USA?" · "Do you have proof of
age?" · "May we contact your previous employers?" · ~~a **driving-experience grid**~~ · education and
training · military service · **three personal references** (name, years known, phone, explicitly not
relatives or former supervisors). That is the questionnaire.
⚠ **The driving-experience grid was listed here and does not belong.** It is §391.21(b)(6) — the
paragraph names the equipment types itself, and FMCSA's own sample application lays it out as exactly
this grid. A9 moved it into `driverApplicationSchema`; see A9's "What the sources actually say".

**3. ⚠ Instruments the carrier has ALREADY drafted — this changes A0.** The packet carries its own
wording for most of what counsel was being asked to write from scratch: an FCRA disclosure and
authorization (page 19, citing §604(b) by name), a previous-employer release with the §391.23(d)/(e)
due-process rights spelled out (pages 14–15), a driving-record-check authorization (page 18), and a
urinalysis/drug-testing consent (page 21). **A0's job is therefore review and repair, not drafting** —
which is a much smaller ask of counsel and should be put to them that way. Two things to put in front
of them explicitly:
  - The **"Independent Contractor Notification & Release"** (page 4) bundles a consumer-report
    disclosure together with a liability release and an ongoing-authorization clause. That is exactly
    the arrangement §604(b)(2)'s "a document that consists **solely** of the disclosure" forbids, and
    exactly why D-HIRE3 gives each instrument its own row and its own screen. It is evidence for the
    design and a defect in the paper it replaces.
  - It names **"DOT Service, Chicago, IL"** as the consumer-reporting agency. Our screening goes to
    PSP and SambaSafety, so any wording that survives has to name the right agency.

**4. Policy and operational documents that are not part of an application at all** — minimum
qualifications (⚠ **"at least 23 years old"**, a carrier policy above §391.11(b)(1)'s 21, and a list of
disqualifying safety and criminal-history events), a rules-and-regulations fine schedule, insurance
deductibles, a fuel policy, a single-licence certification (§383.21), a seven-day work statement
(§395.8(j)(2)), an annual violation certification (§391.27), and an interview/results sheet for office
use. **None of these belong in A9's questionnaire**; several are other steps' work (the §391.27
certification is R-side, the seven-day statement is a hire-time document), and the fine schedule is
policy the driver acknowledges rather than a question they answer.

⚠ **One framing question for the owner and counsel, raised and not resolved here.** The packet
consistently frames drivers as independent contractors and states it is "not an employment
application". FMCSA's Part 391 applies to a *driver* the carrier uses, and a leased owner-operator is
generally still a driver subject to §391.21 and §391.51 regardless of tax status — which is why this
packet collects the §391.21 content anyway. Nothing in the build changes either way: the application,
the file and the evidence are the same. But A0's wording and A9's copy should say whichever the
carrier's counsel intends, and this plan does not guess.

**A9 is otherwise unblocked.** Its build begins with pile 2, transcribed into
`questionnaireContract.ts` as a versioned definition — ⚠ and the transcription fixes the packet's
spelling but never its meaning, because several of these strings become text somebody signs, and that
is counsel's to change and not an engineer's.

---

## 7. What this plan deliberately does not build

- **No cross-carrier prefill database.** D-APP14. We have one carrier's data and we say so.
- **No general-purpose e-signature product.** D-APP6. One known document set, one signer, no
  arbitrary PDF ingestion, no multi-party routing, no field-placement editor.
- **No digital certificate / PAdES cryptographic signing.** §390.32(c)(2) does not require it and
  `pdf-lib` cannot do it; the sha256 on an append-only `documents` row plus the signed evidence rows
  is the integrity story, and it is one we can actually reproduce in an audit.
- **No OCR of the driver's documents.** The capture gate measures legibility, never meaning
  (`gate.ts`'s own rule). Extracting a CDL expiry from a photograph is a different feature with a
  different failure mode, and it is not this one.
- **No `clearinghouse` instrument on the applicant's link.** D-REC4: that consent is given inside
  the Clearinghouse, and collecting our own would collect something that does not do the job.
- **No stage column.** D-REC1, still.

---

## 8. Order of execution

**A1 → A2 → A3a → A4 → A5 → A6 → A7 → A8a → A8b → A9 → A10 → A11**, with **A0 running in parallel
from the start** (it is counsel's clock, not ours) and the **10DLC registration opened the day A1
opens**.

⚠ **Position as of 2026-08-21: A1–A11a are DONE (schema 0232). The last step is A11b** — SMS
delivery, split out because it is a consent regime with a multi-week procurement lead time (10DLC,
started at A1) and everything else in this plan is finished. It ships flag-default-off regardless.
**The one input still outstanding for the whole plan is A0** — counsel's review of wording the carrier
has already drafted (§6.1 pile 3), which arms the consent gate and opens the signing ceremony with no
deploy.
`HANDOFF-2026-08-21-EVENING.md` is the fresh-session entry point — it carries the working rhythm and
the harness facts that cost time, which are not repeated here.

**A3b (prefill) is deliberately out of that line.** It depends only on A3a, nothing depends on it, and
half of it waits on R1/R2 for a leads table that does not exist. Slot it wherever it fits; the form is
complete without it.

A1 first because it is a live defect (§0.2) sitting behind a blocker that A0 is about to remove.
A6 after A5 because a renderer for signatures that do not yet exist is a renderer designed against an
imagined shape — the same argument PSP-PLAN made for P10 and P12, and it was right there too.

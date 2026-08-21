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

### A5 · The signing ceremony

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

### A6 · The rendered application PDF

**Prerequisites:** A5.

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

### A7 · The web capture provider

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

### A8 · Staged captures, filed at submit

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

### A9 · The carrier questionnaire

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

### A10 · Abandonment recovery

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

### A11 · SMS delivery, and the retention rule

**Prerequisites:** A10. **10DLC brand and campaign registration is started on the day A1 starts**
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
- Same migration: the **retention rule** D-APP4 promised — `application_drafts` and
  `application_captures` prune on a configured window after their invitation expires or its lead is
  dispositioned. This is the rule that makes D-APP2 and D-APP10's "prunable" claim true rather than
  aspirational, and it is why both tables took 0213's trigger style.

**Verify.** Matrix: the retention rule actually removes draft and capture rows and their storage
objects, and touches nothing in `RETENTION_FORBIDDEN` (the existing guard test proves the second
half). Unit: quiet hours refuse and reschedule rather than drop; a revoked consent refuses send; no
consent refuses send.
**Done when:** a driver who consented gets a text with their link, a driver who did not gets an
email, `STOP` is honoured on the next send, and an abandoned candidate's half-typed PII actually
disappears on schedule.

---

## 6. Inputs owned outside engineering — and the decision the code takes for each

Nothing in §5 waits on an answer. Each item below names its owner, and the behaviour that ships
regardless.

| Input | Owner | What the code does |
|---|---|---|
| **The five instruments' v1 wording + the 7001(c) text** | Counsel, via the owner | Ships refusing drafts (409, already built). Every step is verified against a non-draft test fixture, so nothing is blocked from being built or proven — only the first real signature waits. A0. ⚠ Since A4 this text also **arms the 7001(c) gate**: publishing it is what makes the consent required on every write path, and until then the application runs exactly as it did before. A4 shipped the six clauses as placeholders with a statutory citation each, so counsel's pass is six named strings rather than a blank page. |
| **The Excel application** | Owner | A9 begins with its transcription. Until it arrives, A1–A8 and A10–A11 are unaffected: the questionnaire is additive and nullable by construction. |
| **Which documents a driver must photograph** | Owner | A8 ships the closed slot set `cdl_front`, `cdl_back`, `medical_card`, `ssn_card`, `signature_mark`, `other` — derived from `CERTIFICATION_KINDS` and §391.51's contents. Adding a slot later is one enum entry plus one mapping line. |
| **10DLC brand/campaign registration** | Owner + Twilio | Started at A1. If it is not complete when A11 lands, the SMS flag stays off and email delivery is unchanged — the flag is default-off anyway. |
| **Draft/capture retention window** | Owner | A11 ships a default of **90 days after invitation expiry or lead disposition, whichever is earlier**. It is a config value; changing it is a config change, not a schema change, which is precisely what 0213's trigger style bought. |
| **Whether Silvicom wants an EEO section** | Owner | A9 supports one and excludes it from every recruiter-facing projection. Absent an instruction, no EEO questions are defined. |
| **The carrier's legal name and address** (⚠ new, 2026-08-21) | Owner | §391.21(b)(1) requires the employing motor carrier's name AND address on the application, and `organizations` has no address column — so A6's renderer cannot print one and the rendered document would be short of a paragraph the regulation names. A6 ships the block reading from the org and printing the name alone until the address exists; adding it is one migration plus one owner answer. |

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

**A1 → A2 → A3a → A4 → A5 → A6 → A7 → A8 → A9 → A10 → A11**, with **A0 running in parallel from the
start** (it is counsel's clock, not ours) and the **10DLC registration opened the day A1 opens**.

**A3b (prefill) is deliberately out of that line.** It depends only on A3a, nothing depends on it, and
half of it waits on R1/R2 for a leads table that does not exist. Slot it wherever it fits; the form is
complete without it.

A1 first because it is a live defect (§0.2) sitting behind a blocker that A0 is about to remove.
A6 after A5 because a renderer for signatures that do not yet exist is a renderer designed against an
imagined shape — the same argument PSP-PLAN made for P10 and P12, and it was right there too.

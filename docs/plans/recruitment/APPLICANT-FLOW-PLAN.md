# The applicant flow, in the carrier's order — plan and queue

**Created 2026-09-24.** Execution-grade. Every "today" statement in §2 was read at the call site on
`main` `2b5b0f1` (2026-09-24) or measured on production the same day, and cites the symbol it was
read from. Nothing in §4 depends on a fact that is not in §2.

**Relationship to the other plans.** This plan **supersedes the ORDER** of D-HM9
(`HIRING-MODULE-PLAN.md` §6) and adds steps AF1–AF7 to that plan's queue. Everything else in
`HIRING-MODULE-PLAN.md` stands: its §0 protocol applies here unchanged (one step, one PR, branch off
`origin/main`, append to §8 of THIS file, prove a test can fail, a migration and its first reader in
two merges). Waves D2–D5 are unchanged and still queued there.

⚠ **Depends on PR #998** (the counsel memorandum and the 2026-09-24 rulings L-1, Q-HM10, Q-HM11,
Q-HM14, Q-REC8). §5 sequences this plan against those rulings; merge #998 first.

---

## 1. The owner's flow, and the three rulings that decide it

### 1.1 The flow, in the owner's words (2026-09-24)

> We create new Applicant → We send him 4-5 Documents to sign (permissions), well designed and
> professional looking PDF documents that have a signing format as DocuSign has → we receive these
> signed documents and review them, then we pull PSP, MVR, send the Clearinghouse request to the
> driver and find him a place to do the pre-employment drug test → after this we send him the
> application link to fill out the form → after we have all of these documents we upload them
> through the application pages, and they become part of the DQF when he is hired → after he passes
> the drug test and we have results we send training videos (optional for now, but still to be
> built) → then we buy him a ticket to come to the office → in the office: road test and in-office
> orientation → after that we give him the application to sign, and we hire him or not.

### 1.2 Rulings (owner, 2026-09-24 — "all of this should be as you described")

| ID | Ruling |
|---|---|
| **D-AF1** | **Identity is collected with the permissions.** Date of birth, licence number, licence state and the licence photos are taken at the permissions step, because PSP, the MVR and the Clearinghouse query all run BEFORE the application exists. |
| **D-AF2** | **Each permission is its own PDF, signed DocuSign-style** — the same viewer, adoption dialog and sign-here tag the packet ceremony (C1/C2) uses. |
| **D-AF3** | **The packet opens for signing only when the office opens it, in person.** Approval no longer lets the applicant sign. |

### 1.3 Decisions this plan takes, each with its reason

| ID | Decision | Reason |
|---|---|---|
| **D-AF4** | The **Clearinghouse limited-query consent becomes the fifth permission**, and this **reverses D-REC4**. | D-REC4 kept `clearinghouse` off the applicant's path because the catalogue's text then described the FULL query, which is consented to in FMCSA's portal. Since 2026-09-13 (`clearinghouseConsent.ts`) the text behind that purpose is the LIMITED-query consent, which the carrier itself must obtain in writing or electronically (§382.703(a)) and needs for every annual query (§382.701(b)). |
| **D-AF5** | **"Send the application" WARNS on outstanding screening; it never refuses.** | Nothing in law requires screening before the application. Q-HM5's rule is that only the federal gates refuse, and they refuse at travel and at hire. A refusal here would invent a rule. |
| **D-AF6** | **"Open signing" REFUSES unless the application is approved and not filed, and WARNS on everything else outstanding.** | Approval is the gate the SQL already enforces (`record_packet_mark`, 0339). Whether the applicant is physically present is not something software can check. The office pressing the button in the office IS the in-person act. |
| **D-AF7** | **Each office act rotates or mints a link and hands it back on screen as well as by email.** | Both precedents do this: invitation creation returns the link (`routes/applicationInvites.ts`), and the nudge rotates it (0232). SMS cannot carry it, because `SMS_CONSENT` is `v0-draft` (§2.9). |
| **D-AF8** | **Identity has ONE writer: a SQL function that sets the `drivers` row and the draft together.** The applicant fills gaps only; the office overwrites. The application form shows the three fields read-only. | PSP reads `drivers`, the form reads the draft, and the filed application projects the draft onto `drivers` with fill-only-null semantics (0231). Two writers would let the licence PSP was run against differ from the licence on the filed application. |

---

## 2. What exists today (verified 2026-09-24)

### 2.1 One link, one run
`ApplyPage.vue` selects the screen with a `v-else-if` chain: filed → awaiting review → expectations
(B7) → `EsignConsentGate` → `SigningCeremony` (`ceremonyNeeded`) → `DraftUnlockGate` →
`SignOffScreen` (`awaitingSignature`) → the form. **After the fourth release the form opens on the
same link.** Nothing on the server stops it either: `saveDraft` (`applicationDraft.ts:117`) checks
the link, the consent and `submitted_at`, and nothing else.

### 2.2 Creating an applicant collects a name and an email
`InviteApplicantDrawer.vue` has First name, Last name and Their email (optional), posted to
`POST /api/roster/drivers` with `status: "applicant"` (`useCreateApplicant.ts`).

### 2.3 PSP needs identity that today arrives only with the application
`pspOrder.ts` reads `drivers.date_of_birth, cdl_number, cdl_state` (`DRIVER_COLS`, line 316) and
refuses `invalid_request` when `validatePspRequest` finds them missing. These columns are written
at submission by the draft→driver projection (0231), `coalesce(d.cdl_number, patch)` —
**fill-only-null**. The office can also set them: `PATCH /api/roster/drivers/:id` admits
`rolesThatManage("roster") ∪ rolesThatManage("recruitment")` (`routes/drivers.ts:84`), and
`driverUpdateSchema` includes `date_of_birth, cdl_number, cdl_state`.

### 2.4 The permissions
`APPLICATION_RELEASE_ORDER = [fcra_disclosure, psp, previous_employer, drug_alcohol]`
(`applicationIntake.ts:190`). The count that closes the ceremony is
`APPLICATION_RELEASE_ORDER.length`, passed as `p_expected_count` (`applicationReleases.ts:126`) to
`record_driver_release` (0228), which counts live rows and stamps `releases_completed_at`. The
`driver_authorizations.purpose` CHECK already admits `clearinghouse` (0215:39). **A fifth permission
therefore needs no migration.**

Readers of `APPLICATION_RELEASE_ORDER`, all of which follow the array:
`applicationReleases.ts` (serve + count), `permissionsDocument.ts` (B2 PDF), `useSigningCeremony.ts`,
`AuthorizationsPanel.vue`, `applicationWordingIsDraft` (`applicationIntake.ts:234`) and
`hiringChecklist.ts:198`. Comments that say "four" or that `clearinghouse` is deliberately absent:
`applicationIntake.ts:203`, `applicationSubmit.ts:72`, `AuthorizationsPanel.vue:39`,
`hiringSteps.ts:252`, `hiringChecklist.ts:194`, `applicationReviewContract.ts:15`,
`applicationIntake.ts:77`.

The permission screen is `SigningCeremony.vue`: one instrument per screen, a typed name rendered in a
script face, and an optional drawn mark staged into the `signature_mark` capture slot. **It is not
a PDF.** The office's printable copy is B2's `GET /api/recruitment/applications/:id/permissions.pdf`,
rendered on demand by `permissionsDocument.ts`.

### 2.5 Only one screening prerequisite is enforced
`missingAuthorizations()` has exactly one caller: `pspOrder.ts:201` (`psp_record`). The D1 recording
door (`hiringEvidence.ts` / `POST /api/recruitment/applicants/:id/records/:step`) checks **no**
authorization. So an MVR can be recorded against an applicant who never signed the FCRA
authorization, although `SCREENING_PREREQUISITES.mvr_order = ["fcra_disclosure"]` says it requires
one.

### 2.6 The packet signing gate is approval, in two places
`recordPacketMark` refuses `packet_not_yet_approved` without `approved_at`
(`applicationPacketMarks.ts:215`), and so does the SQL (`record_packet_mark`, 0339:141). Approval
sends the applicant *"reviewed and ready to sign"* and mints `sign_token_hash` once, ever
(`applicationApprovalNotice.ts:91–114`). `awaitingSignature` in `ApplyPage.vue` is
`approvedAt && !submitted`.

### 2.7 The signing viewer is reusable
`PacketPageView.vue` draws one page of a PDF `src` onto a canvas with pdfjs (props `src`, `page`,
`label`). `PacketPageRail.vue`
takes `stops`. `usePacketAdoption.ts` derives what is pinned from `stops[].signedAt` and
`stops[].mark` (`pinnedKinds`, line 255), so any list of stops in the `ApplyPacketStop` shape can
drive it. `APPLICATION_CAPTURE_MARK_SLOT` maps `signature → signature_mark` and
`initials → initials_mark`.

### 2.8 Links expire in 14 days, and only the nudge extends them
`INVITE_TTL_DAYS_DEFAULT = 14` (`applicationIntake.ts:27`). `expires_at` is written at creation
(`routes/applicationInvites.ts:201`) and extended only by `nudge_application_invitation` (0232,
`greatest(expires_at, now() + p_extend_days)`). Approval does not extend it. **The owner's flow
waits on drug-test results and travel, so it outlives 14 days.**

### 2.9 Delivery
`MAIL_PROVIDER=brevo` and `MAIL_FROM=uncchicago85@gmail.com` on `@fleetguard/api` (Railway,
2026-09-23). `SMS_PROVIDER=telnyx`, but `SMS_CONSENT.version = "v0-draft"`, so no applicant can
consent to SMS (memo Q12). **Email plus an on-screen link is the only delivery available.**

### 2.10 The nudge
`planApplicationNudges` (`applicationNudge.ts:99`) skips submitted, revoked, already-nudged,
handed-over, approved, expired, and **draft-less** invitations. It nudges a draft untouched for 48
hours and ROTATES the token (0232).

### 2.11 The checklist
`hiringSteps.ts`: `mvr` and `psp` require `permissions_signed` only. `clearinghouse` requires nothing.
`drug_test` requires `permissions_signed`. `application_filled` requires `permissions_signed`.
`orientation_videos` requires `office_approved` and has `evidence: null`, so it is not emitted.
`application_signed` requires `office_approved`. The input (`applicantChecklist.ts`) reads the
invitation as `INVITE_COLS = "id, created_at, review_requested_at, approved_at, submitted_at,
revoked_at"` and qualification records as `kind` only. `ApplicationPhases` carries
`reviewRequestedAt, approvedAt, submittedAt`. The drawer bodies are keyed in `hiringStepDrawers.ts`.

### 2.12 The MVR record has no state
`hiringEvidenceFileSchema` has `occurred_on, document_id, result, performed_by, reference`.
`hiringEvidenceDetail` writes `{source, structured, hiring_step, recorded_by}` into
`qualification_records.detail` (jsonb). §391.23(a)(1) requires an MVR from **every** state that
licensed the driver in the past 3 years. Those states are known only from the application
(`cdl_state` plus `additional_licences[]`, whose state is free text, `applicationContract.ts:32`).

### 2.13 Production, measured 2026-09-24
Next migration number: **0364**. Open invitations, all in Silvicom Inc:

| created | expires | consented | releases | draft | with office | approved | filed | marks |
|---|---|---|---|---|---|---|---|---|
| 09-11 | 09-27 | no | no | yes | no | no | no | 0 |
| 09-14 | 09-28 | no | no | no | no | no | no | 0 |
| 09-14 | 09-28 | yes | 4 of 4 | yes | yes | yes | **yes** | 0 |
| 09-17 | **10-01** | yes | 4 of 4 | yes | yes | yes | no | **20** |

---

## 3. The target

### 3.1 The applicant's link, screen by screen

| # | Screen | Shown when | Server gate on its writes |
|---|---|---|---|
| 1 | Expectations (B7, copy rewritten) | untouched link | — |
| 2 | Consent to electronic records | no `consented_at` | unchanged |
| 3 | **Identity (new)** — DOB, licence number, state, licence front and back | consented, identity incomplete | consent |
| 4 | **Five permissions, each a PDF signed DocuSign-style** | identity complete, releases incomplete | consent + identity |
| 5 | **"We have your permissions" (new waiting screen)** | releases complete, no `application_sent_at` | — |
| 6 | Date-of-birth unlock (D-APP16, unchanged) | draft holds a DOB | — |
| 7 | The application form, identity fields read-only | `application_sent_at` set | **consent + `application_sent_at`** |
| 8 | Awaiting review (unchanged) | handed over | — |
| 9 | **"Approved — you will sign in our office" (new)** | approved, no `signing_opened_at` | — |
| 10 | The packet ceremony (C1) | `signing_opened_at` set, not filed | **`signing_opened_at`** (TS + SQL) |
| 11 | Filed | `submitted_at` | — |

### 3.2 The office's acts

| Act | Refuses unless | Warns on | Writes |
|---|---|---|---|
| **Correct identity** | an invitation exists | — | `drivers` + draft, overwrite (D-AF8) |
| **Send the application** | releases complete, not revoked | any of `mvr, psp, clearinghouse, drug_test` not done | `application_sent_at` (first time only), rotated `token_hash`, `expires_at = greatest(expires_at, now() + 14 days)` |
| Approve (unchanged, notice text changed) | as today | — | as today, **no longer mints a sign token** |
| **Open signing** | approved, not filed | any `beforeTravel` federal gate not done, `road_test` not recorded | `signing_opened_at` (first time only), fresh `sign_token_hash`, expiry extended |

### 3.3 The checklist, in the owner's order
`invitation_sent` → `permissions_signed` (five, and identity) → `mvr` · `psp` · `clearinghouse` ·
`drug_test` → **`application_sent` (new)** → `application_filled` → `office_approved` →
`medical_certificate` · `employment_investigation` → `orientation_videos` (requires `drug_test`) →
*travel* → `road_test` → `live_orientation` → `handbook` → `application_signed` → `hired`.

---

## 4. The steps

⚠ Migration numbers are the next free number **at branch time**; 0364/0365 were free on
2026-09-24. Re-check `ls supabase/migrations | tail -1` before naming the file.

### AF1 · The fifth permission, and the MVR's missing prerequisite · half day · no migration · ∥

**Build**
- `applicationIntake.ts`: append `"clearinghouse"` to `APPLICATION_RELEASE_ORDER`, after
  `drug_alcohol`. Rewrite the §2.4 comments that say "four" or "deliberately absent", citing D-AF4.
- `hiringEvidence.ts` (api): the `:step = mvr` path refuses `authorization_missing` when
  `missingAuthorizations(rows, "mvr_order")` is non-empty. Read the rows exactly as `pspOrder.ts:198`
  does (`id, purpose, accepted_at, revokes`, org-filtered).
- `authorizationContract.ts`: delete `SCREENING_PREREQUISITES.clearinghouse_full` (it has no
  caller, §2.5, and it names the wrong instrument). `clearinghouse` is now asked for on the path
  instead.

**Verify**: shared, api and web tests. Tests asserting 4 now assert
`APPLICATION_RELEASE_ORDER.length`. Mutation: drop `"clearinghouse"` from the array and a
ceremony-count test goes red. Remove the `mvr_order` check and the refusal test goes red.

**Done when**: an applicant is asked for five permissions and the office's permissions PDF lists
five, and recording an MVR for somebody with no FCRA authorization is refused with its name.

⚠ **Cutover:** the two invitations with releases already complete (§2.13, rows 3 and 4) are not
reopened, because `record_driver_release` raises DR022. The office records their Clearinghouse
consent on paper through the existing `POST /authorizations` in `routes/authorizations.ts`:
`authorizationGrantSchema` takes `purpose: z.enum(AUTHORIZATION_PURPOSES)` and
`method: "wet_signature"` (`authorizationContract.ts:333–334`).

### AF2 · Migration: two phases and two functions · half day · ∥ with AF1

`supabase/migrations/0364_applicant_flow_phases.sql`:
- `alter table application_invitations add column application_sent_at timestamptz,
  add column signing_opened_at timestamptz;`
- **Backfill** `application_sent_at = releases_completed_at where releases_completed_at is not
  null`. Everybody already past the permissions keeps the form they already have. No other row
  moves. `signing_opened_at` is **not** backfilled: the unfiled approved walk (row 4) is re-opened
  by the office under D-AF3, and filed rows never sign again.
- `record_applicant_identity(p_org, p_invitation, p_driver, p_dob date, p_cdl_number text,
  p_cdl_state text, p_overwrite boolean) returns jsonb`, `security definer`,
  `set search_path = ''`, service_role only:
  - Locks the invitation row, and refuses unusable (revoked/expired) or submitted with named errcodes
    in a new `AI0xx` range (unused anywhere in the migrations, 2026-09-24).
  - `drivers`: with `p_overwrite` false, `coalesce(existing, new)` per column, the 0231 semantics.
    With true, sets them.
  - `application_drafts`: upserts the row keyed on `invitation_id` if absent (payload `{}`), then
    sets `payload = payload || jsonb_build_object('date_of_birth', …, 'cdl_number', …,
    'cdl_state', …)`, using the same key names as `applicationContract.ts:247/277/278`.
    ⚠ This must not be `.upsert()` with a partial payload (`lint:upserts`). It is SQL, the
    0174/0175 pattern.
- `send_application_invitation(p_org, p_invitation, p_token_hash text, p_extend_days int)
  returns timestamptz`: refuses unless `releases_completed_at` is set and the invitation is
  usable; sets `token_hash = p_token_hash`,
  `application_sent_at = coalesce(application_sent_at, now())` and
  `expires_at = greatest(expires_at, now() + make_interval(days => p_extend_days))`.

⚠ **No TypeScript reads either column in this PR** (`lint:migration-ordering`). Commit the
regenerated `schema.generated.sql` (`lint:table-writers` checks it). Add both functions to the
PGlite matrix `supabase/tests/`: fill-only-null versus overwrite, the draft merge preserving other
keys, the refusal before releases, and expiry never shortening.

**Done when**: the columns and functions exist in production (`pnpm verify:live` reports schema
current) and nothing calls them.

### AF3 · The identity screen, and the office's correction · day · after AF2 is applied

**Build**
- Shared: `applicantIdentitySchema` (`date_of_birth` via the existing `requiredDateOfBirthSchema`,
  exported from `rosterContract.ts:145`, `cdl_number` `min(1).max(60)`, `cdl_state`
  `min(2).max(10)`), the same bounds as `applicationContract.ts:277–278`.
- API, public: `POST /api/public/application/:token/identity` → `recordApplicantIdentity` (new, in
  `modules/recruiting/`), which resolves the invitation, requires the consent
  (`requireEsignConsent`), and calls the function with `p_overwrite = false`. The invitation view
  gains `identityComplete: boolean`, computed server-side from the draft keys, **never the values**,
  because D-APP16 keeps the DOB off the bare link.
- API, public: `recordRelease` refuses a new `identity_missing` code while `identityComplete` is
  false. The captures route admits `cdl_front`/`cdl_back` from consent onward. `medical_card` and
  `ssn_card` wait for AF4's gate.
- API, office: `POST /api/recruitment/applications/:invitationId/identity`
  (`requireSection("recruitment", "manage")`, org-filtered, `expectOrgScoped` in the test) calls
  the function with `p_overwrite = true` and writes an audit row.
- Web: `IdentityFields.vue` in `features/apply/` with licence-photo capture from
  `DocumentCaptureFields`/`stageCapture`, placed in `ApplyPage.vue` between the consent and the
  ceremony. The form's `LicenceFields`/`ApplicantDetailsFields` render the three fields read-only
  with *"To change this, contact {carrier}."* The office's correction lives in the `authorizations`
  drawer body.

**Verify**: api and web tests; mutate `p_overwrite` to true on the public path and a
fill-only-null test goes red. Render the screen at 390 and 1440 in `preview:local`.

**Done when**: an applicant who has signed nothing else can be PSP-ordered by the office, and the
licence on their filed application is the licence PSP was run against.

### AF4 · The permissions link ends; the office sends the application · day · after AF3

**Build**
- Shared: `ApplicationPhases` gains `applicationSentAt`. `NudgeCandidate` gains
  `application_sent_at`, and `planApplicationNudges` skips `!application_sent_at` (an applicant
  waiting for the office to screen them has abandoned nothing, and AF3's identity write creates a
  draft that would otherwise look stale after 48 hours). Pin it with a candidate whose draft is 10
  days old and whose `application_sent_at` is null.
- `hiringSteps.ts`: new step `application_sent` (`owes: "us"`, `where: "office"`,
  `requires: ["permissions_signed"]`, evidence `application_invitations.application_sent_at`).
  `application_filled.requires = ["application_sent"]`. `orientation_videos.requires =
  ["drug_test"]`. Renumber ordinals to §3.3.
- API, public: `saveDraft`, `requestReview` and the `medical_card`/`ssn_card` captures refuse
  `application_not_sent` until `application_sent_at`. The public GET returns `applicationSentAt`.
- API, office: `POST /api/recruitment/applications/:invitationId/send-application` mints with
  `mintInvitationToken()` (`applicationIntake.ts:40`) and calls `send_application_invitation`. It
  emails the link through the invitation mailer. ⚠ `deliverApplicationInvite` is a **private**
  function inside `routes/applicationInvites.ts:71`, so this step first moves it into its own
  module in `modules/recruiting/`, and both routes import it (a copy would be a second mailer
  for one message). It returns
  `{ link, warnings: string[] }`, where warnings are the D-AF5 steps not done, read from the fold.
  Audited. A second press rotates and re-sends (a lost email); the stamp keeps its first date.
- `applicantChecklist.ts`: `INVITE_COLS` gains `application_sent_at`.
- Web: `ApplyPage.vue` gets the waiting screen (§3.1 row 5). `hiringStepDrawers.ts` maps
  `application_sent` to a new `send_application` body: a button, the warnings, and the returned
  link with copy. `ApplyExpectations.vue` copy describes two visits to the link: permissions now,
  the application later.

**Verify**: shared, api and web tests; `lint:tokens`, `lint:ui-adoption`. Mutation: remove the
`application_sent_at` check from `saveDraft` and a refusal test goes red.

**Done when**: an applicant who signs their permissions sees a screen saying the office will be in
touch, cannot open the form, and gets an email with a working link when the office presses Send.

### AF5 · The packet opens only in the office · day · after AF4 · ⚠ **before the first real packet**

**Build**
- Migration `0365_packet_signing_opened.sql`:
  - `create or replace function public.record_packet_mark(...)` with the 0339 body unchanged
    except a refusal when `signing_opened_at is null` (new errcode **`DR036`**; DR010–DR035 are
    taken, measured across all migrations 2026-09-24).
  - `open_packet_signing(p_org, p_invitation, p_sign_token_hash text, p_extend_days int)`: refuses
    unless approved and not submitted; sets `sign_token_hash`,
    `signing_opened_at = coalesce(signing_opened_at, now())` and extends `expires_at`.
  - The migration reads a column that exists since AF2, so it passes `lint:migration-ordering`.
  - ⚠ From the moment it applies until the TS below is served, no packet can be marked. Production
    has one unfiled walk (row 4), so that window affects nobody. Say so in the PR.
- API: `recordPacketMark` refuses `packet_not_opened` before its approval check.
  `applicationApprovalNotice.ts` **stops minting** the sign token, and its email and SMS text
  change to *"approved; {carrier} will contact you about coming to the office"*.
  `POST /api/recruitment/applications/:invitationId/open-signing` mints a fresh sign token, calls
  the function, and returns `{ link, warnings }` (D-AF6). Audited.
- Shared: `ApplicationPhases.signingOpenedAt`. `applicantChecklist.ts` reads `signing_opened_at`.
  The `application_signed` step is `waiting_on_us` until opened, then `waiting_on_them`.
- Web: `ApplyPage.vue` `awaitingSignature` requires `signingOpenedAt`, with the new approved-not-
  opened screen (§3.1 row 9). The `packet` drawer body gets **Open signing on this screen** (opens
  the returned link in a new tab on the office computer) plus copy-link.

**Verify**: api tests for both refusals; the PGlite matrix for the SQL refusal. Walk it in the QA
org: approve, confirm the applicant's link shows row 9, open signing, sign all marks, file.

**Done when**: an approved applicant cannot sign anything until somebody in the office opens
signing, and the office can then hand them a screen that signs.

### AF6 · Each permission a PDF, signed DocuSign-style · more than a day · after AF3 · no migration

**Build**
- API: `permissionInstrumentPdf(purpose, doc, carrier, signer)` in `applicationPdf/`, drawn through
  `lib/pdfDraw.ts`. One instrument per file, carrying the title, body, intent sentence and a
  signature block (name, date, mark rectangle). It returns the bytes and the rectangle.
  ⚠ The **PSP PDF carries FMCSA's text and the signature block only**: no letterhead sentence,
  footer or platform line. The form's own NOTICE says the language must *"exist as one stand-alone
  document"* and *"may NOT be included with other consent forms or any other language"*.
- API, public: `GET /api/public/application/:token/permission/:purpose.pdf` serves the unsigned
  instrument. ⚠ Rate limiting: `middleware/applicationLimits.ts` sends a request to the per-link
  ceremony bucket only when `isPacketMark` matches (`POST /<token>/mark`, line 70). Everything
  else under `/api/public/application` falls to the intake bucket (`applicationIntakeLimiter`, 20
  per minute per address). Five PDFs plus the page's own GETs would crowd it, so this step widens
  that predicate to also match `GET /<token>/permission/<purpose>.pdf`, with a test for each path.
- Web: `SigningCeremony.vue` rebuilt on `PacketPageView` + `PacketAdoption`/`usePacketAdoption`.
  `ApplyPacketStop` is `PacketPlacement` (`id, page, party, mark, anchor, what`) plus `signedAt`
  (`useApplication.ts`), and its `id` is a packet placement id, so a permission cannot pose as
  one. Instead, `usePacketAdoption`'s `stops` parameter is narrowed to the three fields it reads,
  `{ id: string; mark: PacketMarkKind; signedAt: string | null }` (`pinnedKinds`, lines 260–261),
  and permission stops are passed as `{ id: purpose, mark: "signature", signedAt }`. A **Sign here** tag sits over the rectangle, and finishing a document posts the
  existing release endpoint unchanged. The adopted mark is staged into `signature_mark` exactly as
  today, so the packet later offers it as carried over (`markCarriedOver`).
- B2's `permissions.pdf` becomes the signed per-instrument PDFs in sequence plus the certificate. It
  stays rendered on demand from the append-only `driver_authorizations` rows, as today.

**Verify**: render all five at a long fixture, `pdftoppm -r 110`, and **look** (AUD discipline); the
PSP PDF's text compared word for word with `psp-disclosure/PSPDisclosureandAuthorizationForm.txt`.
Web tests, and a walk at 390 and 1440.

**Done when**: an applicant reads each permission as a document and signs it where it says to, and
the office prints exactly what each one looked like when signed.

### AF7 · Every licensing state gets its MVR (§391.23(a)(1)) · half day · ∥ after AF4

**Build**
- Shared: `hiringEvidenceFileSchema` gains optional `jurisdiction` (`max(60)`), written into
  `detail.jurisdiction` by `hiringEvidenceDetail` (jsonb, no migration).
- `applicantChecklist.ts` reads `detail` for `mvr` rows, plus the licence states of the latest
  application (`cdl_state` + `additional_licences[].state`). The fold marks `mvr` done only when
  every such state matches a recorded jurisdiction case-insensitively after trimming. Otherwise it
  is `waiting_on_us` with the blocker *"MVR still needed from: …"*. Before any application exists,
  one MVR is done, as today.
- ⚠ No normalisation of free text beyond trim and case, because mapping "Illinois" to "IL" would be
  inference on a federal requirement. A mismatch is shown to a person, who records the MVR with the
  jurisdiction as written.

**Done when**: a driver licensed in two states in the last three years cannot show a green MVR step
with one state's record.

---

## 5. Order

| # | Step | Blocked by | Freeze-bound (before the first real packet)? |
|---|---|---|---|
| 1 | AF1 ∥ AF2 | #998 merged | no |
| 2 | AF3 | AF2 applied | no |
| 3 | AF4 | AF3 | no |
| 4 | **AF5** | AF4 | **yes** |
| 5 | **L-1** (page 4 out of the ceremony) and **Q-HM14** (`applying_as`), specified in `HIRING-MODULE-PLAN.md` §10, 2026-09-24 | #998 | **yes** |
| 6 | AF6 | AF3 | no, but it changes what applicants see first; do it before inviting at volume |
| 7 | AF7 | AF4 | no |
| 8 | D2 road test, D3 orientation/handbook, D4 videos | queued in `HIRING-MODULE-PLAN.md` §9 | no |

**Owner prerequisites (not builds):** set `MAIL_FROM` to an authenticated Brevo sender on
`@fleetguard/api` *and* `@fleetguard/web`. Both read `uncchicago85@gmail.com` (Railway,
2026-09-24). Until then every email in §3.2 goes out from a personal
Gmail address, and the on-screen link is the reliable path.

---

## 6. Deliberately not in this plan

- **Finding a drug-test collection site.** No vendor integration exists and none was asked for; the
  result is recorded through D1 as today.
- **Sending the Clearinghouse request to the driver.** The full query's consent is given in FMCSA's
  portal by the driver; there is no API to trigger it from here. D1 records the outcome.
- **Training videos, road test, orientation, handbook**: D4, D2, D3 in `HIRING-MODULE-PLAN.md`.
- **SMS**: blocked on counsel (memo Q12), not on code.

---

## 7. Open questions

None blocking. The three rulings in §1.2 settled everything this plan needed from the owner. The
counsel questions in `COUNSEL-REVIEW-PACKAGE.md` do not block any step here. They change wording,
and wording changes are version bumps.

Added 2026-09-24 while building Q-HM14. None of them blocks it; each is recorded rather than
routed around.

- **Q-AF1 · Page 22 already answers "Pre-Employment Qualification" for everybody.** The carrier's
  paper prints `yes` on that rule itself (a text run at x207.6 in `application-11.pdf`, found while
  measuring page 22; no plan recorded it before). So Q-HM14's derivation can only ADD the
  owner-operator's reason. A company driver's page 22 reads the carrier's `yes` alone, which is the
  ruling. An owner-operator's page reads `yes` on BOTH lines: the carrier's, and ours on
  `Pre-Qualification for Contracting a Driver/ Owner Operator`.
  *Candidates:* (a) keep it as built. Both reasons read as true for an owner-operator, because the
  test is also the pre-employment test before they first drive for the carrier. (b) The owner
  re-exports `APPLICATION.xlsx` without the printed `yes`; the renderer then derives both lines, and
  `packetSigningGeometry.test.ts`'s *"carries the carrier's own printed yes"* fails by name to say
  so. (c) Paint over the carrier's `yes` for owner-operators. **Rejected:** it edits the carrier's
  paper, which D-PKT11 makes the text authority. *Recommendation:* **(a) now, (b) if the owner wants
  one reason per page.** ⚠ Freeze-bound for owner-operators: every owner-operator packet filed
  before a re-export keeps both.
- **Q-AF2 · The filed packet cannot be drawn for a name outside Windows-1252.** Pre-existing and
  not caused by Q-HM14. Found rendering a long-name fixture: `Szczepańska` throws
  `WinAnsi cannot encode "ń"` in `packetFit.ts`'s `fitGroupSize`, because the pdf-lib overlay
  draws with a standard font and never goes through `lib/winAnsi.ts`. `ń ł č ć ő ș` are all outside
  the code page; `š ž` are inside it. **Measured:** the render throws. **Not measured:** what
  `submitApplication` does when `ensureApplicationPdf` throws after the application has filed.
  *Candidates:* (a) fold every overlay value through `winAnsi()`. It is lossy: the name on the
  federal form would then differ from the name the applicant typed. (b) Embed a Unicode font in the
  overlay (pdf-lib + fontkit). *Recommendation:* **(b)**, as its own step and before the first
  applicant with such a name files. The carrier's drivers make that likely.
- **Q-AF3 · Nothing warns the office when `applying_as` is unanswered.** The questionnaire blocks
  nothing (D-APP12), and an unanswered question means the packet as printed. So an applicant who
  skipped the question is walked to `p31b` and signs page 31 as the owner-operator. The office sees
  the answer, or its absence, in the review drawer, but Open signing does not mention it:
  `OPEN_SIGNING_WARNS_ON` is a list of checklist steps, and this is not one.
  *Candidates:* (a) Open signing warns on a missing `applying_as`. That widens its warnings from
  step keys to a small union. (b) Make the answer required through `APPLICATION_CROSS_FIELD_RULES`,
  which D-APP12's header names as the honest shape for a mandatory carrier question.
  *Recommendation:* **(a)**. The office is in the room when it opens signing and can ask.

---

## 8. Progress log

Append a dated line per step. Never edit §4.

- **2026-09-24** — Plan written and verified against `main` `2b5b0f1` and production.
- **2026-09-24** — **AF1 DONE** (#1006, merge `083f0f4`). `clearinghouse` is the fifth entry in
  `APPLICATION_RELEASE_ORDER`. The D1 door refuses `authorization_missing` for `mvr` on both the
  scan registration and the filing, via `HIRING_RECORDED_ACT_PREREQUISITE`, a total `Record` in
  `hiringEvidence.ts`: `clearinghouse` and `drug_test` are deliberately null. `clearinghouse_full`
  is deleted. ⚠ **Beyond §2.4's list:** the permissions PDF and `AuthorizationsPanel` both printed
  *"the Clearinghouse … consent is not listed: it is given inside the FMCSA portal"*, which would
  have sat directly under the new fifth row, so both sentences are gone and tests now pin their
  absence. About 20 more present-tense "four" comments were also rewritten. ⚠ **Cutover still owed
  by the office:** the two production invitations at 4 of 4 now read `permissions_signed` NOT done
  until their Clearinghouse consent is recorded (`POST /authorizations`, `wet_signature`), as §4
  AF1 says.
- **2026-09-24** — **AF2 DONE** (#1007, merge `7ae8634`), **as migration 0365, not 0364**:
  `0364_mcleod_dispatch_raw.sql` (#1005) merged while it was in flight. **AF5's migration is
  therefore 0366.** Matrix `applicant-flow-phases.test.mjs`, 39 assertions, 8 of 8 migration
  mutants killed. Three places where the build refines §4's text, each taken for the reason given:
  · `record_applicant_identity` merges into the draft **the values that ended up on `drivers`**,
    not the typed ones. Otherwise an applicant who re-submits after the office's correction would
    leave the row (fill-only, office value kept) and the draft (typed value) disagreeing, which is
    exactly the split D-AF8 exists to prevent. It returns the NAMES of the kept columns
    (`kept_existing`) and never their values (D-APP16).
  · Expiry refuses the applicant's identity write but **not the office's**, and
    `send_application_invitation` **revives an expired link** instead of refusing it. §2.8's
    reason: this order waits on labs and travel and outlives 14 days. §3.2 refuses send only for
    revoked, and submitted is refused too. Errcodes: AI001 not found · AI002 revoked/expired ·
    AI003 submitted · AI004 invalid · AI005 permissions not complete.
  · ⚠ **For AF3, and it is a real hole if skipped:** `save_application_draft` (0226) REPLACES
    `payload` wholesale, so an autosave from a tab opened before the identity write can erase the
    three keys this function set, which reintroduces a second writer. AF3 must make those keys
    server-owned on the draft save path, for example by re-applying them from `drivers` inside
    the save, or by stripping them from the client payload and merging instead of replacing.
- **2026-09-24** — **AF3 DONE** (#1013, merge `f56163e`). Identity screen between the consent and
  the first permission. `POST /:token/identity` (fill-only), `identityComplete` on `GET /:token`,
  `recordRelease` refuses `identity_missing`. The office corrects from the `authorizations` drawer
  (`POST /applications/:invitationId/identity`, overwrite, audited without values). The form
  shows the three read-only. 13 of 13 mutants killed. Where the build refines §4's text:
  · **`identityComplete` needs the ROW and the DRAFT**, not "the draft keys". Draft-only passes a
    pre-AF3 applicant whose row is empty, so PSP still cannot be ordered. Row-only passes a rehire
    whose draft is empty, so the form shows blank read-only fields. Tests pin both.
  · **AF2's autosave hole is closed in TypeScript.** `saveDraft` AND `submitApplication` lay the
    row's non-null identity over the client payload (`identityOnRecord`), so a stale tab can
    neither save nor file an old licence. Null columns are left alone, so a pre-AF3 applicant's
    typed licence still files through 0231. **One gap is left open on purpose:** a correction
    landing between one save's read and its write is picked up by the next autosave, not by that
    save. Closing it outright means moving the overlay into `save_application_draft` (a migration
    on the function the whole form uses). Recommendation: leave it unless a real mismatch is
    ever seen, because the submit-time overlay already guarantees the FILED document is right.
  · Captures needed no change: `cdl_front/cdl_back` were already admitted from consent onward.
    AF4's gate on `medical_card`/`ssn_card` is still owed.
  · ⚠ **Migration numbers keep moving:** the other chat has taken 0366 and 0367 today, so AF5's
    migration is **0368 or later**. Re-check at branch time.
- **2026-09-24** — **AF4 DONE** (#1018, merge `4f6ba2f`). The permissions visit ends on "We have your
  permissions". Draft save, hand-over and the `medical_card`/`ssn_card` photos refuse
  `application_not_sent` (409) until the office presses **Send the application**
  (`POST /applications/:invitationId/send-application`). That press rotates the link through 0365,
  returns it on screen, emails it, audits it, and WARNS about outstanding screening without
  refusing. The checklist gains `application_sent` and follows §3.3's order, renumbered 1–17.
  17 of 17 mutants killed. Where the build refines §4's text:
  · **`applicationProgress`: a draft is "filling" only once the form has been sent.** AF3's
    identity draft would otherwise read as "filling it in" on the board and the invitation card.
    The invitation card gains two states: "Permissions signed" (the office's move) and
    "Application sent" (the applicant's).
  · **The nudge sweep selects `application_sent_at`.** Its rows are cast, not typed, so without
    the column every candidate reads unsent and the sweep would silently nudge nobody. A test pins
    the select.
  · **A second email template** (`applicationSentEmail.ts`), because sending rotates the link and
    the applicant must be told the earlier one no longer works. The mailer moved to
    `modules/recruiting/applicationMail.ts` as §4 said, and the approval notice's private
    `carrierName` copy now uses it too.
  · The page reads a MISSING `applicationSentAt` as "sent", so a bundle meeting an older API
    strands nobody.
  · `ApplyPage.vue` reached the 500-line budget. The consent step moved to
    `useEsignConsentStep.ts` and both waiting screens share `ApplyWaitScreen.vue` (page at 479).
  · ⚠ **AF5 now owes the approval copy too:** `APPLY_COPY.expectations.afterwards` and the
    approval email still describe signing on "a second, short visit" to the link. AF5 changes
    both, since signing moves to the office (D-AF3).
  · ⚠ **Migration numbers:** the other chat has now also used 0368, so **AF5's migration is 0369
    or later**. Re-check at branch time AND again right before merging.
- **2026-09-24** — **AF5 DONE, in two merges**: migration **0369** (#1020, merge `077b67b`) and its
  reader (#1022, merge `4a64a82`). An approved applicant cannot sign until somebody in the office
  opens signing from the packet row. `record_packet_mark` refuses **DR036**, and `recordPacketMark`
  refuses `packet_not_opened` (409). The press returns a fresh sign link on the office's screen,
  audited as `compliance.packet_signing_opened`, and warns without refusing on
  `OPEN_SIGNING_WARNS_ON` (derived: every `federalGate && beforeTravel` step, plus `road_test`).
  0369's matrix killed 12 of 12 mutants and the TypeScript battery 18 of 18. I checked 0369 in
  production's `pg_proc` before the reader merged. Where the build refines §4's text:
  · **Two merges, not one.** §4 read the migration as safe to ship with its reader because it only
    reads a column from AF2. It also adds a FUNCTION, and the route that calls it would have been
    served ~2m44s before the function existed. `lint:migration-ordering` cannot see functions
    (0340's header), so I held the rule by hand. The window this opened (no packet markable between
    0369 applying and #1022 being served) affected nobody, as §4 predicted.
  · **Refusal order is unapproved → filed → unopened**, in both SQL and TypeScript, not "before its
    approval check". Production's filed row was never opened, and it keeps answering "filed".
  · **Open signing emails nothing**, the one deliberate exception to D-AF7. A sign link sent
    anywhere else would let the packet be signed away from the office, which is what D-AF3
    removed. The panel opens a tab inside the click and points it at the link after the response,
    because a `window.open` after an `await` is a blocked pop-up.
  · **`application_signed` now `owes: "us"`**. It is in flight when OPENED, not when marked, so
    production's 2026-09-17 walk (20 marks, never opened) reads as the office's move rather than
    "waiting on them" for a signer the database refuses.
  · **More copy than §4 listed was false and is rewritten**: `handoff.waitingBody` and
    `waitingNote` ("keep this link, it is where you will sign"), submit's `not_yet_approved`
    message, the office's approval toasts ("asked to sign it"), and the `approved` labels ("Sent
    back to sign" → "Approved, to sign in the office"). Invitations gain a `signing_open` state.
  · The page and the invitation list read a MISSING `signingOpenedAt` as opened, as AF4 did for
    `applicationSentAt`: under an older API, approval did open signing.
  · `lint:table-writers` ratcheted down: the approval notice no longer writes `application_invitations`.
  · ⚠ **For the office, when it next walks this in "FuelGuard EFS QA":** approve, then check that
    the applicant's link shows "Your application is approved… you sign it in their office". Press
    **Open signing on this screen** on the packet row, sign every mark and file. That end-to-end walk
    (§4 Verify) is not done yet; the tests and the 390/1440 renders cover the pieces.
  · **Next: L-1 and Q-HM14** (freeze-bound, `HIRING-MODULE-PLAN.md` §10 2026-09-24), then AF6, AF7.
- **2026-09-24** — **L-1 DONE** (#1026, merge `1ef555a`; §5 row 5). Page 4 is out of the ceremony
  (22 → 21), and it prints unsigned with the reason on its signature line. The full entry is in
  `HIRING-MODULE-PLAN.md` §10. **Next: Q-HM14**, the last freeze-bound step, then AF6 and AF7.
